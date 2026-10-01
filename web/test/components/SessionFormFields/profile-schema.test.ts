import { describe, expect, it } from "vitest";
import { buildResponseValues } from "#/components/CustomFieldInput/index.ts";
import {
    applicableHostFields,
    createProfileDefaultValues,
    createSessionSchema,
} from "#/components/SessionFormFields/index.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition } from "#/queries/edition.ts";
import type { Host } from "#/queries/host.ts";

const hostField = (id: string): CustomField =>
    ({
        id,
        target: "per_host",
        requirement: "always_optional",
        freezeAfter: null,
        options: { type: "single_line_text" },
        answerMaxLength: 200,
        sessionTypes: [],
        tracks: [],
    }) as unknown as CustomField;

const edition = (): Edition =>
    ({
        sessionFieldOptions: { title: {}, sessionType: {} },
        profileFieldOptions: { biography: { requirement: "optional" } },
    }) as unknown as Edition;

type HostResponse = {
    customFieldId: string;
    value: unknown;
};

const host = (responses: HostResponse[]): Host =>
    ({
        displayName: "Test Host",
        emailAddress: "host@example.test",
        biography: "A biography",
        avatar: null,
        availabilities: [],
        responses: responses.map(({ customFieldId, value }) => ({
            customField: { id: customFieldId },
            value,
        })),
    }) as unknown as Host;

describe("the profile branch", () => {
    it("carries a host answer from the record into the form", () => {
        const fields = applicableHostFields([hostField("aaa")]);
        const values = createProfileDefaultValues({
            host: host([{ customFieldId: "aaa", value: "they/them" }]),
            hostCustomFields: fields,
        });

        expect(values.responses).toEqual({ aaa: "they/them" });
    });

    it("keeps a host answer through the schema on the way out", () => {
        const fields = applicableHostFields([hostField("aaa")]);
        const schema = createSessionSchema(edition(), [], fields);

        const parsed = schema.parse({
            sessionType: { id: "type-1" },
            title: "A session",
            responses: {},
            profile: {
                displayName: "Test Host",
                emailAddress: "host@example.test",
                biography: "A biography",
                responses: { aaa: "they/them" },
            },
        });

        expect(parsed.profile?.responses).toEqual({ aaa: "they/them" });
        expect(buildResponseValues(fields, parsed.profile?.responses ?? {})).toEqual({
            aaa: "they/them",
        });
    });
});

describe("the profile address", () => {
    it("takes one email address and nothing else", () => {
        const schema = createSessionSchema(edition(), [], []);
        const withAddress = (emailAddress: string) =>
            schema.safeParse({
                sessionType: { id: "type-1" },
                title: "A session",
                responses: {},
                profile: {
                    displayName: "Test Host",
                    emailAddress,
                    biography: "A biography",
                    responses: {},
                },
            }).success;

        expect(withAddress("host@example.test")).toBe(true);
        expect(withAddress("a@x.example, b@y.example")).toBe(false);
        expect(withAddress("alice@example,com")).toBe(false);
    });
});

describe("applicableHostFields", () => {
    const frozen = {
        ...hostField("frozen"),
        freezeAfter: Temporal.Now.instant().subtract({ hours: 1 }),
    };

    it("drops a frozen question", () => {
        expect(applicableHostFields([hostField("open"), frozen]).map(({ id }) => id)).toEqual([
            "open",
        ]);
    });
});
