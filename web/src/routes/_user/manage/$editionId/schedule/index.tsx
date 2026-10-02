import { Alert } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import { buildScheduleAxis } from "#/components/ScheduleGrid/index.js";
import { useQueryOptionsFactory } from "#/queries";
import { fulfillsRole } from "#/utils/role.ts";
import { PublicationView } from "./-components/PublicationView.tsx";
import { ScheduleEditor } from "./-components/ScheduleEditor.tsx";
import { DRAFT, ShowingPicker } from "./-components/ShowingPicker.tsx";
import { hasUnpublishedChanges } from "./-utils/publication.ts";

type DraftEditorProps = Omit<ComponentProps<typeof ScheduleEditor>, "sessions">;

/**
 * Holds the one read a caller below manager must not make.
 *
 * The API withholds host availability from them, so the relationship the
 * slottable query declares would be absent and the parse would fail. A
 * component that is not rendered runs no hook, which is what keeps them out of
 * it, and `ScheduleEditor` stays testable on props alone.
 */
const DraftEditor = ({ editionId, ...rest }: DraftEditorProps): ReactNode => {
    const qof = useQueryOptionsFactory();
    const sessions = useSuspenseQuery(qof.session.slottable(editionId)).data;

    return <ScheduleEditor editionId={editionId} sessions={sessions} {...rest} />;
};

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const locations = useSuspenseQuery(qof.location.list(editionId)).data;
    const venues = useSuspenseQuery(qof.venue.list(editionId)).data;
    const draft = useSuspenseQuery(qof.schedule.latest(editionId)).data;
    const schedules = useSuspenseQuery(qof.schedule.list(editionId)).data;
    const publication = useSuspenseQuery(qof.schedule.current(editionId)).data;

    const axis = useMemo(
        () => buildScheduleAxis(edition.startDate, edition.endDate, edition.timeZone),
        [edition],
    );

    if (locations.length === 0) {
        return (
            <Alert severity="info">
                Add a location before scheduling: a session is placed in a room at a time.
            </Alert>
        );
    }

    if (!fulfillsRole(currentUser, "manager")) {
        // The draft rather than the publication, because a viewer is on the
        // organizing side and the question there is what is being planned.
        return (
            <PublicationView
                axis={axis}
                slots={draft.slots}
                locations={locations}
                venues={venues}
                picker={<ShowingPicker editionId={editionId} showing={DRAFT} />}
            />
        );
    }

    return (
        <DraftEditor
            editionId={editionId}
            unpublishedChanges={hasUnpublishedChanges(draft, publication, edition)}
            picker={<ShowingPicker editionId={editionId} showing={DRAFT} />}
            axis={axis}
            locations={locations}
            venues={venues}
            draft={draft}
            schedules={schedules}
        />
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/schedule/")({
    // Ensured here rather than left to the component: an uncached
    // useSuspenseQuery throws before the next one has been asked for, so the
    // reads no ancestor already covers arrive one round trip after another,
    // and a hover warms none of them.
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.schedule.latest(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.schedule.current(params.editionId)),
            ...(fulfillsRole(context.currentUser, "manager")
                ? [
                      context.queryClient.ensureQueryData(
                          context.qof.session.slottable(params.editionId),
                      ),
                  ]
                : []),
        ]);
    },
    component: Root,
});
