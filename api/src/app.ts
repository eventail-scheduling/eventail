import "@jsonapi-serde/integration-taxum/augment";
import assert from "node:assert";
import {
    jsonApiErrorHandler,
    jsonApiMediaTypesLayer,
    methodNotAllowedHandler,
    notFoundHandler,
} from "@jsonapi-serde/integration-taxum";
import { RequestContext } from "@mikro-orm/core";
import { type HttpRequest, jsonResponse } from "@taxum/core/http";
import { setLoggerProxy } from "@taxum/core/logging";
import { ServiceBuilder } from "@taxum/core/middleware/builder";
import { CorsLayer } from "@taxum/core/middleware/cors";
import { REQUEST_ID } from "@taxum/core/middleware/request-id";
import { m, Router } from "@taxum/core/routing";
import type { HttpService } from "@taxum/core/service";
import { registerRoutes } from "./route/index.js";
import { registerOpenapiRoutes } from "./route/openapi.js";
import { appConfig } from "./util/app-config.js";
import { jwtLayer, jwtPayloadLayer } from "./util/auth.js";
import { contractVersion, contractVersionHeader } from "./util/contract-version.js";
import { logger } from "./util/logger.js";
import { em } from "./util/mikro-orm.js";

setLoggerProxy({
    fatal: (message, values) => logger.fatal(message, values),
    error: (message, values) => logger.error(message, values),
    warn: (message, values) => logger.warn(message, values),
    info: (message, values) => logger.info(message, values),
    debug: (message, values) => logger.debug(message, values),
    trace: (message, values) => logger.debug(message, values),
});

export const router = new Router();
registerRoutes(router);

router
    .errorHandler(
        jsonApiErrorHandler({
            logError: (error, exposed) => {
                if (!exposed) {
                    logger.error("Failed to serve request", { error });
                }
            },
        }),
    )
    .fallback(notFoundHandler)
    .methodNotAllowedFallback(methodNotAllowedHandler)
    .layer(
        ServiceBuilder.create()
            .compression()
            .insertResponseHeaderIfNotPresent(
                "Cache-Control",
                "no-store, no-cache, private, max-age=0",
            )
            .overrideResponseHeader(contractVersionHeader, String(contractVersion))
            .catchError()
            .withLayer(jsonApiMediaTypesLayer)
            .setRequestId()
            .propagateRequestId()
            .traceHttp()
            .requestBodyLimit(5 * 1024 * 1024)
            .fromFn((req: HttpRequest, next: HttpService) => {
                const requestId = req.extensions.get(REQUEST_ID);
                assert(requestId);

                return logger.withContext({ requestId }, async () => await next.invoke(req));
            })
            .withLayer(
                CorsLayer.veryPermissive()
                    .allowOrigin(appConfig.cors.origin)
                    .exposeHeaders([contractVersionHeader])
                    .maxAge(86400),
            )
            .catchError()
            .withLayer(jwtLayer)
            .fromFn((req: HttpRequest, next: HttpService) => {
                return RequestContext.create(em, async () => await next.invoke(req));
            })
            .withLayer(jwtPayloadLayer),
    )
    .route(
        "/health",
        m.get(() => jsonResponse({ status: "alive" })),
    );

// Registered after the layer above so the docs, like the health check, do not
// sit behind the token they document how to obtain.
if (process.env.NODE_ENV !== "production") {
    registerOpenapiRoutes(router);
}
