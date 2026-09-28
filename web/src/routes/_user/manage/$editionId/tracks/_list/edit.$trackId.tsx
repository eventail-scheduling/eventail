import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { useRowWhileListed } from "#/hooks/useRowWhileListed.ts";
import { useUpdateTrackMutation } from "#/mutations/track.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import {
    createTrackDefaultValues,
    type TrackFieldValues,
    TrackFormFields,
    type TrackTransformedValues,
    trackFormSchema,
} from "../-components/TrackFormFields.tsx";

const Root = (): ReactNode => {
    const { editionId, trackId } = Route.useParams();
    const [open, setOpen] = useState(true);
    const { goBack } = useGoBack({ to: "/manage/$editionId/tracks", params: { editionId } });
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const qof = useQueryOptionsFactory();
    const tracks = useSuspenseQuery(qof.track.list(editionId)).data;
    const updateMutation = useUpdateTrackMutation();

    const track = useRowWhileListed(tracks, trackId, () => {
        enqueueSnackbar("This track has been removed", { variant: "warning" });
        goBack();
    });

    const form = useForm<TrackFieldValues, unknown, TrackTransformedValues>({
        resolver: formResolver(trackFormSchema),
        defaultValues: createTrackDefaultValues(track),
    });

    const handleSubmit = (values: TrackTransformedValues) => {
        updateMutation.mutate(
            { editionId, id: trackId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Track has been updated", { variant: "success" });
                    setOpen(false);
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Dialog
            open={open}
            onClose={() => {
                setOpen(false);
            }}
            slotProps={{
                transition: {
                    onExited: () => {
                        goBack();
                    },
                },
                paper: {
                    component: "form",
                    noValidate: true,
                    onSubmit: form.handleSubmit(handleSubmit),
                },
            }}
            maxWidth="sm"
            fullWidth
            fullScreen={fullScreen}
        >
            <DialogTitle>Edit {track.name}</DialogTitle>
            <DialogContent dividers>
                <TrackFormFields control={form.control} />
            </DialogContent>
            <DialogActions>
                <Button
                    color="inherit"
                    onClick={() => {
                        setOpen(false);
                    }}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    loading={updateMutation.isPending}
                    disabled={!form.formState.isDirty}
                >
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/tracks/_list/edit/$trackId")({
    component: Root,
    loader: async ({ context, params }) => {
        const tracks = await context.queryClient.ensureQueryData(
            context.qof.track.list(params.editionId),
        );

        if (!tracks.some((candidate) => candidate.id === params.trackId)) {
            throw notFound();
        }
    },
});
