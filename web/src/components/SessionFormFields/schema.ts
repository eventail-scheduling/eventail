import { isAfter } from "temporal-extra";
import { z } from "zod/mini";
import {
    addBuiltInFieldSchema,
    type BuiltInFieldDurationSchema,
    type BuiltInFieldFileUploadSchema,
    type BuiltInFieldRelationshipSchema,
    type BuiltInFieldStringSchema,
    createBuiltInFieldDurationSchema,
    createBuiltInFieldFileUploadSchema,
    createBuiltInFieldRelationshipSchema,
    createBuiltInFieldStringSchema,
    type ToZodMiniObjectShape,
} from "#/components/BuiltInField/index.js";
import {
    buildResponseChanges,
    createResponseDefaultValues,
    createResponseSchema,
    type StoredResponse,
} from "#/components/CustomFieldInput/index.js";
import { toFileDescriptorInput } from "#/components/FileUploadField/index.js";
import type { ResponseChanges } from "#/mutations/session.js";
import type { CustomField } from "#/queries/custom-field.js";
import type { BuiltInFieldRequirement, Edition } from "#/queries/edition.js";
import type { Host } from "#/queries/host.js";
import type { Session } from "#/queries/session.js";
import type { AvailabilityInterval } from "#/utils/availability.js";
import { type Changes, changesWithin } from "#/utils/changed-fields.js";
import { serverNow } from "#/utils/server-clock.ts";
import { formRelationshipSchema, instantSchema } from "#/utils/zod.js";

type ResponseSchema = z.ZodMiniType;
type ResponsesSchema = z.ZodMiniType<Record<string, unknown>, Record<string, unknown>>;

type RelationshipSchema = z.ZodMiniType<string, { id: string }>;

type AvailabilitySchema = z.ZodMiniType<AvailabilityInterval[], AvailabilityInterval[] | undefined>;

/**
 * Passes an empty grid when availability is optional and fails it when required.
 *
 * That is the API's rule rather than this form's: it reads an empty set as a
 * host saying they are free throughout, and asks for a drawn block only where
 * the edition made availability required.
 */
const createAvailabilitySchema = (requirement: BuiltInFieldRequirement): AvailabilitySchema => {
    const intervals = z.array(z.object({ startsAt: instantSchema, endsAt: instantSchema }));

    if (requirement === "required") {
        return intervals.check(z.minLength(1, "Draw when you are available"));
    }

    return z.prefault(intervals, []);
};

type ProfileShape = {
    displayName: BuiltInFieldStringSchema;
    emailAddress: BuiltInFieldStringSchema;
    biography?: BuiltInFieldStringSchema;
    avatar?: BuiltInFieldFileUploadSchema;
    availability?: AvailabilitySchema;
    responses: z.ZodMiniPrefault<ResponsesSchema>;
};

type ProfileSchema = z.ZodMiniObject<ToZodMiniObjectShape<ProfileShape>>;
export type ProfileFieldValues = z.input<ProfileSchema>;
export type ProfileTransformedValues = z.output<ProfileSchema>;

type SessionShape = {
    sessionType: RelationshipSchema;
    track?: BuiltInFieldRelationshipSchema;
    title: BuiltInFieldStringSchema;
    abstract?: BuiltInFieldStringSchema;
    description?: BuiltInFieldStringSchema;
    notes?: BuiltInFieldStringSchema;
    duration?: BuiltInFieldDurationSchema;
    setupTime?: BuiltInFieldDurationSchema;
    teardownTime?: BuiltInFieldDurationSchema;
    teaserImage?: BuiltInFieldFileUploadSchema;
    responses: z.ZodMiniPrefault<ResponsesSchema>;
    profile?: ProfileSchema;
};

type ProfileFormSchema = z.ZodMiniObject<{ profile: ProfileSchema }>;
export type ProfileFormValues = z.input<ProfileFormSchema>;
export type ProfileFormTransformedValues = z.output<ProfileFormSchema>;

