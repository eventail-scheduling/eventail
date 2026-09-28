import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConfigJsonSchema, type JsonSchemaNode } from "../../src/util/config-json-schema.js";

const objectsWithoutDescription = (node: JsonSchemaNode, path: string[]): string[] => {
    if (node.properties === undefined) {
        return [];
    }

    const own = path.length > 0 && node.description === undefined ? [path.join(".")] : [];

    return [
        ...own,
        ...Object.entries(node.properties).flatMap(([key, child]) =>
            objectsWithoutDescription(child, [...path, key]),
        ),
    ];
};

describe("buildConfigJsonSchema", () => {
    it("represents every setting", () => {
        assert.doesNotThrow(() => buildConfigJsonSchema());
    });

    // Objects are the sections of the configuration reference, which say what
    // their settings are for; leaves are described only where the name does
    // not say it all, which no test can judge.
    it("describes every object", () => {
        assert.deepEqual(objectsWithoutDescription(buildConfigJsonSchema(), []), []);
    });
});
