import { buildDataResponseObject, buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import { JsonApiDocument } from "@jsonapi-serde/server/common";
import { m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";

const getClockHandler = () =>
    new JsonApiDocument({
        data: {
            type: "clock",
            id: "now",
            attributes: {
                time: Temporal.Now.instant().toString(),
            },
        },
    });

export const clockRouter = new Router().route("/now", m.get(getClockHandler));

export const addOpenapiClockPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/clock/now", {
        get: {
            tags: ["Clock"],
            operationId: "getClock",
            summary: "Read the server's clock",
            description:
                "Answers with the server's current time, which a client measures its own clock" +
                " against so that deadlines and freezes fall when the server applies them. Open" +
                " to any authenticated subject.",
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: buildResourceSchemaObject({
                        type: "clock",
                        id: { type: "string", const: "now" },
                        attributes: {
                            type: "object",
                            properties: {
                                time: { type: "string", format: "date-time" },
                            },
                            required: ["time"],
                            additionalProperties: false,
                        },
                    }),
                }),
            },
        },
    });
};