/**
 * Keeps the branch nested on a page that holds nothing else.
 *
 * The fields, the defaults and the payload are then the ones a submission
 * already uses rather than a second set that can drift from them.
 */
export const createProfileFormSchema = (
    edition: Edition,
    hostCustomFields: CustomField[],
): ProfileFormSchema => z.object({ profile: createProfileSchema(edition, hostCustomFields) });

type SessionSchema = z.ZodMiniObject<ToZodMiniObjectShape<SessionShape>>;
export type SessionFieldValues = z.input<SessionSchema>;
export type SessionTransformedValues = z.output<SessionSchema>;

type SessionScope = {
    sessionTypeId: string | undefined;
    trackId: string | undefined;
    /** Whether frozen fields stay in, for a view that reads answers rather than writes them. */
    includeFrozen?: boolean;
};

export const isFrozenAt = (customField: CustomField, instant: Temporal.Instant): boolean =>
    customField.freezeAfter !== null && isAfter(instant, customField.freezeAfter);

export const isFrozen = (customField: CustomField): boolean => isFrozenAt(customField, serverNow());

/**
 * Mirrors the API's appliesToSession.
 *
 * That includes a track-scoped field never applying to a session without a
 * track. pretalx shows everything in that case; eventail deliberately does not.
 */
export const applicableCustomFields = (
    customFields: CustomField[],
    scope: SessionScope,
): CustomField[] =>
    customFields.filter((customField) => {
        if (customField.target !== "per_proposal") {
            return false;
        }

        // The API refuses a value for a frozen field from anyone, so it has to
        // leave the schema rather than merely render read only.
        if (isFrozen(customField) && scope.includeFrozen !== true) {
            return false;
        }

        const matchesSessionType =
            customField.sessionTypes.length === 0 ||
            customField.sessionTypes.some(({ id }) => id === scope.sessionTypeId);
        const matchesTrack =
            customField.tracks.length === 0 ||
            (scope.trackId !== undefined &&
                customField.tracks.some(({ id }) => id === scope.trackId));

        return matchesSessionType && matchesTrack;
    });

/** Selects every session question the edition has, applicable to this one or not. */
export const proposalFields = (customFields: CustomField[]): CustomField[] =>
    customFields.filter((customField) => customField.target === "per_proposal");

/**
 * Selects every host question the edition has, frozen or not.
 *
 * A form seeds from these rather than from the ones it asks, since a question
 * that unfreezes while it is open comes back with the stored answer in place.
 */
export const hostFields = (customFields: CustomField[]): CustomField[] =>
    customFields.filter((customField) => customField.target === "per_host");

/**
 * Selects the host questions a form asks, which are scoped to nothing and so apply to every host.
 *
 * Frozen ones are dropped.
 */
export const applicableHostFields = (customFields: CustomField[]): CustomField[] =>
    customFields.filter(
        (customField) => customField.target === "per_host" && !isFrozen(customField),
    );

type ProfileDefaults = {
    host: Host;
    hostCustomFields: CustomField[];
};

export const createProfileDefaultValues = ({
    host,
    hostCustomFields,
}: ProfileDefaults): ProfileFieldValues => ({
    displayName: host.displayName,
    emailAddress: host.emailAddress,
    biography: host.biography,
    avatar: host.avatar,
    availability: host.availabilities.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    responses: createResponseDefaultValues(
        hostCustomFields,
        (customField) =>
            host.responses.find((response) => response.customField.id === customField.id)?.value,
    ),
});

type SessionDefaults = {
    session: Session;
    customFields: CustomField[];
};

type Identified = {
    id: string;
};

type Offerable = {
    internal: boolean;
};

/**
 * Drops what only a manager may name, so the form cannot offer a 404.
 *
 * The API serves internal tracks and session types to every team member, since
 * the management lists show them, while the session write handlers still refuse
 * one by id below manager. The public submit and edit pages sit on the host's
 * side of that line.
 */
export const offerable = <TOption extends Offerable>(
    options: TOption[],
    isManager: boolean,
): TOption[] => (isManager ? options : options.filter(({ internal }) => !internal));

