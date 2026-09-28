import { Button, Container, Paper, Typography } from "@mui/material";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEventHandler, type ReactNode, useRef } from "react";
import { z } from "zod/mini";
import {
    CurrentUserForm,
    type CurrentUserTransformedValues,
} from "#/components/CurrentUser/index.js";
import { useUpdateCurrentUserMutation } from "#/mutations/user.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { resolveSameOriginPath } from "#/utils/url.ts";

const Root = (): ReactNode => {
    const { editableFields, returnTo } = Route.useSearch();
    const updateCurrentUserMutation = useUpdateCurrentUserMutation();
    const onSubmitRef = useRef<FormEventHandler | undefined>(undefined);

    const handleSubmit = (data: CurrentUserTransformedValues) => {
        updateCurrentUserMutation.mutate(data, {
            onSuccess: () => {
                window.location.replace(returnTo);
            },
            onError: defaultMutationErrorHandler,
        });
    };

    return (
        <Container maxWidth="xs" sx={{ my: 2 }}>
            <Paper sx={{ p: 2 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                    Create your profile
                </Typography>

                <form onSubmit={(event) => onSubmitRef.current?.(event)} noValidate>
                    <CurrentUserForm
                        user={null}
                        editableFields={editableFields}
                        onSubmit={handleSubmit}
                        onSubmitRef={onSubmitRef}
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        loading={updateCurrentUserMutation.isPending}
                    >
                        Continue
                    </Button>
                </form>
            </Paper>
        </Container>
    );
};

export const Route = createFileRoute("/create-profile")({
    component: Root,
    validateSearch: z.object({
        editableFields: z.array(z.enum(["displayName", "emailAddress"])),
        returnTo: z.catch(
            z.pipe(
                z.string(),
                z.transform((value) => resolveSameOriginPath(value, window.location.origin) ?? "/"),
            ),
            "/",
        ),
    }),
});
