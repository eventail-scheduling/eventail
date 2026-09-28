import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { referencedKeysStatement } from "../../../src/worker/maintenance/file-pruner.js";

const entityDirectory = path.join(import.meta.dirname, "../../../src/entity");

const propertyPattern = /^ {4}public (?:readonly )?(\w+)\??: (Image)?FileDescriptor\b/;

type DescriptorProperty = {
    table: string;
    column: string;
    image: boolean;
};

const snakeCase = (value: string): string =>
    value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const findDescriptorProperties = (): DescriptorProperty[] => {
    const properties: DescriptorProperty[] = [];

    for (const filename of readdirSync(entityDirectory, { recursive: true, encoding: "utf8" })) {
        if (!filename.endsWith(".ts")) {
            continue;
        }

        const source = readFileSync(path.join(entityDirectory, filename), "utf8");

        for (const line of source.split("\n")) {
            const matched = propertyPattern.exec(line);

            if (matched) {
                properties.push({
                    table: snakeCase(path.basename(filename, ".ts")).replace(/^_/, ""),
                    column: snakeCase(matched[1] ?? ""),
                    image: matched[2] !== undefined,
                });
            }
        }
    }

    return properties;
};

describe("file pruner reference registry", () => {
    // Every FileDescriptor-typed entity property must contribute its keys to
    // the pruner's reference statement, or the sweep deletes live files. A
    // new file-bearing field fails here until the statement covers it.
    it("covers every descriptor-typed entity property", () => {
        const properties = findDescriptorProperties();

        assert.ok(properties.length >= 1, "the scan found no descriptor properties");

        for (const property of properties) {
            const label = `${property.table}.${property.column}`;

            assert.match(
                referencedKeysStatement,
                new RegExp(`FROM "${property.table}"`),
                `${label} table missing from the reference statement`,
            );
            assert.match(
                referencedKeysStatement,
                new RegExp(`"${property.column}"->>'key'`),
                `${label} key missing from the reference statement`,
            );

            if (property.image) {
                assert.match(
                    referencedKeysStatement,
                    new RegExp(`"${property.column}"->>'thumbnailKey'`),
                    `${label} thumbnailKey missing from the reference statement`,
                );
            }
        }
    });

    it("covers file responses while the custom field type exists", () => {
        const customFieldsSource = readFileSync(
            path.join(import.meta.dirname, "../../../src/support/custom-fields.ts"),
            "utf8",
        );

        assert.match(customFieldsSource, /file: fileCustomFieldSpec/);
        assert.match(referencedKeysStatement, /FROM "response"/);
    });
});
