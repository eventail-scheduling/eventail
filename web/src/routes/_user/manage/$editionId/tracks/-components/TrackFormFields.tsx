import { FormControlLabel, Stack } from "@mui/material";
import { RhfSwitch, RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";
import { z } from "zod/mini";
import { RhfColorField } from "#/components/ColorField/index.js";
import type { Track } from "#/queries/track.ts";
import { externalKeySchema } from "#/utils/zod.js";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const DEFAULT_COLOR = "#1976d2";

export const trackFormSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1)),
    externalKey: externalKeySchema,
    description: z.string().check(z.trim()),
    color: z.string().check(z.regex(HEX_COLOR, { error: "Must be a six digit hex color" })),
    internal: z.boolean(),
});

export type TrackFieldValues = z.input<typeof trackFormSchema>;
export type TrackTransformedValues = z.output<typeof trackFormSchema>;

export const createTrackDefaultValues = (track: Track | null): TrackFieldValues => {
    if (!track) {
        return {
            name: "",
            externalKey: "",
            description: "",
            color: DEFAULT_COLOR,
            internal: false,
        };
    }

    return {
        name: track.name,
        externalKey: track.externalKey ?? "",
        description: track.description,
        color: track.color,
        internal: track.internal,
    };
};

type TrackFormFieldsProps = {
    control: Control<TrackFieldValues, unknown, TrackTransformedValues>;
};

export const TrackFormFields = ({ control }: TrackFormFieldsProps): ReactNode => (
    <Stack spacing={2}>
        <RhfTextField control={control} name="name" label="Name" required fullWidth />
        <RhfTextField
            control={control}
            name="externalKey"
            label="External key"
            helperText="Identifies this track to systems importing the schedule"
            fullWidth
        />
        <RhfTextField
            control={control}
            name="description"
            label="Description"
            multiline
            minRows={2}
            fullWidth
        />
        <RhfColorField control={control} name="color" label="Color" required fullWidth />
        <FormControlLabel
            control={<RhfSwitch control={control} name="internal" />}
            label="Internal"
        />
    </Stack>
);
