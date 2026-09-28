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
import { useRowWhileListed } from "#/hooks/useRowWhileListed.ts";
import { useUpdateCustomFieldMutation } from "#/mutations/custom-field.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import { useEdition } from "../-components/EditionProvider.tsx";
import { CustomFieldFormFields } from "./-components/CustomFieldFormFields.tsx";
import {
    buildCustomFieldPayload,
    type CustomFieldInputValues,
    type CustomFieldTransformedValues,
    createCustomFieldDefaultValues,
    customFieldFormSchema,
} from "./-components/schema.ts";
import { ensureScopeOptions } from "./-components/scope-options.ts";

const Root = (): ReactNode => {
    const { editionId, customFieldId } = Route.useParams();
    const edition = useEdition();
    const qof = useQueryOptionsFactory();
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const sessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const tracks = useSuspenseQuery(qof.track.list(editionId)).data;
    const { goBack, goBackProps } = useGoBack({
        to: "/manage/$editionId/custom-fields",
        params: { editionId },
    });
    const updateMutation = useUpdateCustomFieldMutation();

    const customField = useRowWhileListed(customFields, customFieldId, () => {
        enqueueSnackbar("This custom field has been removed", { variant: "warning" });
        leaveGuard.release();
        goBack();
    });

    const form = useForm<CustomFieldInputValues, unknown, CustomFieldTransformedValues>({
        resolver: formResolver(customFieldFormSchema),
        defaultValues: createCustomFieldDefaultValues(
            customField,
            { sessionTypes, tracks },
            edition.timeZone,
        ),
    });
    const leaveGuard = useLeaveGuard(form);

    const handleSubmit = (values: CustomFieldTransformedValues) => {
        updateMutation.mutate(
            { editionId, id: customFieldId, ...buildCustomFieldPayload(values) },
            {
                onSuccess: () => {
                    enqueueSnackbar("Custom field has been updated", { variant: "success" });
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
                <IconButtonLink {...goBackProps} aria-label="Back to custom fields">
                    <ArrowBackIcon />
                </IconButtonLink>
                <Typography variant="h5">Edit {customField.title}</Typography>
            </Stack>

            <Paper
                component="form"
                noValidate
                onSubmit={form.handleSubmit(handleSubmit)}
                sx={{ p: 3 }}
            >
                <Stack spacing={3}>
                    <CustomFieldFormFields
                        control={form.control}
                        sessionTypes={sessionTypes}
                        tracks={tracks}
                        timeZone={edition.timeZone}
                        isExisting
                    />

                    <div>
                        <Button
                            type="submit"
                            variant="contained"
                            loading={updateMutation.isPending}
                            disabled={!form.formState.isDirty}
                        >
                            Save custom field
                        </Button>
                    </div>
                </Stack>
            </Paper>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/custom-fields/edit/$customFieldId")({
    component: Root,
    loader: async ({ context, params }) => {
        const customFields = await context.queryClient.ensureQueryData(
            context.qof.customField.list(params.editionId),
        );

        const customField = customFields.find((candidate) => candidate.id === params.customFieldId);

        if (!customField) {
            throw notFound();
        }

        await ensureScopeOptions(context.queryClient, context.qof, params.editionId, customField);
    },
});
