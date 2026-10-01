if (typeof Temporal === "undefined") {
    await import("temporal-polyfill/global");
}

await import("./main.js");
