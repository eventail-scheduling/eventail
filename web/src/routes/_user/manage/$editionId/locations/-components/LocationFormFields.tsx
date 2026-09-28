import { Stack } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";
import { z } from "zod/mini";
import { RhfAvailabilityField } from "#/components/AvailabilityField/index.js";
import type { LocationDetail } from "#/queries/location.ts";
import { externalKeySchema, instantSchema } from "#/utils/zod.js";

export const locationFormSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1)),
    externalKey: externalKeySchema,
    availabilities: z.array(
        z.object({
            startsAt: instantSchema,
            endsAt: instantSchema,
        }),
    ),
});

export type LocationFieldValues = z.input<typeof locationFormSchema>;
export type LocationTransformedValues = z.output<typeof locationFormSchema>;

export const createLocationDefaultValues = (
    location: LocationDetail | null,
): LocationFieldValues => ({
    name: location?.name ?? "",
    externalKey: location?.externalKey ?? "",
    availabilities:
        location?.availabilities?.map((availability) => ({
            startsAt: availability.startsAt,
            endsAt: availability.endsAt,
        })) ?? [],
});

type LocationFormFieldsProps = {
    control: Control<LocationFieldValues, unknown, LocationTransformedValues>;
    startDate: Temporal.PlainDate;
    endDate: Temporal.PlainDate;
    timeZone: string;
};

export const LocationFormFields = ({
    control,
    startDate,
    endDate,
    timeZone,
}: LocationFormFieldsProps): ReactNode => (
    <Stack spacing={3}>
        <Stack spacing={2}>
            <RhfTextField control={control} name="name" label="Name" required fullWidth />
            <RhfTextField
                control={control}
                name="externalKey"
                label="External key"
                helperText="Identifies this location to systems importing the schedule"
                fullWidth
            />
        </Stack>

        <RhfAvailabilityField
            control={control}
            name="availabilities"
            label="Availability"
            emptyText="This location is usable at any time during the edition. Drag on the grid to limit it to the times you draw."
            drawnText="This location is usable only at the times drawn below. Clear them all to make it usable throughout."
            startDate={startDate}
            endDate={endDate}
            timeZone={timeZone}
            helperText="Drag to draw a block, drag its edges to adjust it, and click a block twice to remove it"
        />
    </Stack>
);