/**
 * Drops a relationship the caller was never offered, so a write leaves it alone.
 *
 * An internal track or session type is kept out of the lists below manager, by
 * the API for a speaker and by {@link offerable} for a team member, and the API
 * refuses one by id below manager either way, so a speaker has no way to say
 * what their session already is.
 */
export const omitUnoffered = <
    TSelected extends string | null | undefined,
    TOffered extends Identified,
>(
    selected: TSelected,
    offered: readonly TOffered[],
): TSelected | undefined =>
    typeof selected === "string" && !offered.some(({ id }) => id === selected)
        ? undefined
        : selected;

export const createSessionDefaultValues = ({
    session,
    customFields,
}: SessionDefaults): SessionFieldValues => {
    const responses = createResponseDefaultValues(
        proposalFields(customFields),
        (customField) =>
            session.responses.find((response) => response.customField.id === customField.id)?.value,
    );

    return {
        sessionType: session.sessionType,
        track: session.track ?? null,
        title: session.title,
        abstract: session.abstract,
        description: session.description,
        notes: session.notes,
        duration: session.duration,
        setupTime: session.setupTime,
        teardownTime: session.teardownTime,
        teaserImage: session.teaserImage,
        responses,
    } as SessionFieldValues;
};

/** Says which attributes, by the name the form gives them, a builder includes. */
export type AttributeFilter = (name: string) => boolean;

const everyAttribute: AttributeFilter = () => true;

/**
 * Includes only the attributes a form changed.
 *
 * Filtering before a value is converted matters for a file: a stored one
 * cannot be sent back, so an untouched one must never reach the conversion.
 */
export const changedAttributes =
    (changes: Changes): AttributeFilter =>
    (name) =>
        changesWithin(changes, name) !== undefined;

/**
 * Carries a key for every included attribute the edition asks for, empty ones included.
 *
 * The patch reads a key left out as a value left alone, so an emptied field
 * has to arrive as an empty value for the API to clear it.
 */
export const buildProfileAttributes = (
    edition: Edition,
    values: ProfileTransformedValues,
    include: AttributeFilter = everyAttribute,
): Record<string, unknown> => {
    const { profileFieldOptions } = edition;
    const attributes: Record<string, unknown> = {};

    if (include("displayName")) {
        attributes.displayName = values.displayName;
    }

    if (include("emailAddress")) {
        attributes.emailAddress = values.emailAddress;
    }

    if (profileFieldOptions.biography && include("biography")) {
        attributes.biography = values.biography ?? "";
    }

    if (profileFieldOptions.avatar && include("avatar")) {
        attributes.avatar = values.avatar ? toFileDescriptorInput(values.avatar) : null;
    }

    return attributes;
};

/**
 * Says whether a session patch has to carry its answers.
 *
 * A changed type or track changes which fields apply, and the API then wants
 * every unfrozen one answered, stored or sent.
 */
export const sessionPatchCarriesAnswers = (changes: Changes): boolean =>
    changesWithin(changes, "responses") !== undefined ||
    changesWithin(changes, "sessionType") !== undefined ||
    changesWithin(changes, "track") !== undefined;

type ProfileChanges = {
    attributes: Record<string, unknown>;
    responses: ResponseChanges | undefined;
    availabilities: AvailabilityInterval[] | undefined;
};

/**
 * Builds the host patch from what the profile form changed.
 *
 * `storedResponses` comes from `knownResponses`, which says which copies it has to join.
 */
export const buildProfileChanges = (
    edition: Edition,
    hostCustomFields: CustomField[],
    profile: ProfileTransformedValues,
    changes: Changes,
    storedResponses: readonly StoredResponse[],
    frozenHostCustomFields: readonly CustomField[],
): ProfileChanges => ({
    attributes: buildProfileAttributes(edition, profile, changedAttributes(changes)),
    responses:
        changesWithin(changes, "responses") === undefined
            ? undefined
            : buildResponseChanges(
                  hostCustomFields,
                  profile.responses,
                  changesWithin(changes, "responses"),
                  storedResponses,
                  frozenHostCustomFields,
              ),
    availabilities:
        changesWithin(changes, "availability") === undefined ? undefined : profile.availability,
});

