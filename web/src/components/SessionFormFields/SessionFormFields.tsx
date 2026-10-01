import { Stack } from "@mui/material";
import { RhfAutocomplete, RhfTextField } from "mui-rhf-integration";
import { Fragment, type ReactNode } from "react";
import type { Control, FieldPathByValue, FieldValues } from "react-hook-form";
import { RhfAvailabilityField } from "#/components/AvailabilityField/index.js";
import { BuiltInField } from "#/components/BuiltInField/index.js";
import { CustomFieldInput } from "#/components/CustomFieldInput/index.js";
import { RhfDurationField } from "#/components/DurationField/index.js";
import { type FileUpload, ImageUploadField } from "#/components/FileUploadField/index.js";
import type { CustomField } from "#/queries/custom-field.js";
import type {
    BuiltInFieldOptions,
    Edition,
    SessionFieldSpec,
    UploadLimits,
} from "#/queries/edition.js";
import type { SessionType } from "#/queries/session-type.js";
import type { Track } from "#/queries/track.js";
import type { AvailabilityInterval } from "#/utils/availability.js";
import type { ProfileFieldValues, SessionFieldValues, SessionTransformedValues } from "./schema.js";
import {
    type ProfileBuiltInFieldName,
    profileFieldName,
    type SessionBuiltInFieldName,
} from "./steps.js";

type SessionControl = Control<SessionFieldValues, unknown, SessionTransformedValues>;

type SessionBuiltInFieldsProps = {
    control: SessionControl;
    edition: Edition;
    specs: Record<string, SessionFieldSpec>;
    sessionTypes: SessionType[];
    tracks: Track[];
    uploadLimits: UploadLimits;
    fieldNames: string[];
    /**
     * What the session is already on, where that is not among the lists.
     *
     * An organizer may put a session on an internal type or track, which the
     * lists leave out below manager. The field then shows it as its only
     * option, locked.
     */
    assigned?: { sessionType: SessionType; track: Track | null };
};

/**
 * The session's own built-in fields, drawn in the order `fieldNames` gives,
 * which an organizer sets.
 */
export const SessionBuiltInFields = ({
    control,
    edition,
    specs,
    sessionTypes,
    tracks,
    uploadLimits,
    fieldNames,
    assigned,
}: SessionBuiltInFieldsProps): ReactNode => {
    const fieldOptions = edition.sessionFieldOptions;
    const assignedTrack = assigned?.track ?? null;
    // Locked rather than merely shown: the lists never offer this value, so a
    // speaker could move the session off an organizer's assignment but never
    // back.
    const lockedSessionType =
        assigned !== undefined && !sessionTypes.some(({ id }) => id === assigned.sessionType.id)
            ? assigned.sessionType
            : null;
    const lockedTrack =
        assignedTrack !== null && !tracks.some(({ id }) => id === assignedTrack.id)
            ? assignedTrack
            : null;

    const renderers: Record<SessionBuiltInFieldName, () => ReactNode> = {
        title: () => (
            <BuiltInField
                name="title"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name="title"
                        label={label}
                        helperText={helperText}
                        required={required}
                        maxCharacters={maxLength}
                        fullWidth
                    />
                )}
            />
        ),
        sessionType: () => (
            <BuiltInField
                name="sessionType"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required }) => (
                    <RhfAutocomplete
                        control={control}
                        name="sessionType"
                        options={lockedSessionType ? [lockedSessionType] : sessionTypes}
                        disabled={lockedSessionType !== null}
                        getOptionLabel={(option) => option.name}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        slotProps={{ textField: { label, helperText, required } }}
                    />
                )}
            />
        ),
        track: () => (
            <BuiltInField
                name="track"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required }) => (
                    <RhfAutocomplete
                        control={control}
                        name="track"
                        options={lockedTrack ? [lockedTrack] : tracks}
                        disabled={lockedTrack !== null}
                        getOptionLabel={(option) => option.name}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        slotProps={{ textField: { label, helperText, required } }}
                    />
                )}
            />
        ),
        abstract: () => (
            <BuiltInField
                name="abstract"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name="abstract"
                        label={label}
                        helperText={helperText}
                        required={required}
                        multiline
                        minRows={4}
                        maxCharacters={maxLength}
                        fullWidth
                    />
                )}
            />
        ),
        description: () => (
            <BuiltInField
                name="description"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name="description"
                        label={label}
                        helperText={helperText}
                        required={required}
                        multiline
                        minRows={4}
                        maxCharacters={maxLength}
                        fullWidth
                    />
                )}
            />
        ),
        notes: () => (
            <BuiltInField
                name="notes"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name="notes"
                        label={label}
                        helperText={helperText}
                        required={required}
                        multiline
                        minRows={4}
                        maxCharacters={maxLength}
                        fullWidth
                    />
                )}
            />
        ),
        duration: () => (
            <BuiltInField
                name="duration"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required }) => (
                    <RhfDurationField
                        control={control}
                        name="duration"
                        label={label}
                        helperText={helperText}
                        required={required}
                    />
                )}
            />
        ),
        setupTime: () => (
            <BuiltInField
                name="setupTime"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required }) => (
                    <RhfDurationField
                        control={control}
                        name="setupTime"
                        label={label}
                        helperText={helperText}
                        required={required}
                    />
                )}
            />
        ),
        teardownTime: () => (
            <BuiltInField
                name="teardownTime"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required }) => (
                    <RhfDurationField
                        control={control}
                        name="teardownTime"
                        label={label}
                        helperText={helperText}
                        required={required}
                    />
                )}
            />
        ),
        teaserImage: () => (
            <BuiltInField
                name="teaserImage"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, imageConstraints }) =>
                    imageConstraints === undefined ? null : (
                        <ImageUploadField
                            control={control}
                            name="teaserImage"
                            label={label}
                            helperText={helperText}
                            uploadLimits={uploadLimits}
                            imageConstraints={imageConstraints}
                            required={required}
                        />
                    )
                }
            />
        ),
    };

    return (
        <Stack spacing={2}>
            {fieldNames.map((name) => (
                <Fragment key={name}>{renderers[name as SessionBuiltInFieldName]?.()}</Fragment>
            ))}
        </Stack>
    );
};

