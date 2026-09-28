/**
 * Emits openapi.json without any running infrastructure.
 *
 * Route modules are not import-clean: util/mikro-orm.ts connects and migrates
 * at import, and util/auth.ts fetches the OIDC discovery document. The first
 * is replaced through a module loader hook (same mechanism as
 * test/setup/worker-db.ts) with a stub that throws on any use; the second is
 * satisfied by a fetch stand-in serving a static discovery document, with any
 * other network access refused.
 */
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const ormModulePattern = /\/src\/util\/mikro-orm\.(?:ts|js)$/;

const ormStubSource = `
const fail = () => {
    throw new Error("Database access attempted during OpenAPI emit");
};
const stub = new Proxy(function () {}, { get: fail, apply: fail });
export const orm = stub;
export const em = stub;
export const maskSearchTerm = stub;
`;

registerHooks({
    load: (url, context, nextLoad) => {
        if (ormModulePattern.test(url)) {
            return {
                format: "module",
                shortCircuit: true,
                source: ormStubSource,
            };
        }

        return nextLoad(url, context);
    },
});

globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);

    if (url.endsWith("/.well-known/openid-configuration")) {
        return Promise.resolve(
            Response.json({
                jwks_uri: "http://localhost/jwks",
                userinfo_endpoint: "http://localhost/userinfo",
            }),
        );
    }

    throw new Error(`Unexpected network access during OpenAPI emit: ${url}`);
};

const { buildOpenapiSpecJson } = await import("../src/route/openapi.js");

writeFileSync("openapi.json", buildOpenapiSpecJson());
console.log("Wrote openapi.json");