type SessionChangesInput = {
    edition: Edition;
    /** Every question of the edition; a stored answer to one the form does not ask is kept by id. */
    customFields: readonly CustomField[];
    /** The session questions the form asks now. */
    proposalCustomFields: CustomField[];
    /** The frozen ones that apply, whose stored answers are kept by id. */
    frozenCustomFields: readonly CustomField[];
    values: SessionTransformedValues;
    changes: Changes;
    sessionTypes: readonly Identified[];
    tracks: readonly Identified[];
    storedResponses: readonly StoredResponse[];
};

type SessionChanges = {
    attributes: Record<string, unknown>;
    sessionType: string | undefined;
    track: string | null | undefined;
    responses: ResponseChanges | undefined;
};

/**
 * Builds the session patch from what an edit form changed.
 *
 * `storedResponses` comes from `knownResponses`, which says which copies it has to join.
 */
export const buildSessionChanges = ({
    edition,
    customFields,
    proposalCustomFields,
    frozenCustomFields,
    values,
    changes,
    sessionTypes,
    tracks,
    storedResponses,
}: SessionChangesInput): SessionChanges => ({
    attributes: buildSessionAttributes(edition, values, changedAttributes(changes)),
    sessionType:
        changesWithin(changes, "sessionType") === undefined
            ? undefined
            : omitUnoffered(values.sessionType, sessionTypes),
    track:
        changesWithin(changes, "track") === undefined
            ? undefined
            : omitUnoffered(values.track, tracks),
    responses: sessionPatchCarriesAnswers(changes)
        ? buildResponseChanges(
              proposalCustomFields,
              values.responses,
              changesWithin(changes, "responses"),
              storedResponses,
              [
                  ...frozenCustomFields,
                  ...unaskedCustomFields(customFields, proposalCustomFields, frozenCustomFields),
              ],
          )
        : undefined,
});

const unaskedCustomFields = (
    customFields: readonly CustomField[],
    proposalCustomFields: readonly CustomField[],
    frozenCustomFields: readonly CustomField[],
): CustomField[] => {
    const askedIds = new Set(
        [...proposalCustomFields, ...frozenCustomFields].map((customField) => customField.id),
    );

    return customFields.filter(
        (customField) => customField.target === "per_proposal" && !askedIds.has(customField.id),
    );
};

const sessionFieldAttributeNames = [
    "abstract",
    "description",
    "notes",
    "duration",
    "setupTime",
    "teardownTime",
    "teaserImage",
] as const;

/**
 * Carries a key for every included field the edition enables, null included.
 *
 * A create has to name every enabled field, empty or null, since the API takes
 * none of them as optional there. An update includes only the changed ones.
 */
export const buildSessionAttributes = (
    edition: Edition,
    values: SessionTransformedValues,
    include: AttributeFilter = everyAttribute,
): Record<string, unknown> => {
    const attributes: Record<string, unknown> = {};
    const held = values as Record<string, unknown>;

    if (include("title")) {
        attributes.title = values.title;
    }

    for (const name of sessionFieldAttributeNames) {
        if (!(edition.sessionFieldOptions[name] && include(name))) {
            continue;
        }

        if (name === "teaserImage") {
            attributes[name] = values.teaserImage
                ? toFileDescriptorInput(values.teaserImage)
                : null;
            continue;
        }

        attributes[name] = held[name] ?? null;
    }

    return attributes;
};

const buildResponsesShape = (customFields: CustomField[]): Record<string, ResponseSchema> => {
    const shape: Record<string, ResponseSchema> = {};

    for (const customField of customFields) {
        shape[customField.id] = createResponseSchema(customField);
    }

    return shape;
};

/**
 * Builds the profile schema an edition's own rules describe.
 *
 * The display name and the address are force-required, so they carry no options
 * entry to switch them off and are built rather than added.
 */
