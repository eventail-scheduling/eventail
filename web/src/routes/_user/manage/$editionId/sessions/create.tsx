import { Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import {
    orderedBuiltInFieldNames,
    sessionFormSteps,
} from "#/components/SessionFormFields/index.js";
import { useQueryOptionsFactory } from "#/queries";
import { requireManager } from "#/utils/route-guards.ts";
import { SessionCreateForm } from "./-components/SessionCreateForm.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition, sessionFieldSpecs, uploadLimits } = useSuspenseQuery(
        qof.edition.get(editionId),
    ).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const sessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const tracks = useSuspenseQuery(qof.track.list(editionId)).data;

    const builtInFieldNames = useMemo(
        () =>
            orderedBuiltInFieldNames(
                edition.sessionFieldOptions,
                sessionFieldSpecs,
                sessionFormSteps[0]?.groups[0]?.fields ?? [],
            ),
        [edition, sessionFieldSpecs],
    );

    return (
        <Stack spacing={3} sx={{ mt: 2 }}>
            <Typography variant="h5">Create session</Typography>

            <SessionCreateForm
                editionId={editionId}
                edition={edition}
                specs={sessionFieldSpecs}
                fieldNames={builtInFieldNames}
                sessionTypes={sessionTypes}
                tracks={tracks}
                customFields={customFields}
                uploadLimits={uploadLimits}
            />
        </Stack>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/sessions/create")({
    beforeLoad: requireManager,
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.customField.list(params.editionId));
    },
});
