import { Stack } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";
import { z } from "zod/mini";
import type { VenueDetail } from "#/queries/venue.ts";
import { emptyToNullSchema } from "#/utils/zod.js";

export const venueFormSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1)),
    address: emptyToNullSchema,
    externalKey: emptyToNullSchema,
});

export type VenueFieldValues = z.input<typeof venueFormSchema>;
export type VenueTransformedValues = z.output<typeof venueFormSchema>;

export const createVenueDefaultValues = (venue: VenueDetail | null): VenueFieldValues => ({
    name: venue?.name ?? "",
    address: venue?.address ?? "",
    externalKey: venue?.externalKey ?? "",
});

type VenueFormFieldsProps = {
    control: Control<VenueFieldValues, unknown, VenueTransformedValues>;
};

export const VenueFormFields = ({ control }: VenueFormFieldsProps): ReactNode => (
    <Stack spacing={2}>
        <RhfTextField control={control} name="name" label="Name" required fullWidth />
        <RhfTextField
            control={control}
            name="address"
            label="Address"
            multiline
            minRows={2}
            helperText="Published in the schedule, so anything reading it can show it"
            fullWidth
        />
        <RhfTextField
            control={control}
            name="externalKey"
            label="External key"
            helperText="Identifies this venue to systems importing the schedule"
            fullWidth
        />
    </Stack>
);
