import type { Relationships } from "@jsonapi-serde/client";
import { z } from "zod/mini";

export const responseAttributesSchema = z.object({
    value: z.unknown(),
});

export const responseRelationships = {
    customField: {
        type: "custom_field",
        cardinality: "one",
    },
} satisfies Relationships;
