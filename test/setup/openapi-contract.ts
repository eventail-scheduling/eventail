import type { ValidateFunction } from "ajv/dist/2020.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsPlugin from "ajv-formats";
import { buildOpenapiSpecJson } from "../../src/route/openapi.js";
import { recordCheckedResponse } from "./contract-tally.js";

type AddFormats = (ajv: Ajv2020) => void;

// ajv-formats is CJS, so the default import resolves to `module.exports`, which
// carries the plugin. Its published types describe the ESM shape instead.
const addFormats = addFormatsPlugin as unknown as AddFormats;

const JSON_API_MEDIA_TYPE = "application/vnd.api+json";

type Schema = Record<string, unknown>;

type Operation = {
    responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};

type Spec = {
    paths: Record<string, Record<string, Operation>>;
};

type PathTemplate = {
    template: string;
    pattern: RegExp;
    parameterCount: number;
};

type Resource = {
    type?: unknown;
};

type JsonApiDocument = {
    data?: unknown;
    included?: unknown;
};

const buildAjv = (): Ajv2020 => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addFormat("rgb", /^#[0-9a-f]{6}$/i);

    return ajv;
};

const buildPathTemplates = (spec: Spec): PathTemplate[] =>
    Object.keys(spec.paths)
        .map((template) => ({
            template,
            pattern: new RegExp(
                `^${template.replaceAll(/\{[^}]+\}/g, "[^/]+").replaceAll(".", "\\.")}$`,
            ),
            parameterCount: (template.match(/\{[^}]+\}/g) ?? []).length,
        }))
        // A literal segment beats a parameter, so `/schedules/current` wins over
        // `/schedules/{scheduleId}` for the one path both patterns accept.
        .sort((left, right) => left.parameterCount - right.parameterCount);

type ContractContext = {
    spec: Spec;
    ajv: Ajv2020;
    templates: PathTemplate[];
};

let cached: ContractContext | null = null;

const context = (): ContractContext => {
    if (!cached) {
        const spec = JSON.parse(buildOpenapiSpecJson()) as Spec;
        cached = { spec, ajv: buildAjv(), templates: buildPathTemplates(spec) };
    }

    return cached;
};

const parseNarrowedTypes = (query: string): Set<string> => {
    const narrowed = new Set<string>();

    for (const [key] of new URLSearchParams(query)) {
        const match = /^fields\[([^\]]+)\]$/.exec(key);

        if (match?.[1]) {
            narrowed.add(match[1]);
        }
    }

    return narrowed;
};

const relaxedSchemas = new WeakMap<Schema, Schema>();

/**
 * Drops `required` for a type the client asked to narrow.
 *
 * Sparse fieldsets are the client's choice, so a field it did not ask for is
 * absent by agreement rather than by contract breach. Everything else about
 * the schema still applies, so a field that is present is still checked.
 */
const relaxRequired = (schema: Schema): Schema => {
    const cachedRelaxed = relaxedSchemas.get(schema);

    if (cachedRelaxed) {
        return cachedRelaxed;
    }

    const properties = schema.properties as Record<string, Schema> | undefined;
    const required = schema.required as string[] | undefined;
    const relaxed: Schema = {
        ...schema,
        // Only the two members a fieldset can empty. Dropping the whole list
        // would stop checking `id`, `type` and a declared `meta` as well.
        ...(required
            ? {
                  required: required.filter(
                      (key) => key !== "attributes" && key !== "relationships",
                  ),
              }
            : {}),
    };

    if (properties) {
        relaxed.properties = Object.fromEntries(
            Object.entries(properties).map(([key, value]) =>
                key === "attributes" || key === "relationships"
                    ? [key, (({ required, ...rest }) => rest)(value)]
                    : [key, value],
            ),
        );
    }

    relaxedSchemas.set(schema, relaxed);

    return relaxed;
};

const pickBranch = (schema: Schema, resource: Resource): Schema => {
    const branches = schema.oneOf as Schema[] | undefined;

    if (!branches) {
        return schema;
    }

    const match = branches.find((branch) => {
        const properties = branch.properties as Record<string, Schema> | undefined;

        return resource.type !== undefined && properties?.type?.const === resource.type;
    });

    return match ?? schema;
};

const validators = new WeakMap<Schema, ValidateFunction>();

const validatorFor = (schema: Schema): ValidateFunction => {
    let validate = validators.get(schema);

    if (!validate) {
        validate = context().ajv.compile(schema);
        validators.set(schema, validate);
    }

    return validate;
};

const collect = (
    schema: Schema,
    resource: Resource,
    label: string,
    narrowed: ReadonlySet<string>,
): string[] => {
    const branch = pickBranch(schema, resource);
    const validate = validatorFor(
        narrowed.has(resource.type as string) ? relaxRequired(branch) : branch,
    );

    if (validate(resource)) {
        return [];
    }

    return (validate.errors ?? []).map(
        (error) => `${label}${error.instancePath} ${error.message ?? "is invalid"}`,
    );
};

