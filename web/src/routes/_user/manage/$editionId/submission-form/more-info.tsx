import { Box, Stack } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import { useQueryOptionsFactory } from "#/queries/index.js";
import { CustomFieldList } from "./-components/CustomFieldList.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;

    return (
        <Stack spacing={3}>
            <CustomFieldList editionId={editionId} customFields={customFields} />
            <Box>
                <ButtonLink to="/manage/$editionId/custom-fields" params={{ editionId }}>
                    Manage custom fields
                </ButtonLink>
            </Box>
        </Stack>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/submission-form/more-info")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.customField.list(params.editionId));
    },
});
