import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import { buildResourceRequestContentObject } from "@jsonapi-serde/openapi";
import {
    type ClientResourceIdentifierSchema,
    clientResourceIdentifierSchema,
    type IncludedTypeSchemas,
    type IncludedTypesContainer,
    type RelationshipSchema,
    type ResourceIdentifierSchema,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import { type Extractor, extension } from "@taxum/core/extract";
import type { ContentObject } from "openapi3-ts/oas31";
import { z } from "zod";
import { Edition } from "../../../entity/Edition.js";
import { includedResponseSchemas, responseIdentifierSchema } from "../../../support/responses.js";
import {
    createSessionFieldAttributeSchemas,
    createSessionFieldRelationshipSchemas,
    type SessionFieldAttributeNames,
    type SessionFieldAttributeSchemas,
    type SessionFieldOptions,
    type SessionFieldRelationshipNames,
    type SessionFieldRelationshipSchemas,
} from "../../../support/session-fields.js";
import { EDITION } from "../resolve-edition-layer.js";

const sessionFieldAttributeNames = [
    "title",
    "abstract",
    "description",
    "notes",
    "duration",
    "setupTime",
    "teardownTime",
    "teaserImage",
] as const satisfies SessionFieldAttributeNames[];
const sessionFieldRelationshipNames = ["track"] as const satisfies SessionFieldRelationshipNames[];

type SessionAttributesSchema = z.ZodObject<
    SessionFieldAttributeSchemas<(typeof sessionFieldAttributeNames)[number]>
>;

export type SessionRelationshipsSchema = z.ZodObject<
    {
        sessionType: RelationshipSchema<ResourceIdentifierSchema<"session_type">>;
        responses: RelationshipSchema<z.ZodArray<ClientResourceIdentifierSchema<"response">>>;
    } & SessionFieldRelationshipSchemas<(typeof sessionFieldRelationshipNames)[number]>
>;

type SessionMetaSchema = z.ZodType<{
    selfService: boolean;
}>;

const includedTypeSchemas = {
    response: includedResponseSchemas,
} satisfies IncludedTypeSchemas;

type IncludedTypes = IncludedTypesContainer<typeof includedTypeSchemas>;

type SessionSchemas = {
    attributesSchema: SessionAttributesSchema;
    relationshipsSchema: SessionRelationshipsSchema;
    metaSchema: SessionMetaSchema;
};

const createSessionSchemas = (edition: Edition, staleWhenMissing: boolean): SessionSchemas => {
    const attributesSchema = z.strictObject({
        ...createSessionFieldAttributeSchemas(
            sessionFieldAttributeNames,
            edition,
            staleWhenMissing,
        ),
    });

    const relationshipsSchema = z.strictObject({
        sessionType: relationshipSchema(resourceIdentifierSchema("session_type", z.uuid())),
        responses: relationshipSchema(z.array(clientResourceIdentifierSchema("response"))),
        ...createSessionFieldRelationshipSchemas(
            sessionFieldRelationshipNames,
            edition,
            staleWhenMissing,
        ),
    });

    return {
        attributesSchema,
        relationshipsSchema,
        metaSchema: z
            .strictObject({
                selfService: z.boolean().default(false),
            })
            .prefault({}),
    };
};

const editionExtractor = extension(EDITION, true);

type RuntimeSchemaExtractorResult = {
    attributes: z.output<SessionAttributesSchema>;
    relationships: z.output<SessionRelationshipsSchema>;
    meta: z.output<SessionMetaSchema>;
    includedTypes: IncludedTypes;
};

export const createRuntimeSchemaExtractor =
    (idPathParam?: string): Extractor<RuntimeSchemaExtractorResult> =>
    async (req) => {
        const edition = await editionExtractor(req);
        const { attributesSchema, relationshipsSchema, metaSchema } = createSessionSchemas(
            edition,
            true,
        );

        const extractor = jsonApiResource(
            {
                type: "session",
                attributesSchema,
                relationshipsSchema,
                metaSchema,
                includedTypeSchemas,
            },
            idPathParam,
        );
        return extractor(req);
    };

/**
 * Makes every relationship optional and lets a stored answer be named by id.
 */
const toPartialRelationshipsSchema = (relationshipsSchema: SessionRelationshipsSchema) =>
    relationshipsSchema.partial().extend({
        responses: z.optional(relationshipSchema(z.array(responseIdentifierSchema))),
    });

/**
 * Builds the same schemas with every member optional, for the update route.
 *
 * A member left out keeps its current value (JSON:API 1.1, "Updating a
 * Resource's Attributes" and "Updating a Resource's Relationships").
 */
const createPartialSessionSchemas = (edition: Edition) => {
    const { attributesSchema, relationshipsSchema, metaSchema } = createSessionSchemas(
        edition,
        false,
    );

    return {
        // Optional twice over: the member itself may be absent, and so may any
        // of its keys.
        attributesSchema: z.optional(attributesSchema.partial()),
        relationshipsSchema: z.optional(toPartialRelationshipsSchema(relationshipsSchema)),
        metaSchema,
    };
};

export type PartialSessionRelationships = z.output<
    ReturnType<typeof createPartialSessionSchemas>["relationshipsSchema"]
>;

export type PartialSchemaExtractorResult = {
    attributes: z.output<ReturnType<typeof createPartialSessionSchemas>["attributesSchema"]>;
    relationships: PartialSessionRelationships;
    meta: z.output<SessionMetaSchema>;
    includedTypes: IncludedTypes;
};

export const createPartialRuntimeSchemaExtractor =
    (idPathParam: string): Extractor<PartialSchemaExtractorResult> =>
    async (req) => {
        const edition = await editionExtractor(req);
        const { attributesSchema, relationshipsSchema, metaSchema } =
            createPartialSessionSchemas(edition);

        const extractor = jsonApiResource(
            {
                type: "session",
                attributesSchema,
                relationshipsSchema,
                metaSchema,
                includedTypeSchemas,
            },
            idPathParam,
        );

        return extractor(req) as Promise<PartialSchemaExtractorResult>;
    };

const documentedFieldOptions: SessionFieldOptions = {
    abstract: { requirement: "optional" },
    description: { requirement: "optional" },
    notes: { requirement: "optional" },
    track: { requirement: "optional" },
    duration: { requirement: "optional" },
    setupTime: { requirement: "optional" },
    teardownTime: { requirement: "optional" },
    teaserImage: { requirement: "optional" },
};

const documentedSchemas = createSessionSchemas(
    new Edition({
        name: "Documentation",
        startDate: Temporal.PlainDate.from("2000-01-01"),
        endDate: Temporal.PlainDate.from("2000-12-31"),
        timeZone: "UTC",
        submissionDeadline: null,
        sessionFieldOptions: documentedFieldOptions,
    }),
    false,
);

export const createSessionRequestContent: ContentObject = buildResourceRequestContentObject({
    type: "session",
    ...documentedSchemas,
    includedTypeSchemas,
});

export const updateSessionRequestContent: ContentObject = buildResourceRequestContentObject({
    type: "session",
    idSchema: z.uuid(),
    ...documentedSchemas,
    attributesSchema: z.optional(documentedSchemas.attributesSchema.partial()),
    relationshipsSchema: z.optional(
        toPartialRelationshipsSchema(documentedSchemas.relationshipsSchema),
    ),
    includedTypeSchemas,
});
