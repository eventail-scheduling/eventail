import { Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryOptionsFactory } from "#/queries/index.js";
import { BuiltInFieldList } from "./-components/BuiltInFieldList.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition, profileFieldSpecs } = useSuspenseQuery(qof.edition.get(editionId)).data;

    return (
        <Stack spacing={3}>
            <Typography color="text.secondary">
                What a speaker tells you once per edition rather than once per session.
            </Typography>

            <BuiltInFieldList
                editionId={editionId}
                scope="profile"
                fieldOptions={edition.profileFieldOptions}
                specs={profileFieldSpecs}
            />
        </Stack>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/submission-form/profile")({
    component: Root,
});
