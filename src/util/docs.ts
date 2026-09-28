import type { SchemaObject } from "openapi3-ts/oas31";

export const buildDurationSchemaObject = (nullable = false): SchemaObject => {
    const baseSchema: SchemaObject = {
        type: "string",
        title: "Duration",
        format: "duration",
        example: "PT1H",
    };

    if (!nullable) {
        return baseSchema;
    }

    return {
        oneOf: [baseSchema, { type: "null" }],
    };
};
