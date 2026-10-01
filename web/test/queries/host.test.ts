import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHostQueryOptionsFactory } from "#/queries/host.ts";

beforeAll(() => {
    // The unit project runs in node, where the setup file's window guard skips.
    vi.stubGlobal("window", { RUNTIME_ENV: { API_URL: "https://api.test/" } });
});

/**
 * What the organizer's read carries for a caller below manager.
 *
 * The API drops `availabilities` from the field set rather than sending it
 * empty, so the client has to treat the member as absent. Requiring it would
 * show every team viewer an error card on the organizer's host page.
 *
 * This is a claim about the client tolerating a shape, not about what the API
 * sends: agreement with the API is something a fixture cannot keep true, and the
 * integration test is what will own that.
 */
const belowManagerDocument = {
    jsonapi: { version: "1.1" },
    data: {
        id: "01a03ac9-4881-741f-9201-7ebae957493c",
        type: "host",
        attributes: {
            displayName: "Test User",
            biography: "Writes things",
            avatar: null,
        },
        relationships: {
            responses: {
                data: [{ type: "response", id: "01a03ac9-4894-7088-8f4c-de4529c8614d" }],
            },
        },
    },
    included: [
        {
            id: "01a03ac9-4894-7088-8f4c-de4529c8614d",
            type: "response",
            attributes: { value: "Fable" },
            relationships: {
                customField: {
                    data: { type: "custom_field", id: "01a03ac9-484e-726c-9710-46e86e991e45" },
                },
            },
        },
    ],
};

// biome-ignore lint/suspicious/noExplicitAny: driving a queryFn outside React
const run = (options: any) => options.queryFn({ signal: new AbortController().signal });

describe("the host an organizer reads", () => {
    it("parses a document that carries no availabilities at all", async () => {
        const factory = createHostQueryOptionsFactory(
            async () =>
                new Response(JSON.stringify(belowManagerDocument), {
                    status: 200,
                    headers: { "Content-Type": "application/vnd.api+json" },
                }),
        );

        const host = await run(factory.get("edition-1", "host-1", false));

        expect(host.availabilities).toBeUndefined();
        // Asserted so a document that failed to yield anything useful cannot
        // pass by having no availabilities either.
        expect(host.displayName).toBe("Test User");
        expect(host.responses[0].value).toBe("Fable");
    });
});
