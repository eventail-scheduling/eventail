import { describe, expect, it } from "vitest";
import { createSessionSchema } from "#/components/SessionFormFields/schema.ts";
import {
    buildSessionFormSteps,
    firstInvalidStep,
    followingStepIndex,
    type SessionFormGroup,
    stepFieldNames,
} from "#/components/SessionFormFields/steps.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition, SessionFieldSpec } from "#/queries/edition.ts";
import { formResolver } from "#/utils/zod.ts";

const specs: Record<string, SessionFieldSpec> = {
    title: { label: "Title", forceRequired: true, type: "string" },
    sessionType: { label: "Session type", forceRequired: true, type: "relationship" },
    abstract: { label: "Abstract", forceRequired: false, type: "string" },
    notes: { label: "Notes", forceRequired: false, type: "string" },
    teaserImage: { label: "Teaser image", forceRequired: false, type: "file" },
};

const edition = (
    sessionFieldOptions: Edition["sessionFieldOptions"],
    profileFieldOptions: Edition["profileFieldOptions"] = {},
): Edition => ({ sessionFieldOptions, profileFieldOptions }) as Edition;

const profileSpecs: Record<string, SessionFieldSpec> = {
    displayName: { label: "Display name", forceRequired: true, type: "string" },
    emailAddress: { label: "Email address", forceRequired: true, type: "string" },
    biography: { label: "Biography", forceRequired: false, type: "string" },
    availability: { label: "Availability", forceRequired: false, type: "availability" },
};

const customField = (id: string): CustomField => ({ id }) as CustomField;

const groupsOf = (
    steps: ReturnType<typeof buildSessionFormSteps>,
    path: string,
): Pick<SessionFormGroup, "heading" | "fields">[] =>
    (steps.find((step) => step.path === path)?.groups ?? []).map(({ heading, fields }) => ({
        heading,
        fields,
    }));

const namesOf = (steps: ReturnType<typeof buildSessionFormSteps>, index: number): string[] => {
    const step = steps[index];

    return step ? stepFieldNames(step) : [];
};

describe("buildSessionFormSteps", () => {
    it("orders the session step by the organizer's positions", () => {
        const steps = buildSessionFormSteps({
            edition: edition({
                title: { position: 3 },
                sessionType: { position: 2 },
                notes: { requirement: "optional", position: 1 },
                abstract: { requirement: "required", position: 0 },
            }),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(namesOf(steps, 0)).toEqual(["abstract", "notes", "sessionType", "title"]);
    });

    it("asks for a force-required field with no options entry of its own", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional", position: 1 } }),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(namesOf(steps, 0)).toEqual(["title", "sessionType", "abstract"]);
    });

    it("drops a step nobody is asked anything on", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(steps.map((step) => step.path)).toEqual(["session", "profile"]);
    });

    // Nothing to switch off: the display name and the address are force
    // required, so there is no edition that asks a speaker for nothing at all.
    it("keeps the profile step for an edition that configures no profile field", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }, {}),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(namesOf(steps, 1)).toEqual(["profile.displayName", "profile.emailAddress"]);
    });

    it("orders the profile step by the organizer's positions", () => {
        const steps = buildSessionFormSteps({
            edition: edition(
                { abstract: { requirement: "optional" } },
                {
                    displayName: { position: 2 },
                    emailAddress: { position: 1 },
                    biography: { requirement: "optional", position: 0 },
                },
            ),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(namesOf(steps, 1)).toEqual([
            "profile.biography",
            "profile.emailAddress",
            "profile.displayName",
        ]);
    });

    it("asks a speaker to draw only where the edition asks for availability", () => {
        const steps = buildSessionFormSteps({
            edition: edition(
                { abstract: { requirement: "optional" } },
                { availability: { requirement: "optional" } },
            ),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(namesOf(steps, 1)).toContain("profile.availability");
    });

    it("keeps the custom field step once a field applies", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [customField("aaa"), customField("bbb")],
        });

        expect(steps.map((step) => step.path)).toEqual(["session", "more-info", "profile"]);
        expect(namesOf(steps, 1)).toEqual(["responses.aaa", "responses.bbb"]);
    });

    it("heads the two kinds of question apart and writes them to different resources", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }),
            specs,
            profileSpecs,
            customFields: [customField("aaa")],
            hostCustomFields: [customField("bbb")],
        });

        expect(groupsOf(steps, "more-info")).toEqual([
            { heading: "About this session", fields: ["responses.aaa"] },
            { heading: "About you", fields: ["profile.responses.bbb"] },
        ]);
    });

    it("drops the heading of a group the edition asks nothing under", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }),
            specs,
            profileSpecs,
            customFields: [customField("aaa")],
            hostCustomFields: [],
        });

        expect(groupsOf(steps, "more-info")).toEqual([
            { heading: "About this session", fields: ["responses.aaa"] },
        ]);
    });

    it("keeps More info for an edition that only asks about the speaker", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }),
            specs,
            profileSpecs,
            customFields: [],
            hostCustomFields: [customField("bbb")],
        });

        expect(steps.map((step) => step.path)).toEqual(["session", "more-info", "profile"]);
        expect(groupsOf(steps, "more-info")).toEqual([
            { heading: "About you", fields: ["profile.responses.bbb"] },
        ]);
    });

    it("leaves out a disabled built-in field", () => {
        const steps = buildSessionFormSteps({
            edition: edition({ abstract: { requirement: "optional" } }),
            specs,
            profileSpecs,
            hostCustomFields: [],
            customFields: [],
        });

        expect(namesOf(steps, 0)).not.toContain("notes");
        expect(namesOf(steps, 0)).not.toContain("teaserImage");
    });
});

