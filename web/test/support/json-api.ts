/** Answers with a 200 carrying a JSON:API document, as the API does on success. */
export const answered = (document: unknown): Response =>
    new Response(JSON.stringify(document), {
        status: 200,
        headers: { "Content-Type": "application/vnd.api+json" },
    });
