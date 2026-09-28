import { type LinkSchemaObjects, linkStringSchemaObject } from "@jsonapi-serde/openapi";
import type { ParameterObject, ResponseObject, SchemaObject } from "openapi3-ts/oas31";

export const createUuidPathParameter = (name: string): ParameterObject => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
});

export const paginationLinkSchemaObjects: LinkSchemaObjects = {
    first: linkStringSchemaObject,
    prev: linkStringSchemaObject,
    next: linkStringSchemaObject,
};

export const noContentResponseObject: ResponseObject = {
    description: "No content",
};

export const imageFileDescriptorSchemaObject: SchemaObject = {
    type: ["object", "null"],
    properties: {
        key: { type: "string" },
        filename: { type: "string" },
        url: { type: "string", format: "uri" },
        thumbnailUrl: { type: "string", format: "uri" },
        processing: {
            type: "boolean",
            description:
                "True while the uploaded original is still what both urls serve. A downscaled" +
                " version replaces them shortly after, so a poller can skip fetching the image" +
                " until this turns false.",
        },
    },
    required: ["key", "filename", "url", "thumbnailUrl", "processing"],
    additionalProperties: false,
};

export const imageRefusalCodes =
    "unsupported_image_type, image_type_mismatch, image_file_too_large, image_too_small, " +
    "image_too_large, aspect_ratio_mismatch, animated_image";