describe("firstInvalidStep", () => {
    const requiredQuestion = (id: string, target: string): CustomField =>
        ({
            id,
            target,
            requirement: "always_required",
            options: { type: "single_line_text" },
            answerMaxLength: 200,
            deadline: null,
            freezeAfter: null,
            sessionTypes: [],
            tracks: [],
        }) as unknown as CustomField;
    const sessionQuestion = requiredQuestion("field-session", "per_proposal");
    const hostQuestion = requiredQuestion("field-host", "per_host");
    const wizardEdition = edition({ title: {}, sessionType: {} });
    const steps = buildSessionFormSteps({
        edition: wizardEdition,
        specs,
        profileSpecs,
        customFields: [sessionQuestion],
        hostCustomFields: [hostQuestion],
    });

    type Answers = {
        session: Record<string, unknown>;
        host: Record<string, unknown>;
    };

    const failingNames = async ({ session, host }: Answers) => {
        const resolver = formResolver(
            createSessionSchema(wizardEdition, [sessionQuestion], [hostQuestion]) as never,
        );
        const { errors } = await resolver(
            {
                sessionType: { id: "type-talk" },
                title: "A session",
                responses: session,
                profile: {
                    displayName: "A host",
                    emailAddress: "host@example.test",
                    responses: host,
                },
            } as never,
            undefined,
            { fields: {}, shouldUseNativeValidation: false },
        );

        return (name: string): boolean =>
            name
                .split(".")
                .reduce<unknown>(
                    (node, segment) => (node as Record<string, unknown> | undefined)?.[segment],
                    errors,
                ) !== undefined;
    };

    // The steps' field names and the resolver's error paths are built apart,
    // for session and host questions alike, so this is what notices when either
    // pair stops agreeing.
    it("finds the step holding a session question the resolver refuses", async () => {
        const index = firstInvalidStep(
            steps,
            await failingNames({ session: {}, host: { "field-host": "An answer" } }),
        );

        expect(steps[index]?.path).toBe("more-info");
    });

    it("finds the step holding a host question the resolver refuses", async () => {
        const index = firstInvalidStep(
            steps,
            await failingNames({ session: { "field-session": "An answer" }, host: {} }),
        );

        expect(index).not.toBe(-1);
        expect(stepFieldNames(steps[index] as (typeof steps)[number])).toContain(
            "profile.responses.field-host",
        );
    });

    it("finds nothing once both questions are answered", async () => {
        expect(
            firstInvalidStep(
                steps,
                await failingNames({
                    session: { "field-session": "An answer" },
                    host: { "field-host": "An answer" },
                }),
            ),
        ).toBe(-1);
    });
});

describe("followingStepIndex", () => {
    const steps = buildSessionFormSteps({
        edition: edition({ title: {}, sessionType: {} }),
        specs,
        profileSpecs,
        customFields: [],
        hostCustomFields: [],
    });

    it("moves a speaker whose step dropped out on to the one that followed it", () => {
        expect(steps.map((step) => step.path)).toEqual(["session", "profile"]);
        expect(followingStepIndex(steps, "more-info")).toBe(1);
    });

    it("falls back to the last step when nothing follows", () => {
        expect(followingStepIndex(steps.slice(0, 1), "more-info")).toBe(0);
    });
});
