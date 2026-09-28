import { FormControlLabel, Stack } from "@mui/material";
import { RhfSwitch, RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";
import { z } from "zod/mini";
import { RhfDurationField } from "#/components/DurationField/index.js";
import type { SessionType } from "#/queries/session-type.ts";
import { durationSchema, externalKeySchema } from "#/utils/zod.js";

export const sessionTypeFormSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1)),
    externalKey: externalKeySchema,
    defaultDuration: durationSchema.check(
        z.refine((duration) => duration.total("minutes") >= 1, {
            error: "Must be at least a minute",
        }),
    ),
    internal: z.boolean(),
});

export type SessionTypeFieldValues = z.input<typeof sessionTypeFormSchema>;
export type SessionTypeTransformedValues = z.output<typeof sessionTypeFormSchema>;

export const createSessionTypeDefaultValues = (
    sessionType: SessionType | null,
): SessionTypeFieldValues => {
    if (!sessionType) {
        return {
            name: "",
            externalKey: "",
            defaultDuration: Temporal.Duration.from({ minutes: 30 }),
            internal: false,
        };
    }

    return {
        name: sessionType.name,
        externalKey: sessionType.externalKey ?? "",
        defaultDuration: sessionType.defaultDuration,
        internal: sessionType.internal,
    };
};

type SessionTypeFormFieldsProps = {
    control: Control<SessionTypeFieldValues, unknown, SessionTypeTransformedValues>;
};

export const SessionTypeFormFields = ({ control }: SessionTypeFormFieldsProps): ReactNode => (
    <Stack spacing={2}>
        <RhfTextField control={control} name="name" label="Name" required fullWidth />
        <RhfTextField
            control={control}
            name="externalKey"
            label="External key"
            helperText="Identifies this type to systems importing the schedule"
            fullWidth
        />
        <RhfDurationField
            control={control}
            name="defaultDuration"
            label="Default duration"
            required
            fullWidth
        />
        <FormControlLabel
            control={<RhfSwitch control={control} name="internal" />}
            label="Internal"
        />
    </Stack>
);
