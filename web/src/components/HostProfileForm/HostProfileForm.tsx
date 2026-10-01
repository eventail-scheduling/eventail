import { Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { type Control, type Resolver, type UseFormReturn, useForm } from "react-hook-form";
import { knownResponses, type StoredResponse } from "#/components/CustomFieldInput/index.js";
import {
    createProfileDefaultValues,
    createProfileFormSchema,
    hostFields,
    orderedBuiltInFieldNames,
    ProfileBuiltInFields,
    type ProfileFormTransformedValues,
    type ProfileFormValues,
    profileBuiltInFieldNames,
    profileFieldPath,
    SessionCustomFields,
} from "#/components/SessionFormFields/index.js";
import type { CustomField } from "#/queries/custom-field.js";
import type { Edition, SessionFieldSpec, UploadLimits } from "#/queries/edition.js";
import type { Host } from "#/queries/host.js";
import type { AvailabilityInterval } from "#/utils/availability.js";
import {
    type Changes,
    changedFields,
    changesWithin,
    rebaseChanges,
    snapshotValues,
} from "#/utils/changed-fields.js";
import { formResolver } from "#/utils/zod.js";
import { noAvailability } from "./useAvailabilityFollowsWindow.js";

type HostProfileFormOptions = {
    edition: Edition;
    /** Every question of the edition, which the form seeds from. */
    customFields: CustomField[];
    /** The ones it asks. */
    hostCustomFields: CustomField[];
    host: Host;
};

export type HostProfileForm = {
    form: UseFormReturn<ProfileFormValues, unknown, ProfileFormTransformedValues>;
    /** Measures what the user changed since the form was last seeded. */
    changes: () => Changes;
    /** Joins the live host's stored answers with those of the host it was seeded from. */
    storedResponses: () => StoredResponse[];
    /** Copies the form's values as they stand, for a later reseed to measure edits against. */
    snapshot: () => ProfileFormValues;
    /**
     * Seeds the form from a host the API answered with, making it the new baseline.
     *
     * Pass the answer rather than a host built from what was sent: attaching a
     * file swaps its temporary key for a stored one, and the next save is
     * measured against what is stored.
     *
     * Whatever the user changed since `submitted` was taken, typing or an
     * upload landing while the save was out, goes back on top.
     */
    reseed: (host: Host, submitted: ProfileFormValues) => void;
    /** The availability the form was last seeded with. */
    seededAvailability: () => AvailabilityInterval[];
    /** Makes these intervals the form's availability and the baseline its changes count from. */
    settleAvailability: (intervals: AvailabilityInterval[]) => void;
};

type ProfileSeed = {
    host: Host;
    values: ProfileFormValues;
};

const seedFrom = (host: Host, customFields: CustomField[]): ProfileSeed => ({
    host,
    values: {
        profile: createProfileDefaultValues({ host, hostCustomFields: hostFields(customFields) }),
    },
});

export const useHostProfileForm = ({
    edition,
    customFields,
    hostCustomFields,
    host,
}: HostProfileFormOptions): HostProfileForm => {
    const resolver = useCallback<
        Resolver<ProfileFormValues, unknown, ProfileFormTransformedValues>
    >(
        (values, context, options) =>
            formResolver(createProfileFormSchema(edition, hostCustomFields))(
                values,
                context,
                options,
            ),
        [edition, hostCustomFields],
    );

    const [seed, setSeed] = useState<ProfileSeed>(() => seedFrom(host, customFields));
    // Read after an await, where the render's own copy may be a save behind.
    const latestSeed = useRef(seed);

    const replaceSeed = (next: ProfileSeed) => {
        latestSeed.current = next;
        setSeed(next);
    };
    const form = useForm<ProfileFormValues, unknown, ProfileFormTransformedValues>({
        resolver,
        defaultValues: seed.values,
    });

    return {
        form,
        changes: () => changesWithin(changedFields(seed.values, form.getValues()), "profile"),
        storedResponses: () => knownResponses(host.responses, seed.host.responses),
        snapshot: () => snapshotValues(form.getValues()),
        reseed: (seededHost, submitted) => {
            const next = seedFrom(seededHost, customFields);
            const rebased = {
                profile: rebaseChanges(
                    submitted.profile,
                    next.values.profile,
                    form.getValues().profile,
                    ["responses"],
                ),
            };
            replaceSeed(next);
            form.reset(next.values);
            form.reset(rebased, { keepDefaultValues: true });
        },
        seededAvailability: () => latestSeed.current.values.profile.availability ?? noAvailability,
        settleAvailability: (intervals) => {
            const current = latestSeed.current;
            replaceSeed({
                ...current,
                values: { profile: { ...current.values.profile, availability: intervals } },
            });
            form.resetField("profile.availability", { defaultValue: intervals });
        },
    };
};

type HostProfileFieldsProps = {
    control: Control<ProfileFormValues, unknown, ProfileFormTransformedValues>;
    edition: Edition;
    profileFieldSpecs: Record<string, SessionFieldSpec>;
    uploadLimits: UploadLimits;
    hostCustomFields: CustomField[];
};

export const HostProfileFields = ({
    control,
    edition,
    profileFieldSpecs,
    uploadLimits,
    hostCustomFields,
}: HostProfileFieldsProps): ReactNode => {
    const fieldNames = useMemo(
        () =>
            orderedBuiltInFieldNames(edition.profileFieldOptions, profileFieldSpecs, [
                ...profileBuiltInFieldNames,
            ]).map(profileFieldPath),
        [edition, profileFieldSpecs],
    );

    return (
        <Stack spacing={3}>
            <ProfileBuiltInFields
                control={control}
                edition={edition}
                specs={profileFieldSpecs}
                uploadLimits={uploadLimits}
                fieldNames={fieldNames}
            />

            {hostCustomFields.length > 0 && (
                <Stack spacing={2}>
                    <Typography variant="h6">About you</Typography>

                    <SessionCustomFields
                        control={control}
                        customFields={hostCustomFields}
                        uploadLimits={uploadLimits}
                        pathPrefix="profile."
                    />
                </Stack>
            )}
        </Stack>
    );
};
