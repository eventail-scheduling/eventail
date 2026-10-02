import { Stack } from "@mui/material";
import { RhfAutocomplete, RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import type { Control, DefaultValues } from "react-hook-form";
import { z } from "zod/mini";
import { RhfAvailabilityField } from "#/components/AvailabilityField/index.js";
import type { LocationDetail } from "#/queries/location.ts";
import type { Venue } from "#/queries/venue.ts";
import { emptyToNullSchema, formRelationshipSchema, instantSchema } from "#/utils/zod.js";

export const locationFormSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1)),
    externalKey: emptyToNullSchema,
    venue: formRelationshipSchema,
    availabilities: z.array(
        z.object({
            startsAt: instantSchema,
            endsAt: instantSchema,
        }),
    ),
});

export type LocationFieldValues = z.input<typeof locationFormSchema>;
export type LocationTransformedValues = z.output<typeof locationFormSchema>;

export const locationAvailabilityDefaults = (
    location: LocationDetail | null,
): LocationFieldValues["availabilities"] =>
    location?.availabilities?.map((availability) => ({
        startsAt: availability.startsAt,
        endsAt: availability.endsAt,
    })) ?? [];

type LocationDefaults = {
    location: LocationDetail | null;
    venues: readonly Venue[];
};

/**
 * Resolves the stored venue to the one the picker offers, and seeds a lone one.
 *
 * A location carries its venue as linkage, which is an id and nothing else, so
 * handing that to the field would leave it naming a venue that has none.
 * Seeding a single venue saves picking from a list of one; with several the
 * field stays empty, so the organizer has to say which.
 */
const seedVenue = (location: LocationDetail | null, venues: readonly Venue[]) => {
    if (location) {
        return venues.find((venue) => venue.id === location.venue.id);
    }

    return venues.length === 1 ? venues[0] : undefined;
};

export const createLocationDefaultValues = ({
    location,
    venues,
}: LocationDefaults): DefaultValues<LocationFieldValues> => ({
    name: location?.name ?? "",
    externalKey: location?.externalKey ?? "",
    venue: seedVenue(location, venues),
    availabilities: locationAvailabilityDefaults(location),
});

type LocationFormFieldsProps = {
    control: Control<LocationFieldValues, unknown, LocationTransformedValues>;
    venues: readonly Venue[];
    startDate: Temporal.PlainDate;
    endDate: Temporal.PlainDate;
    timeZone: string;
};

export const LocationFormFields = ({
    control,
    venues,
    startDate,
    endDate,
    timeZone,
}: LocationFormFieldsProps): ReactNode => (
    <Stack spacing={3}>
        <Stack spacing={2}>
            <RhfTextField control={control} name="name" label="Name" required fullWidth />
            <RhfAutocomplete
                control={control}
                name="venue"
                options={venues}
                getOptionLabel={(option) => option.name}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={venues.length === 0}
                slotProps={{
                    textField: {
                        label: "Venue",
                        required: true,
                        helperText:
                            venues.length === 0
                                ? "Add a venue before adding a location: every location sits in one"
                                : undefined,
                    },
                }}
            />
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
