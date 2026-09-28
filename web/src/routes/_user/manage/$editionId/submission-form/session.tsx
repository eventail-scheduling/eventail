import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryOptionsFactory } from "#/queries/index.js";
import { BuiltInFieldList } from "./-components/BuiltInFieldList.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition, sessionFieldSpecs } = useSuspenseQuery(qof.edition.get(editionId)).data;

    return (
        <BuiltInFieldList
            editionId={editionId}
            scope="session"
            fieldOptions={edition.sessionFieldOptions}
            specs={sessionFieldSpecs}
        />
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/submission-form/session")({
    component: Root,
});
