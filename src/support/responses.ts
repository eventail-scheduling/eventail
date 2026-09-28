import { isDeepStrictEqual } from "node:util";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AttributesSchema,
    clientResourceIdentifierSchema,
    type IncludedResourceMap,
    type IncludedResourceSchemas,
    type RelationshipsSchema,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import { type EntityManager, type FilterQuery, LockMode, ref } from "@mikro-orm/core";
import { z } from "zod";
import { CustomField } from "../entity/CustomField.js";
import type { Edition } from "../entity/Edition.js";
import type { Host } from "../entity/Host.js";
import { Response } from "../entity/Response.js";
import type { Session } from "../entity/Session.js";
import type { User } from "../entity/User.js";
import type { FileDescriptorInput, FileUploadHandler } from "./file-upload.js";
import { visibleFingerprint } from "./visible-changes.js";

type ResponseOwner = { session: Session } | { host: Host };

/**
 * Fingerprints the answers of one session or host as an integration sees them.
 *
 * Taken either side of a write, for comparison. A confidential answer never
 * leaves the server, so changing one changes no document and is left out.
 * Ordered by id so the comparison does not turn on row order.
 */
export const visibleResponsesFingerprint = async (
    em: EntityManager,
    owner: ResponseOwner,
): Promise<string> => {
    const responses = await em.find(
        Response,
        { ...owner, customField: { confidential: false } },
        { orderBy: { id: "asc" } },
    );

    return visibleFingerprint(
        responses.map((response) => [response.customField.id, response.value]),
    );
};

export type ResponseVisibility = {
    seesEveryResponse: boolean;
    /** Null for an integration, which never earns a confidential answer. */
    callerUser: User | null;
};

/**
 * Builds a condition rather than making a decision.
 *
 * A list spans sessions the reader hosts and sessions it does not, and one
 * batched load has to be right for both.
 */
export const visibleResponseFilter = (visibility: ResponseVisibility): FilterQuery<Response> => {
    if (visibility.seesEveryResponse) {
        return {};
    }

    const nonConfidential: FilterQuery<Response> = { customField: { confidential: false } };

    if (!visibility.callerUser) {
        return nonConfidential;
    }

    return {
        $or: [
            nonConfidential,
            { session: { hosts: { user: visibility.callerUser } } },
            { host: { user: visibility.callerUser } },
        ],
    };
};

export const includedResponseSchemas = {
    attributesSchema: z.strictObject({
        value: z.unknown(),
    }),
    relationshipsSchema: z.strictObject({
        customField: relationshipSchema(resourceIdentifierSchema("custom_field", z.uuid())),
    }),
} satisfies IncludedResourceSchemas<AttributesSchema, RelationshipsSchema>;

/**
 * Names a stored answer by id to leave it as it is, or a new value by lid.
 *
 * An id is only accepted for an answer the target already owns.
 */
export const responseIdentifierSchema = z.union([
    resourceIdentifierSchema("response", z.uuid()),
    clientResourceIdentifierSchema("response"),
]);
export type ResponseIdentifier = z.output<typeof responseIdentifierSchema>;

type IncludedResponsesMap = IncludedResourceMap<typeof includedResponseSchemas>;
type IncludedResponse = ReturnType<IncludedResponsesMap["get"]>;
type CustomFieldContext = {
    target:
        | {
              type: "session";
              session: Session;
          }
        | {
              type: "host";
              host: Host;
          };
    em: EntityManager;
    fileUploadHandler: FileUploadHandler;
    edition: Edition;
    includedResponses: IncludedResponsesMap;
    responseIdentifiers: ResponseIdentifier[];
    existingResponses: Map<string, Response>;
};
type CustomFieldsMap = Map<string, CustomField>;
/**
 * Replaces the whole answer set rather than patching it.
 *
 * Every applicable custom field of the edition has to be named or the call
 * throws 422 `missing_responses`, except a frozen one with no stored answer,
 * which is never demanded. A stored answer named by id is kept as it is and
 * its value is not validated again; only a value sent by lid is. A frozen
 * field's stored answer can only be kept, so it has to be named by id: leaving
 * it out, or sending a value for a frozen field, is refused with
 * `frozen_response`, whoever sends it. A field scoped away from the session's
 * type or track is never demanded, but a stored answer to it is kept the same
 * way, and leaving it out or sending a value is refused with
 * `inapplicable_response`. A field named twice, by either form, is
 * refused with `duplicate_response`. Holds a read lock on the edition's fields
 * for that target until commit, so it needs an open transaction.
 */
