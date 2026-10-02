import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { createFileRoute } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { IconButtonLink } from "#/components/Link/index.js";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useCreateVenueMutation } from "#/mutations/venue.ts";
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
    const { editionId } = Route.useParams();
    const { goBack, goBackProps } = useGoBack({
        to: "/manage/$editionId/venues",
        params: { editionId },
    });
    const createMutation = useCreateVenueMutation();

    const form = useForm<VenueFieldValues, unknown, VenueTransformedValues>({
        resolver: formResolver(venueFormSchema),
        defaultValues: createVenueDefaultValues(null),
    });
    const leaveGuard = useLeaveGuard(form);

    const handleSubmit = (values: VenueTransformedValues) => {
        createMutation.mutate(
            { editionId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Venue has been created", { variant: "success" });
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
                <Typography variant="h5">Add venue</Typography>
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
                            loading={createMutation.isPending}
                        >
                            Create venue
                        </Button>
                    </div>
                </Stack>
            </Paper>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/venues/create")({
    component: Root,
});
