import { JsonApiError } from "@jsonapi-serde/client";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { IconButtonLink } from "#/components/Link/index.js";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useUpdateLocationMutation } from "#/mutations/location.ts";
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
    const { editionId, locationId } = Route.useParams();
    const edition = useEdition();
    const { goBack, goBackProps } = useGoBack({
        to: "/manage/$editionId/locations",
        params: { editionId },
    });
    const qof = useQueryOptionsFactory();
    const queryClient = useQueryClient();
    const location = useSuspenseQuery(qof.location.detail(editionId, locationId)).data;
    const updateMutation = useUpdateLocationMutation();

    const form = useForm<LocationFieldValues, unknown, LocationTransformedValues>({
        resolver: formResolver(locationFormSchema),
        defaultValues: createLocationDefaultValues(location),
    });
    const leaveGuard = useLeaveGuard(form);

    /**
     * Reads the edition and the location back, which is the only way out.
     *
     * The window this form drew against has moved, and the server has already
     * settled the stored availability into the new one. What is on screen cannot
     * be saved, and the blocks that no longer fit cannot be removed by hand
     * either (see AvailabilityField's `startDate`).
     */
    const reloadAfterWindowMoved = async () => {
        await queryClient.fetchQuery(qof.edition.get(editionId));
        const settled = await queryClient.fetchQuery(qof.location.detail(editionId, locationId));

        form.resetField("availabilities", {
            defaultValue: createLocationDefaultValues(settled).availabilities,
        });

        enqueueSnackbar(
            "The edition's dates changed while this was open. The availability shown is what it settled to; change it if that is not what you want.",
            { variant: "warning" },
        );
    };

    const handleSubmit = (values: LocationTransformedValues) => {
        updateMutation.mutate(
            { editionId, id: locationId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Location has been updated", { variant: "success" });
                    leaveGuard.release();
                    goBack();
                },
                onError: (error) => {
                    if (hasErrorCode(error, "outside_edition")) {
                        reloadAfterWindowMoved().catch(() => {
                            enqueueSnackbar(
                                "The edition's dates changed while this was open, and the new ones could not be read. Reload the page before saving.",
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
                <Typography variant="h5">Edit {location.name}</Typography>
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
                            loading={updateMutation.isPending}
                            disabled={!form.formState.isDirty}
                        >
                            Save location
                        </Button>
                    </div>
                </Stack>
            </Paper>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/locations/edit/$locationId")({
    component: Root,
    loader: async ({ context, params }) => {
        try {
            await context.queryClient.ensureQueryData(
                context.qof.location.detail(params.editionId, params.locationId),
            );
        } catch (error) {
            if (error instanceof JsonApiError && error.status === 404) {
                throw notFound();
            }

            throw error;
        }
    },
});
