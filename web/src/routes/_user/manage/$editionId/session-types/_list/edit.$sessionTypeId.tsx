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
import { useUpdateSessionTypeMutation } from "#/mutations/session-type.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import {
    createSessionTypeDefaultValues,
    type SessionTypeFieldValues,
    SessionTypeFormFields,
    type SessionTypeTransformedValues,
    sessionTypeFormSchema,
} from "../-components/SessionTypeFormFields.tsx";

const Root = (): ReactNode => {
    const { editionId, sessionTypeId } = Route.useParams();
    const [open, setOpen] = useState(true);
    const { goBack } = useGoBack({
        to: "/manage/$editionId/session-types",
        params: { editionId },
    });
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const qof = useQueryOptionsFactory();
    const sessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const updateMutation = useUpdateSessionTypeMutation();

    const sessionType = useRowWhileListed(sessionTypes, sessionTypeId, () => {
        enqueueSnackbar("This session type has been removed", { variant: "warning" });
        goBack();
    });

    const form = useForm<SessionTypeFieldValues, unknown, SessionTypeTransformedValues>({
        resolver: formResolver(sessionTypeFormSchema),
        defaultValues: createSessionTypeDefaultValues(sessionType),
    });

    const handleSubmit = (values: SessionTypeTransformedValues) => {
        updateMutation.mutate(
            { editionId, id: sessionTypeId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Session type has been updated", { variant: "success" });
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
            <DialogTitle>Edit {sessionType.name}</DialogTitle>
            <DialogContent dividers>
                <SessionTypeFormFields control={form.control} />
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

export const Route = createFileRoute(
    "/_user/manage/$editionId/session-types/_list/edit/$sessionTypeId",
)({
    component: Root,
    loader: async ({ context, params }) => {
        const sessionTypes = await context.queryClient.ensureQueryData(
            context.qof.sessionType.list(params.editionId),
        );

        if (!sessionTypes.some((candidate) => candidate.id === params.sessionTypeId)) {
            throw notFound();
        }
    },
});
