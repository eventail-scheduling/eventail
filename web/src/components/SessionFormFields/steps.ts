import type { CustomField } from "#/queries/custom-field.js";
import type { Edition, SessionFieldSpec } from "#/queries/edition.js";
import { orderedBuiltInFieldNames } from "./SessionFormFields.js";

export const sessionBuiltInFieldNames = [
    "title",
    "sessionType",
    "track",
    "abstract",
    "description",
    "notes",
    "duration",
    "setupTime",
    "teardownTime",
    "teaserImage",
] as const;

export type SessionBuiltInFieldName = (typeof sessionBuiltInFieldNames)[number];

const PROFILE_VALUE_PREFIX = "profile.";

export const profileBuiltInFieldNames = [
    "displayName",
    "emailAddress",
    "biography",
    "avatar",
    "availability",
] as const;

export type ProfileBuiltInFieldName = (typeof profileBuiltInFieldNames)[number];

export const profileFieldPath = (name: string): string => `${PROFILE_VALUE_PREFIX}${name}`;

export const profileFieldName = (path: string): string =>
    path.startsWith(PROFILE_VALUE_PREFIX) ? path.slice(PROFILE_VALUE_PREFIX.length) : path;

export type SessionFormStepScope = "session" | "customFields" | "profile";

export type SessionFormGroup = {
    heading?: string;
    /** Which answers the group holds, on the one step that asks for both. */
    target?: CustomField["target"];
    fields: string[];
};

export type SessionFormStep = {
    path: string;
    label: string;
    scope: SessionFormStepScope;
    groups: SessionFormGroup[];
};

/**
 * Membership is fixed here rather than configured.
 *
 * An organizer orders and disables fields, but which step asks for them is the
 * form's own shape.
 */
export const sessionFormSteps: SessionFormStep[] = [
    {
        path: "session",
        label: "Session",
        scope: "session",
        groups: [{ fields: [...sessionBuiltInFieldNames] }],
    },
    {
        path: "more-info",
        label: "More info",
        scope: "customFields",
        groups: [
            { target: "per_proposal", heading: "About this session", fields: [] },
            { target: "per_host", heading: "About you", fields: [] },
        ],
    },
    {
        path: "profile",
        label: "Profile",
        scope: "profile",
        groups: [{ fields: [...profileBuiltInFieldNames] }],
    },
];

type BuildStepsOptions = {
    edition: Edition;
    specs: Record<string, SessionFieldSpec>;
    profileSpecs: Record<string, SessionFieldSpec>;
    customFields: CustomField[];
    hostCustomFields: CustomField[];
};

const resolveGroup = (
    step: SessionFormStep,
    group: SessionFormGroup,
    { edition, specs, profileSpecs, customFields, hostCustomFields }: BuildStepsOptions,
): SessionFormGroup => {
    if (step.scope === "session") {
        return {
            ...group,
            fields: orderedBuiltInFieldNames(edition.sessionFieldOptions, specs, group.fields),
        };
    }

    if (step.scope === "customFields") {
        const asked = group.target === "per_host" ? hostCustomFields : customFields;
        const path = group.target === "per_host" ? profileFieldPath : (name: string) => name;

        return {
            ...group,
            fields: asked.map((customField) => path(`responses.${customField.id}`)),
        };
    }

    return {
        ...group,
        fields: orderedBuiltInFieldNames(
            edition.profileFieldOptions,
            profileSpecs,
            group.fields,
        ).map(profileFieldPath),
    };
};

export const stepFieldNames = (step: SessionFormStep): string[] =>
    step.groups.flatMap((group) => group.fields);

/** Finds the step that follows a step no longer asked, or the last one when none does. */
export const followingStepIndex = (steps: SessionFormStep[], path: string | undefined): number => {
    const order = sessionFormSteps.map((step) => step.path);
    const position = order.indexOf(path ?? "");
    const following = steps.findIndex((step) => order.indexOf(step.path) > position);

    return following === -1 ? Math.max(steps.length - 1, 0) : following;
};

/** Finds the first step holding a field that fails, or -1 when none does. */
export const firstInvalidStep = (
    steps: SessionFormStep[],
    isInvalid: (name: string) => boolean,
): number => steps.findIndex((step) => stepFieldNames(step).some(isInvalid));

/**
 * Resolves each step's fields, since which apply depends on the session type.
 *
 * Custom field paths are resolved here rather than declared, because which
 * fields apply follows the session type the speaker has picked so far. Groups
 * and steps left with nothing to ask drop out.
 */
export const buildSessionFormSteps = (options: BuildStepsOptions): SessionFormStep[] =>
    sessionFormSteps
        .map((step) => ({
            ...step,
            groups: step.groups
                .map((group) => resolveGroup(step, group, options))
                // A group whose fields were all filtered out would render its
                // heading over nothing.
                .filter((group) => group.fields.length > 0),
        }))
        // A step with no groups left would render an empty page.
        .filter((step) => step.groups.length > 0);
