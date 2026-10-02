import { JsonApiError } from "@jsonapi-serde/client";
import { Alert } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { buildScheduleAxis } from "#/components/ScheduleGrid/index.js";
import { useQueryOptionsFactory } from "#/queries";
import { PublicationView } from "./-components/PublicationView.tsx";
import { ShowingPicker } from "./-components/ShowingPicker.tsx";

const Root = (): ReactNode => {
    const { editionId, scheduleId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const locations = useSuspenseQuery(qof.location.list(editionId)).data;
    const venues = useSuspenseQuery(qof.venue.list(editionId)).data;
    const publication = useSuspenseQuery(qof.schedule.get(editionId, scheduleId)).data;

    const { startDate, endDate, timeZone } = publication;
    const axis = useMemo(
        () =>
            startDate && endDate && timeZone
                ? buildScheduleAxis(startDate, endDate, timeZone)
                : null,
        [startDate, endDate, timeZone],
    );

    if (!axis) {
        // The API writes the three window columns exactly when it writes
        // publishedAt, so this is unreachable for anything the picker offers.
        return (
            <Alert severity="warning">This schedule carries no window to read it against.</Alert>
        );
    }

    return (
        <PublicationView
            axis={axis}
            slots={publication.slots}
            locations={locations}
            venues={venues}
            picker={<ShowingPicker editionId={editionId} showing={scheduleId} />}
        />
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/schedule/$scheduleId")({
    loader: async ({ context, params }) => {
        // Read from the list rather than from the document below, which is
        // fetched without an observer on this path and would still answer from
        // a five minute old copy after the draft it describes was published.
        const schedules = await context.queryClient.ensureQueryData(
            context.qof.schedule.list(params.editionId),
        );

        // The working draft has a route of its own, where it can be changed.
        // Offered here it would read as unchangeable, which it is not.
        if (schedules.find((schedule) => schedule.id === params.scheduleId)?.publishedAt === null) {
            throw redirect({
                to: "/manage/$editionId/schedule",
                params: { editionId: params.editionId },
            });
        }

        try {
            await context.queryClient.ensureQueryData(
                context.qof.schedule.get(params.editionId, params.scheduleId),
            );
        } catch (error) {
            if (error instanceof JsonApiError && error.status === 404) {
                throw notFound();
            }

            throw error;
        }
    },
    component: Root,
});
