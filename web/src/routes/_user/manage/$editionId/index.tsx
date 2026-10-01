import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_user/manage/$editionId/")({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: "/manage/$editionId/sessions",
            params: { editionId: params.editionId },
        });
    },
});
