import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_user/manage/$editionId/submission-form/")({
    beforeLoad: ({ params }) => {
        throw redirect({
            to: "/manage/$editionId/submission-form/session",
            params,
            replace: true,
        });
    },
});
