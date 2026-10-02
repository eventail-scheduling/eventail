import { JsonApiError } from "@jsonapi-serde/client";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { IconButtonLink } from "#/components/Link/index.js";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useUpdateVenueMutation } from "#/mutations/venue.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import {
    createVenueDefaultValues,
    type VenueFieldValues,
    VenueFormFields,
    type VenueTransformedValues,
    venueFormSchema,
} from "./-components/VenueFormFields.tsx";

const Root = (): ReactNode => {
    const { editionId, venueId } = Route.useParams();
    const { goBack, goBackProps } = useGoBack({
        to: "/manage/$editionId/venues",
        params: { editionId },
    });
    const qof = useQueryOptionsFactory();
    const venue = useSuspenseQuery(qof.venue.detail(editionId, venueId)).data;
    const updateMutation = useUpdateVenueMutation();

    const form = useForm<VenueFieldValues, unknown, VenueTransformedValues>({
        resolver: formResolver(venueFormSchema),
        defaultValues: createVenueDefaultValues(venue),
    });
    const leaveGuard = useLeaveGuard(form);

    const handleSubmit = (values: VenueTransformedValues) => {
        updateMutation.mutate(
            { editionId, id: venueId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Venue has been updated", { variant: "success" });
                    leaveGuard.release();
                    goBack();
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
                <IconButtonLink {...goBackProps} aria-label="Back to venues">
                    <ArrowBackIcon />
                </IconButtonLink>
                <Typography variant="h5">Edit {venue.name}</Typography>
            </Stack>

            <Paper
                component="form"
                noValidate
                onSubmit={form.handleSubmit(handleSubmit)}
                sx={{ p: 3 }}
            >
                <Stack spacing={3}>
                    <VenueFormFields control={form.control} />

                    <div>
                        <Button
                            type="submit"
                            variant="contained"
                            loading={updateMutation.isPending}
                            disabled={!form.formState.isDirty}
                        >
                            Save venue
                        </Button>
                    </div>
                </Stack>
            </Paper>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/venues/edit/$venueId")({
    component: Root,
    loader: async ({ context, params }) => {
        try {
            await context.queryClient.ensureQueryData(
                context.qof.venue.detail(params.editionId, params.venueId),
            );
        } catch (error) {
            if (error instanceof JsonApiError && error.status === 404) {
                throw notFound();
            }

            throw error;
        }
    },
});
