import { match } from "ts-pattern";
import { z } from "zod";
import type { Edition } from "../entity/Edition.js";
import type { Host } from "../entity/Host.js";
import { emailAddressSchema } from "../util/zod.js";
import {
    type AttributeFieldSpec,
    type BuiltInFieldRequirement,
    type BuiltInFieldSpec,
    buildFieldOptionsSchema,
    createFileAttributeSchema,
    createStringAttributeSchema,
    type FieldOptionsFromSpecs,
    type RequirementObject,
    serializeFieldSpecs,
} from "./built-in-fields.js";
import type { LengthObject } from "./common.js";
import type { FileDescriptorInput } from "./file-upload.js";
import type { ResolvedImageConstraints } from "./image-constraints.js";

export const profileFieldSpecs = {
    displayName: {
        label: "Display name",
        helperText: "How the speaker is named in the program",
        forceRequired: true,
        type: "string",
    },
    // Prefilled from the user record and backed by a column that is never
    // null, so an organizer may reword or reposition it but never switch it
    // off. Same for the display name above.
    emailAddress: {
        label: "Email address",
        helperText: "How organizers reach the speaker about this edition",
        forceRequired: true,
        type: "string",
        format: "email",
    },
    avatar: {
        label: "Avatar",
        type: "file",
        imageConstraints: {
            minWidth: 64,
            minHeight: 64,
            maxWidth: 512,
            maxHeight: 512,
            aspectRatio: { width: 1, height: 1 },
        },
    },
    biography: { label: "Biography", type: "string", multiline: true },
    availability: { label: "Availability", type: "availability" },
} as const satisfies Record<string, BuiltInFieldSpec>;

export type ProfileFieldOptions = FieldOptionsFromSpecs<typeof profileFieldSpecs>;

export const profileFieldOptionsSchema = buildFieldOptionsSchema(
    profileFieldSpecs,
) satisfies z.ZodType<ProfileFieldOptions>;

export const initialProfileFieldOptions: ProfileFieldOptions = {
    displayName: {},
    emailAddress: {},
    avatar: { requirement: "optional" },
    biography: { requirement: "optional" },
};

export const serializedProfileFieldSpecs = serializeFieldSpecs(profileFieldSpecs);

type ProfileAttributeFieldSpec = AttributeFieldSpec & {
    type: "string" | "file";
};

export const profileFieldAttributeNames = [
    "displayName",
    "emailAddress",
    "biography",
    "avatar",
] as const satisfies (keyof typeof profileFieldSpecs)[];

export type ProfileFieldAttributeName = (typeof profileFieldAttributeNames)[number];

type ProfileAttributeSchema = z.ZodType<string | FileDescriptorInput | null | undefined>;

export type ProfileFieldAttributeSchemas = Partial<
    Record<ProfileFieldAttributeName, ProfileAttributeSchema>
>;

type AskedProfileField = {
    name: ProfileFieldAttributeName;
    spec: ProfileAttributeFieldSpec;
    requirement: BuiltInFieldRequirement;
    lengths: LengthObject;
};

const askedProfileFields = (edition: Edition): AskedProfileField[] => {
    const asked: AskedProfileField[] = [];

    for (const name of profileFieldAttributeNames) {
        const spec = profileFieldSpecs[name] as ProfileAttributeFieldSpec;
        const options = edition.profileFieldOptions[name] as
            | (RequirementObject & LengthObject)
            | undefined;

        if (!(spec.forceRequired || options)) {
            continue;
        }

        asked.push({
            name,
            spec,
            requirement: spec.forceRequired
                ? "required"
                : (options as RequirementObject).requirement,
            lengths: (options ?? {}) as LengthObject,
        });
    }

    return asked;
};

type ProfileStringFieldSpec = Extract<ProfileAttributeFieldSpec, { type: "string" }>;

const createProfileStringSchema = (
    spec: ProfileStringFieldSpec,
    requirement: BuiltInFieldRequirement,
    lengths: LengthObject,
): z.ZodType<string> => {
    const schema = createStringAttributeSchema(requirement, lengths, spec.multiline);

    return spec.format === "email" ? schema.pipe(emailAddressSchema) : schema;
};

/**
 * Makes every attribute optional, which is what makes a patch partial.
 *
 * A key left out is a value left alone. A requirement therefore only says the
 * field may not be emptied, and whether it was ever filled in is asked where it
 * matters rather than on every write.
 */
export const createProfileFieldAttributeSchemas = (
    edition: Edition,
): ProfileFieldAttributeSchemas => {
    const schemas: ProfileFieldAttributeSchemas = {};

    for (const { name, spec, requirement, lengths } of askedProfileFields(edition)) {
        schemas[name] = match(spec)
            .with({ type: "string" }, (stringSpec) =>
                z.optional(createProfileStringSchema(stringSpec, requirement, lengths)),
            )
            .with({ type: "file" }, () => z.optional(createFileAttributeSchema(requirement)))
            .exhaustive();
    }

    return schemas;
};

/**
 * Judges against what the edition asks for now.
 *
 * Not against what it asked when the value was stored: a field turned required,
 * or given a longer minimum, leaves a host holding a value the writer would
 * refuse today.
 */
export const unfilledProfileFields = (edition: Edition, host: Host): ProfileFieldAttributeName[] =>
    askedProfileFields(edition)
        .filter(
            ({ name, spec, requirement, lengths }) =>
                requirement === "required" &&
                !match(spec)
                    .with({ type: "file" }, () => host[name] !== null)
                    .with(
                        { type: "string" },
                        (stringSpec) =>
                            createProfileStringSchema(stringSpec, requirement, lengths).safeParse(
                                host[name],
                            ).success,
                    )
                    .exhaustive(),
        )
        .map(({ name }) => name);

export const asksForAvailability = (edition: Edition): boolean =>
    edition.profileFieldOptions.availability !== undefined;

export const requiresAvailability = (edition: Edition): boolean =>
    edition.profileFieldOptions.availability?.requirement === "required";

/** Fixed rather than resolved: an avatar takes no organizer overrides. */
export const avatarConstraints: ResolvedImageConstraints = {
    ...profileFieldSpecs.avatar.imageConstraints,
};