export type ContractFailure = {
    operation: string;
    problems: string[];
};

type ResolvedOperation = {
    label: string;
    schema: Schema | null;
};

const resolveOperation = (
    method: string,
    pathname: string,
    status: number,
): ResolvedOperation | null => {
    const { spec, templates } = context();
    const template = templates.find(({ pattern }) => pattern.test(pathname));

    if (!template) {
        return null;
    }

    const operation = spec.paths[template.template]?.[method.toLowerCase()];

    if (!operation) {
        return null;
    }

    const schema = operation.responses?.[String(status)]?.content?.[JSON_API_MEDIA_TYPE]?.schema;

    return {
        label: `${method.toUpperCase()} ${template.template} -> ${status}`,
        schema: schema ?? null,
    };
};

const collectData = (
    schema: Schema | undefined,
    data: unknown,
    narrowed: ReadonlySet<string>,
): string[] => {
    if (!schema || data === undefined || data === null) {
        return [];
    }

    if (!Array.isArray(data)) {
        return collect(schema, data as Resource, "data", narrowed);
    }

    const items = schema.items as Schema | undefined;

    if (!items) {
        return [];
    }

    return data.flatMap((resource, index) =>
        collect(items, resource as Resource, `data/${index}`, narrowed),
    );
};

const collectIncluded = (
    schema: Schema | undefined,
    included: unknown,
    narrowed: ReadonlySet<string>,
): string[] => {
    if (!(schema && Array.isArray(included))) {
        return [];
    }

    return included.flatMap((resource, index) =>
        collect(schema, resource as Resource, `included/${index}`, narrowed),
    );
};

const documentShells = new WeakMap<Schema, Schema>();

/**
 * Strips `data` and `included` from a response schema, leaving the document.
 *
 * `required` is kept whole, so a missing `data` is still reported here:
 * `collectData` has nothing to say about one that never arrived.
 */
const documentShell = (schema: Schema): Schema => {
    const cachedShell = documentShells.get(schema);

    if (cachedShell) {
        return cachedShell;
    }

    const properties = schema.properties as Record<string, Schema> | undefined;
    const shell: Schema = {
        ...schema,
        ...(properties
            ? {
                  properties: Object.fromEntries(
                      Object.entries(properties).filter(
                          ([key]) => key !== "data" && key !== "included",
                      ),
                  ),
              }
            : {}),
    };

    documentShells.set(schema, shell);

    return shell;
};

const collectDocument = (schema: Schema, document: unknown): string[] => {
    const validate = validatorFor(documentShell(schema));

    if (validate(document)) {
        return [];
    }

    return (validate.errors ?? []).map(
        (error) => `document${error.instancePath} ${error.message ?? "is invalid"}`,
    );
};

/**
 * Checks one response against the schema the emitted spec publishes for it.
 *
 * Resources are matched to their own `oneOf` branch by `type` before
 * validating, because validating a document against the whole branch set
 * reports every branch that was never meant to match.
 *
 * Returns null for anything the contract does not cover: a non-2xx status, an
 * empty body, or a path or method the spec does not describe. A status the spec
 * omits for that operation, or documents without a JSON:API body, is reported as
 * a failure rather than skipped.
 *
 * Counts every response it reaches a verdict on, which the run holds to a floor
 * because a skip and a pass read the same here; see contract-tally.ts.
 */
export const checkResponseContract = (
    method: string,
    path: string,
    status: number,
    body: string,
): ContractFailure | null => {
    if (status < 200 || status >= 300 || body === "") {
        return null;
    }

    const [pathname = path, query = ""] = path.split("?");
    const resolved = resolveOperation(method, pathname, status);

    if (!resolved) {
        return null;
    }

    recordCheckedResponse();

    if (!resolved.schema) {
        return {
            operation: resolved.label,
            problems: ["the spec documents no JSON:API body for this status"],
        };
    }

    const document = JSON.parse(body) as JsonApiDocument;
    const properties = resolved.schema.properties as Record<string, Schema> | undefined;
    const narrowed = parseNarrowedTypes(query);
    const includedSchema = (properties?.included as Schema | undefined)?.items as
        | Schema
        | undefined;
    const problems = [
        ...collectDocument(resolved.schema, document),
        ...collectData(properties?.data, document.data, narrowed),
        ...collectIncluded(includedSchema, document.included, narrowed),
    ];

    if (!includedSchema && Array.isArray(document.included) && document.included.length > 0) {
        problems.push("included carries resources the spec declares none of");
    }

    return problems.length > 0 ? { operation: resolved.label, problems } : null;
};
