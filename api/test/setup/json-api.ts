import assert from "node:assert/strict";
import type { TestRequest, TestResponse } from "@taxum/testing";
import { testClient } from "@taxum/testing";
import { router } from "../../src/app.js";
import { ContractLayer } from "./contract-layer.js";

const JSON_API_MEDIA_TYPE = "application/vnd.api+json";

const contractRouter = new ContractLayer().layer(router);

const request = (method: "get" | "delete" | "post", path: string, token: string): TestRequest =>
    testClient(contractRouter)
        [method](path)
        .header("accept", JSON_API_MEDIA_TYPE)
        .header("authorization", `Bearer ${token}`);

const requestWithDocument = (
    method: "post" | "patch" | "put" | "delete",
    path: string,
    token: string,
    document: unknown,
): TestRequest<true> =>
    testClient(contractRouter)
        [method](path)
        .header("accept", JSON_API_MEDIA_TYPE)
        .header("content-type", JSON_API_MEDIA_TYPE)
        .header("authorization", `Bearer ${token}`)
        .body(JSON.stringify(document));

function deleteRequest(path: string, token: string): TestRequest;
function deleteRequest(path: string, token: string, document: unknown): TestRequest<true>;
function deleteRequest(
    path: string,
    token: string,
    document?: unknown,
): TestRequest | TestRequest<true> {
    return document === undefined
        ? request("delete", path, token)
        : requestWithDocument("delete", path, token, document);
}

function postRequest(path: string, token: string): TestRequest;
function postRequest(path: string, token: string, document: unknown): TestRequest<true>;
function postRequest(
    path: string,
    token: string,
    document?: unknown,
): TestRequest | TestRequest<true> {
    return document === undefined
        ? request("post", path, token)
        : requestWithDocument("post", path, token, document);
}

/**
 * Sends a JSON:API request through the contract-checked router.
 *
 * Every 2xx response with a body, on a path the spec describes, is validated
 * against it, so a test that asserts nothing about the body can still fail on a
 * schema mismatch.
 */
export const jsonApi = {
    get: (path: string, token: string): TestRequest => request("get", path, token),
    post: postRequest,
    patch: (path: string, token: string, document: unknown): TestRequest<true> =>
        requestWithDocument("patch", path, token, document),
    put: (path: string, token: string, document: unknown): TestRequest<true> =>
        requestWithDocument("put", path, token, document),
    delete: deleteRequest,
};

/**
 * Starts the send now, rather than when the result is first awaited.
 *
 * A TestRequest is a thenable that sends on its first `then`, so a test racing
 * two requests has to subscribe to each before it can wait on either.
 */
export const send = (request: PromiseLike<TestResponse>): Promise<TestResponse> =>
    Promise.resolve(request);

type AttributeBearing = {
    attributes?: Record<string, unknown>;
};

/**
 * Asserts the resources arrived without an attributes member at all.
 *
 * A fieldset naming only fields the reader may not see intersects the visible
 * set to nothing, and the resource is then served without attributes rather
 * than with an empty object.
 */
export const expectNoAttributes = (resources: (AttributeBearing | undefined)[]): void => {
    assert.ok(resources.length > 0);

    for (const resource of resources) {
        assert.ok(resource);
        assert.equal(resource.attributes, undefined);
    }
};

type ErrorDocument = {
    errors: { code: string }[];
};

export const expectJsonApiError = async (
    response: TestResponse,
    status: number,
    code: string,
): Promise<void> => {
    assert.equal(response.status, status);
    const document = await response.json<ErrorDocument>();
    assert.equal(document.errors[0]?.code, code);
};