type FieldsWithProfile = FieldValues & { profile?: ProfileFieldValues };

type ProfileBuiltInFieldsProps<
    TFieldValues extends FieldsWithProfile = FieldsWithProfile,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    edition: Edition;
    specs: Record<string, SessionFieldSpec>;
    uploadLimits: UploadLimits;
    fieldNames: string[];
};

/**
 * What a speaker gives an edition once, whatever they go on to submit to it.
 *
 * That is why the same fields appear inside a submission and on a page of their
 * own. The branch is always reached through `profile`, so the two agree on where
 * the values live.
 */
export const ProfileBuiltInFields = <
    TFieldValues extends FieldsWithProfile = FieldsWithProfile,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    edition,
    specs,
    uploadLimits,
    fieldNames,
}: ProfileBuiltInFieldsProps<TFieldValues, TContext, TTransformedValues>): ReactNode => {
    const fieldOptions = edition.profileFieldOptions;
    const textPath = (name: string) =>
        `profile.${name}` as FieldPathByValue<TFieldValues, string | null | undefined>;
    const filePath = (name: string) =>
        `profile.${name}` as FieldPathByValue<TFieldValues, FileUpload | null | undefined>;
    const availabilityPath = (name: string) =>
        `profile.${name}` as FieldPathByValue<TFieldValues, AvailabilityInterval[] | undefined>;
    const renderers: Record<ProfileBuiltInFieldName, () => ReactNode> = {
        displayName: () => (
            <BuiltInField
                name="displayName"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name={textPath("displayName")}
                        label={label}
                        helperText={helperText}
                        required={required}
                        maxCharacters={maxLength}
                        fullWidth
                    />
                )}
            />
        ),
        emailAddress: () => (
            <BuiltInField
                name="emailAddress"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name={textPath("emailAddress")}
                        label={label}
                        helperText={helperText}
                        required={required}
                        maxCharacters={maxLength}
                        type="email"
                        fullWidth
                    />
                )}
            />
        ),
        biography: () => (
            <BuiltInField
                name="biography"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, maxLength }) => (
                    <RhfTextField
                        control={control}
                        name={textPath("biography")}
                        label={label}
                        helperText={helperText}
                        required={required}
                        multiline
                        minRows={4}
                        maxCharacters={maxLength}
                        fullWidth
                    />
                )}
            />
        ),
        avatar: () => (
            <BuiltInField
                name="avatar"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText, required, imageConstraints }) =>
                    imageConstraints === undefined ? null : (
                        <ImageUploadField
                            control={control}
                            name={filePath("avatar")}
                            label={label}
                            helperText={helperText}
                            uploadLimits={uploadLimits}
                            imageConstraints={imageConstraints}
                            shape="circle"
                            required={required}
                        />
                    )
                }
            />
        ),
        availability: () => (
            <BuiltInField
                name="availability"
                fieldOptions={fieldOptions}
                specs={specs}
                render={({ label, helperText }) => (
                    <RhfAvailabilityField
                        control={control}
                        name={availabilityPath("availability")}
                        label={label}
                        emptyText="You are available at any time during the edition. Drag on the grid to limit it to the times you draw."
                        drawnText="You are available only at the times drawn below. Clear them all to be available throughout."
                        helperText={
                            helperText ??
                            "Drag to draw a block, drag its edges to adjust it, and click a block twice to remove it"
                        }
                        startDate={edition.startDate}
                        endDate={edition.endDate}
                        timeZone={edition.timeZone}
                    />
                )}
            />
        ),
    };

    return (
        <Stack spacing={2}>
            {fieldNames.map((name) => (
                <Fragment key={name}>
                    {renderers[profileFieldName(name) as ProfileBuiltInFieldName]?.()}
                </Fragment>
            ))}
        </Stack>
    );
};

type SessionCustomFieldsProps<
    TFieldValues extends FieldValues = FieldValues,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    customFields: CustomField[];
    uploadLimits: UploadLimits;
    pathPrefix?: string;
};

export const SessionCustomFields = <
    TFieldValues extends FieldValues = FieldValues,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    customFields,
    uploadLimits,
    pathPrefix,
}: SessionCustomFieldsProps<TFieldValues, TContext, TTransformedValues>): ReactNode => (
    <Stack spacing={2}>
        {customFields.map((customField) => (
            <CustomFieldInput
                key={customField.id}
                control={control}
                customField={customField}
                uploadLimits={uploadLimits}
                pathPrefix={pathPrefix}
            />
        ))}
    </Stack>
);

const positionOf = (fieldOptions: BuiltInFieldOptions, name: string): number =>
    fieldOptions[name]?.position ?? 0;

/**
 * Mirrors the editor's own asked-field rule.
 *
 * A force-required field is asked even with no options entry of its own.
 */
export const orderedBuiltInFieldNames = (
    fieldOptions: BuiltInFieldOptions,
    specs: Record<string, SessionFieldSpec>,
    names: string[],
): string[] =>
    names
        .filter((name) => specs[name]?.forceRequired === true || fieldOptions[name] !== undefined)
        .sort((left, right) => positionOf(fieldOptions, left) - positionOf(fieldOptions, right));