export const updateResponses = async (context: CustomFieldContext): Promise<Response[]> => {
    const responses: Response[] = [];
    const { customFields, inapplicableCustomFieldIds } = await loadCustomFields(context);
    const frozenCustomFieldIds = new Set<string>();

    // Moving them out also exempts them from the missing-responses check below.
    for (const [customFieldId, customField] of customFields) {
        if (customField.frozen) {
            customFields.delete(customFieldId);
            frozenCustomFieldIds.add(customFieldId);
        }
    }

    const namedCustomFieldIds = new Set<string>();

    for (const identifier of context.responseIdentifiers) {
        if ("id" in identifier) {
            const existingResponse = findOwnResponse(context, identifier.id);
            assertNamedOnce(namedCustomFieldIds, existingResponse.customField.id);
            responses.push(
                keepResponse(
                    customFields,
                    frozenCustomFieldIds,
                    inapplicableCustomFieldIds,
                    existingResponse,
                ),
            );
            continue;
        }

        const includedResponse = context.includedResponses.get(identifier.lid);
        assertNamedOnce(namedCustomFieldIds, includedResponse.relationships.customField.data.id);
        responses.push(
            updateResponse(
                context,
                customFields,
                frozenCustomFieldIds,
                inapplicableCustomFieldIds,
                includedResponse,
            ),
        );
    }

    for (const frozenCustomFieldId of frozenCustomFieldIds) {
        if (context.existingResponses.has(frozenCustomFieldId)) {
            throw frozenResponseError(frozenCustomFieldId);
        }
    }

    for (const inapplicableCustomFieldId of inapplicableCustomFieldIds) {
        if (context.existingResponses.has(inapplicableCustomFieldId)) {
            throw inapplicableResponseError(inapplicableCustomFieldId);
        }
    }

    if (customFields.size > 0) {
        throw missingResponsesError([...customFields.keys()]);
    }

    return responses;
};

const missingResponsesError = (missingCustomFieldIds: string[]): JsonApiError =>
    new JsonApiError({
        status: "422",
        code: "missing_responses",
        title: "Missing responses",
        detail: "Not all custom fields have a response",
        meta: {
            missingCustomFieldIds,
        },
    });

type StoredResponsesContext = Pick<CustomFieldContext, "target" | "em" | "edition"> & {
    storedCustomFieldIds: Set<string>;
};

/**
 * Refuses a target left without a stored answer to an unfrozen field that applies to it.
 *
 * For a write that changes the session type or track without sending answers,
 * held to the rule `updateResponses` applies to a sent set: a frozen field is
 * exempt. Takes the same read lock on the edition's fields for that target, so
 * it needs an open transaction.
 */
export const assertStoredResponsesComplete = async (
    context: StoredResponsesContext,
): Promise<void> => {
    const { customFields } = await loadCustomFields(context);
    const missingCustomFieldIds = [...customFields.values()]
        .filter(
            (customField) =>
                !(context.storedCustomFieldIds.has(customField.id) || customField.frozen),
        )
        .map((customField) => customField.id);

    if (missingCustomFieldIds.length > 0) {
        throw missingResponsesError(missingCustomFieldIds);
    }
};
type LoadedCustomFields = {
    customFields: CustomFieldsMap;
    inapplicableCustomFieldIds: Set<string>;
};

const loadCustomFields = async (
    context: Pick<CustomFieldContext, "target" | "em" | "edition">,
): Promise<LoadedCustomFields> => {
    const filterQuery: FilterQuery<CustomField> = { edition: context.edition };

    if (context.target.type === "session") {
        filterQuery.target = "per_proposal";
    } else {
        filterQuery.target = "per_host";
    }

    // The lock is load-bearing beyond the freeze check: held to commit, it
    // conflicts with a confidential flip's PESSIMISTIC_WRITE, which is what
    // excludes the one interleaving where the flip and this writer both skip
    // the bump for the newly visible answer.
    const allCustomFields = await context.em.find(CustomField, filterQuery, {
        lockMode: LockMode.PESSIMISTIC_READ,
        orderBy: { id: "asc" },
    });
    // Populated separately: inside the find, the populate would carry its lock
    // onto the scoping rows and the tracks and session types they join. A track
    // or session type delete holds its row while cascading into the scoping
    // rows, and tracks sit above custom fields in the lock order.
    await context.em.populate(allCustomFields, ["sessionTypes", "tracks"]);

    if (context.target.type !== "session") {
        return {
            customFields: new Map(
                allCustomFields.map((customField) => [customField.id, customField]),
            ),
            inapplicableCustomFieldIds: new Set(),
        };
    }

    const session = context.target.session;
    const customFields: CustomFieldsMap = new Map();
    const inapplicableCustomFieldIds = new Set<string>();

    for (const customField of allCustomFields) {
        if (appliesToSession(customField, session)) {
            customFields.set(customField.id, customField);
        } else {
            inapplicableCustomFieldIds.add(customField.id);
        }
    }

    return { customFields, inapplicableCustomFieldIds };
};

