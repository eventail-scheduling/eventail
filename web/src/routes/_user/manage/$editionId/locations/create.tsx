import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { IconButtonLink } from "#/components/Link/index.js";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useCreateLocationMutation } from "#/mutations/location.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler, hasErrorCode } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import { useEdition } from "../-components/EditionProvider.tsx";
import {
    createLocationDefaultValues,
    type LocationFieldValues,
    LocationFormFields,
    type LocationTransformedValues,
    locationFormSchema,
} from "./-components/LocationFormFields.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const edition = useEdition();
    const { goBack, goBackProps } = useGoBack({
        to: "/manage/$editionId/locations",
        params: { editionId },
    });
    const qof = useQueryOptionsFactory();
    const queryClient = useQueryClient();
    const createMutation = useCreateLocationMutation();

    const form = useForm<LocationFieldValues, unknown, LocationTransformedValues>({
        resolver: formResolver(locationFormSchema),
        defaultValues: createLocationDefaultValues(null),
    });
    const leaveGuard = useLeaveGuard(form);

    /**
     * Discards what was drawn, since the window it was drawn against has moved.
     *
     * A location that does not exist yet has nothing to read back, and a block
     * outside the window it now has would be out of reach (see AvailabilityField's
     * `startDate`), leaving no way to save. The days are read first so that
     * anything drawn next is drawn against them.
     */
    const reloadAfterWindowMoved = async () => {
        await queryClient.fetchQuery(qof.edition.get(editionId));

        form.resetField("availabilities", {
            defaultValue: createLocationDefaultValues(null).availabilities,
        });

        enqueueSnackbar(
            "The edition's dates changed while this was open, so the availability has been cleared. Draw it against the days now shown.",
            { variant: "warning" },
        );
    };

    const handleSubmit = (values: LocationTransformedValues) => {
        createMutation.mutate(
            { editionId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Location has been created", { variant: "success" });
                    leaveGuard.release();
                    goBack();
                },
                onError: (error) => {
                    if (hasErrorCode(error, "outside_edition")) {
                        reloadAfterWindowMoved().catch(() => {
                            enqueueSnackbar(
                                "The edition's dates changed while this was open, and the new ones could not be read. Reload the page before drawing again.",
                                { variant: "error" },
                            );
                        });
                        return;
                    }

                    defaultMutationErrorHandler(error);
                },
            },
        );
    };

    return (
        <>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
                <IconButtonLink {...goBackProps} aria-label="Back to locations">
                    <ArrowBackIcon />
                </IconButtonLink>
                <Typography variant="h5">Add location</Typography>
            </Stack>

            <Paper
                component="form"
                noValidate
                onSubmit={form.handleSubmit(handleSubmit)}
                sx={{ p: 3 }}
            >
                <Stack spacing={3}>
                    <LocationFormFields
                        control={form.control}
                        startDate={edition.startDate}
                        endDate={edition.endDate}
                        timeZone={edition.timeZone}
                    />

                    <div>
                        <Button
                            type="submit"
                            variant="contained"
                            loading={createMutation.isPending}
                        >
                            Create location
                        </Button>
                    </div>
                </Stack>
            </Paper>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/locations/create")({
    component: Root,
});