export const createProfileSchema = (
    edition: Edition,
    hostCustomFields: CustomField[],
): ProfileSchema => {
    const { profileFieldOptions } = edition;
    const profileShape: ProfileShape = {
        displayName: createBuiltInFieldStringSchema(
            "required",
            profileFieldOptions.displayName?.minLength,
            profileFieldOptions.displayName?.maxLength,
        ),
        emailAddress: createBuiltInFieldStringSchema(
            "required",
            profileFieldOptions.emailAddress?.minLength,
            profileFieldOptions.emailAddress?.maxLength,
            "email",
        ),
        responses: z.prefault(z.object(buildResponsesShape(hostCustomFields)), {}),
    };

    addBuiltInFieldSchema(
        profileFieldOptions.biography,
        profileShape,
        "biography",
        (requirement, options) =>
            createBuiltInFieldStringSchema(requirement, options.minLength, options.maxLength),
    );
    addBuiltInFieldSchema(profileFieldOptions.avatar, profileShape, "avatar", (requirement) =>
        createBuiltInFieldFileUploadSchema(requirement),
    );
    addBuiltInFieldSchema(
        profileFieldOptions.availability,
        profileShape,
        "availability",
        (requirement) => createAvailabilitySchema(requirement),
    );

    return z.object(profileShape) as ProfileSchema;
};

/**
 * Builds a session form's schema, with the profile branch only when host questions are passed.
 *
 * Of the session forms, only submission writes the host record along with it.
 * An edit form carrying the branch would fail validation on a required profile
 * field it never renders, leaving a speaker unable to save a session over
 * something they cannot see.
 */
export const createSessionSchema = (
    edition: Edition,
    customFields: CustomField[],
    hostCustomFields?: CustomField[],
): SessionSchema => {
    const { sessionFieldOptions } = edition;

    const sessionShape: SessionShape = {
        sessionType: formRelationshipSchema,
        title: createBuiltInFieldStringSchema(
            "required",
            sessionFieldOptions.title?.minLength,
            sessionFieldOptions.title?.maxLength,
        ),
        responses: z.prefault(z.object(buildResponsesShape(customFields)), {}),
    };

    if (hostCustomFields) {
        sessionShape.profile = createProfileSchema(edition, hostCustomFields);
    }

    addBuiltInFieldSchema(
        sessionFieldOptions.track,
        sessionShape,
        "track",
        createBuiltInFieldRelationshipSchema,
    );

    addBuiltInFieldSchema(
        sessionFieldOptions.abstract,
        sessionShape,
        "abstract",
        (requirement, options) =>
            createBuiltInFieldStringSchema(requirement, options.minLength, options.maxLength),
    );
    addBuiltInFieldSchema(
        sessionFieldOptions.description,
        sessionShape,
        "description",
        (requirement, options) =>
            createBuiltInFieldStringSchema(requirement, options.minLength, options.maxLength),
    );
    addBuiltInFieldSchema(
        sessionFieldOptions.notes,
        sessionShape,
        "notes",
        (requirement, options) =>
            createBuiltInFieldStringSchema(requirement, options.minLength, options.maxLength),
    );
    addBuiltInFieldSchema(sessionFieldOptions.duration, sessionShape, "duration", (requirement) =>
        createBuiltInFieldDurationSchema(requirement),
    );
    addBuiltInFieldSchema(sessionFieldOptions.setupTime, sessionShape, "setupTime", (requirement) =>
        createBuiltInFieldDurationSchema(requirement),
    );
    addBuiltInFieldSchema(
        sessionFieldOptions.teardownTime,
        sessionShape,
        "teardownTime",
        (requirement) => createBuiltInFieldDurationSchema(requirement),
    );
    addBuiltInFieldSchema(
        sessionFieldOptions.teaserImage,
        sessionShape,
        "teaserImage",
        (requirement) => createBuiltInFieldFileUploadSchema(requirement),
    );

    return z.object(sessionShape) as unknown as SessionSchema;
};
