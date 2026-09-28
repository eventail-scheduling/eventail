import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { Body, type HttpRequest, type HttpResponse } from "@taxum/core/http";
import type { HttpLayer } from "@taxum/core/layer";
import type { HttpService } from "@taxum/core/service";
import { checkResponseContract } from "./openapi-contract.js";

const readBody = async (response: HttpResponse): Promise<Buffer> => {
    const chunks: Uint8Array[] = [];

    for await (const chunk of response.body.readable) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
};

class ContractService implements HttpService {
    private readonly inner: HttpService;

    public constructor(inner: HttpService) {
        this.inner = inner;
    }

    public async invoke(req: HttpRequest): Promise<HttpResponse> {
        const method = req.method.value;
        const path = `${req.uri.pathname}${req.uri.search}`;
        const response = await this.inner.invoke(req);
        const buffered = await readBody(response);
        response.body = Body.from(buffered);

        const failure = checkResponseContract(
            method,
            path,
            response.status.code,
            buffered.toString("utf8"),
        );

        assert.equal(
            failure,
            null,
            failure === null
                ? ""
                : `Response does not match its OpenAPI schema.\n  ${failure.operation}\n` +
                      failure.problems.map((problem) => `    ${problem}`).join("\n"),
        );

        return response;
    }
}

/**
 * Fails any test whose response contradicts the schema the spec publishes.
 *
 * Wrapping the router rather than each request covers everything sent through
 * `jsonApi`, whichever method builds it. A test that calls `testClient(router)`
 * directly bypasses the check. The body is buffered and put back, because
 * reading it here would otherwise leave the caller an empty stream.
 */
export class ContractLayer implements HttpLayer {
    public layer(inner: HttpService): HttpService {
        return new ContractService(inner);
    }
}