const appliesToSession = (customField: CustomField, session: Session): boolean => {
    const matchesSessionType =
        customField.sessionTypes.length === 0 ||
        customField.sessionTypes.exists((sessionType) => sessionType.id === session.sessionType.id);
    const matchesTrack =
        customField.tracks.length === 0 ||
        (session.track !== null &&
            customField.tracks.exists((track) => track.id === session.track?.id));

    return matchesSessionType && matchesTrack;
};
const frozenResponseError = (customFieldId: string): JsonApiError =>
    new JsonApiError({
        status: "422",
        code: "frozen_response",
        title: "Frozen response",
        detail: "The custom field no longer accepts responses",
        meta: {
            customFieldId,
        },
    });

const inapplicableResponseError = (customFieldId: string): JsonApiError =>
    new JsonApiError({
        status: "422",
        code: "inapplicable_response",
        title: "Inapplicable response",
        detail: "The custom field does not apply to this session",
        meta: {
            customFieldId,
        },
    });

const findOwnResponse = (context: CustomFieldContext, responseId: string): Response => {
    const existingResponse = [...context.existingResponses.values()].find(
        (response) => response.id === responseId,
    );

    if (!existingResponse) {
        throw new JsonApiError({
            status: "422",
            code: "unknown_response",
            title: "Unknown response",
            detail: "The response does not belong to this target",
            meta: {
                responseId,
            },
        });
    }

    return existingResponse;
};

const assertNamedOnce = (namedCustomFieldIds: Set<string>, customFieldId: string): void => {
    if (namedCustomFieldIds.has(customFieldId)) {
        throw new JsonApiError({
            status: "422",
            code: "duplicate_response",
            title: "Duplicate response",
            detail: "The custom field is answered more than once",
            meta: {
                customFieldId,
            },
        });
    }

    namedCustomFieldIds.add(customFieldId);
};

const keepResponse = (
    customFields: CustomFieldsMap,
    frozenCustomFieldIds: Set<string>,
    inapplicableCustomFieldIds: Set<string>,
    existingResponse: Response,
): Response => {
    const customFieldId = existingResponse.customField.id;

    if (inapplicableCustomFieldIds.delete(customFieldId)) {
        return existingResponse;
    }

    if (!frozenCustomFieldIds.delete(customFieldId)) {
        customFields.delete(customFieldId);
    }

    return existingResponse;
};

const updateResponse = (
    context: CustomFieldContext,
    customFields: CustomFieldsMap,
    frozenCustomFieldIds: Set<string>,
    inapplicableCustomFieldIds: Set<string>,
    includedResponse: IncludedResponse,
): Response => {
    const customFieldId = includedResponse.relationships.customField.data.id;

    if (inapplicableCustomFieldIds.has(customFieldId)) {
        throw inapplicableResponseError(customFieldId);
    }

    if (frozenCustomFieldIds.has(customFieldId)) {
        throw frozenResponseError(customFieldId);
    }

    const customField = customFields.get(customFieldId);

    if (!customField) {
        throw new JsonApiError({
            status: "422",
            code: "unknown_custom_field",
            title: "Unknown custom field",
            detail: "The custom field does not exist for this edition and target",
            meta: {
                customFieldId,
            },
        });
    }

    const existingResponse = context.existingResponses.get(customField.id);
    const parseResult = customField
        .getResponseSchema()
        .safeParse(includedResponse.attributes.value);

    if (!parseResult.success) {
        // One error per issue, the way the library reports a body it parsed
        // itself. Collapsing them tells a form only that the field is wrong,
        // never whether the value was too long, outside the choices or the
        // wrong shape, which is the part it has to render.
        throw new JsonApiError(
            parseResult.error.issues.map((issue) => ({
                status: "422",
                code: "invalid_responses",
                title: "Invalid responses",
                detail: issue.message,
                meta: {
                    customFieldId: customField.id,
                    // Empty for a scalar answer; the index or key inside a
                    // multi-value one.
                    path: issue.path.map((segment) => segment.toString()),
                },
            })),
        );
    }

    customFields.delete(customField.id);
    let responseValue = parseResult.data;

    if (customField.options.type === "file") {
        let pathPrefix: string;

        if (context.target.type === "session") {
            pathPrefix = `${context.edition.id}/sessions/${context.target.session.id}/responses`;
        } else {
            pathPrefix = `${context.edition.id}/hosts/${context.target.host.id}/responses`;
        }

        responseValue = context.fileUploadHandler.add(
            { customFieldId: customField.id },
            pathPrefix,
            responseValue as FileDescriptorInput | null,
        );
    }

    if (existingResponse) {
        if (!isDeepStrictEqual(existingResponse.value, responseValue)) {
            existingResponse.value = responseValue;
            context.em.persist(existingResponse);
        }

        return existingResponse;
    }

    const response =
        context.target.type === "host"
            ? Response.hostResponse(ref(customField), ref(context.target.host), responseValue)
            : Response.sessionResponse(
                  ref(customField),
                  ref(context.target.session),
                  responseValue,
              );

    context.em.persist(response);
    return response;
};
