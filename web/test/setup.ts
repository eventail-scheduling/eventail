import { z } from "zod/mini";

if (typeof Temporal === "undefined") {
    await import("temporal-polyfill/global");
}

z.config(z.locales.en());

if (typeof window !== "undefined") {
    window.RUNTIME_ENV = {
        API_URL: "https://api.test/",
        OIDC_CLIENT_ID: "test",
        OIDC_SCOPES: "",
        OIDC_AUTHORITY: "https://oidc.test/",
        OIDC_AUDIENCE: "test",
    };
}
