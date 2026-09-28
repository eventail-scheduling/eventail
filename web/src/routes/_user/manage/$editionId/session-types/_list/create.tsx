import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { createFileRoute } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { useCreateSessionTypeMutation } from "#/mutations/session-type.ts";
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
    const { editionId } = Route.useParams();
    const [open, setOpen] = useState(true);
    const { goBack } = useGoBack({
        to: "/manage/$editionId/session-types",
        params: { editionId },
    });
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const createMutation = useCreateSessionTypeMutation();

    const form = useForm<SessionTypeFieldValues, unknown, SessionTypeTransformedValues>({
        resolver: formResolver(sessionTypeFormSchema),
        defaultValues: createSessionTypeDefaultValues(null),
    });

    const handleSubmit = (values: SessionTypeTransformedValues) => {
        createMutation.mutate(
            { editionId, ...values },
            {
                onSuccess: () => {
                    enqueueSnackbar("Session type has been created", { variant: "success" });
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
            <DialogTitle>Create session type</DialogTitle>
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
                <Button type="submit" loading={createMutation.isPending}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/session-types/_list/create")({
    component: Root,
});
