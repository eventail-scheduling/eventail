import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Alert, Box, Chip, Stack, Tooltip } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "material-ui-confirm";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { isAfterOrEqual } from "temporal-extra";
import { match, P } from "ts-pattern";
import {
    type Candidate,
    candidateMissingNote,
    candidateTiming,
    collisionCount,
    collisionWarnings,
    cornerAction,
    type DragSubject,
    findCollisions,
    GRID_CHROME_Z_INDEX,
    type MinuteSpan,
    newSlotFor,
    type PressPoint,
    type Refusal,
    type ScheduleAxis,
    ScheduleGrid,
    type SlotShape,
    unavailableRanges,
    useSlotDrag,
} from "#/components/ScheduleGrid/index.js";
import { SettleReportDialog } from "#/components/SettleReportDialog.js";
import { useDialogController } from "#/hooks/useDialogController.js";
import { usePublishScheduleMutation, useRevertScheduleMutation } from "#/mutations/schedule.ts";
import {
    useCreateSlotMutation,
    useDeleteSlotMutation,
    useUpdateSlotMutation,
} from "#/mutations/slot.ts";
import { type StartDateQuestion, startDateQuestion } from "#/queries/edition.js";
import type { Location } from "#/queries/location.js";
import type { Schedule, ScheduleSummary, Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import type { SlotsSettleReport } from "#/queries/settle.js";
import type { Venue } from "#/queries/venue.js";
import { defaultMutationErrorHandler, hasErrorCode } from "#/utils/api.ts";
import { DraftActions } from "./DraftActions.tsx";
import { CORNER_INSET, CORNER_SIZE, DropCorner } from "./DropCorner.tsx";
import { type PublicationPhase, PublishDialog } from "./PublishDialog.tsx";
import { RevertDialog } from "./RevertDialog.tsx";
import { RevertStartDateDialog } from "./RevertStartDateDialog.tsx";
import { ScheduleHeaderRow } from "./ScheduleHeaderRow.tsx";
import { SlotDetail } from "./SlotDetail.tsx";
import { shapedCandidate } from "./slot-shape.ts";
import { UnscheduledPanel } from "./UnscheduledPanel.tsx";
import { useMinuteStep } from "./useMinuteStep.ts";

type EditionReread = {
    /** True while the revert is pending, or while the reread after its refusal is out. */
    busy: boolean;
    rereadEditionThen: (next: () => void) => void;
};

/** Reads the edition again before `next` runs, reporting a failed read instead of running it. */
const useEditionReread = (editionId: string, revertPending: boolean): EditionReread => {
    const queryClient = useQueryClient();
    const [rereading, setRereading] = useState(false);

    const rereadEditionThen = (next: () => void) => {
        setRereading(true);
        queryClient
            .refetchQueries(
                { queryKey: ["edition", editionId], exact: true },
                { throwOnError: true },
            )
            .then(next, () => {
                enqueueSnackbar(
                    "The edition's dates could not be read again, so the question of where they went cannot be asked. Try again in a moment.",
                    { variant: "error" },
                );
            })
            .finally(() => {
                setRereading(false);
            });
    };

    return { busy: revertPending || rereading, rereadEditionThen };
};

/** One frozen empty list, so the grid's memo is not rebuilt every idle render. */
const noRanges: readonly MinuteSpan[] = [];

type NoteEnd = { top: number } | { bottom: number };

type ScheduleEditorProps = {
    editionId: string;
    axis: ScheduleAxis;
    locations: Location[];
    venues: readonly Venue[];
    draft: Schedule;
    sessions: SlottableSession[];
    schedules: ScheduleSummary[];
    /** Whether publishing would announce anything the publication does not. */
    unpublishedChanges: boolean;
    picker: ReactNode;
};

export const ScheduleEditor = ({
    editionId,
    axis,
    locations,
    venues,
    draft,
    sessions,
    schedules,
    unpublishedChanges,
    picker,
}: ScheduleEditorProps): ReactNode => {
    const gridBoxRef = useRef<HTMLDivElement>(null);
    /**
     * Held by id, so the panel never outlives the slot it describes.
     *
     * The draft refetches on its own, on a window focus and after every write,
     * and another organizer may have moved or removed this slot in between.
     */
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [step, setStep] = useMinuteStep();

    const collisions = useMemo(
        () => findCollisions(axis, draft.slots, sessions),
        [axis, draft.slots, sessions],
    );

    const warnings = useMemo(() => collisionWarnings(collisions), [collisions]);

    const confirm = useConfirm();
    const publishDialog = useDialogController();
    const publishSchedule = usePublishScheduleMutation();
    const revertDialog = useDialogController();
    const reportDialog = useDialogController();
    const revertSchedule = useRevertScheduleMutation();
    const [report, setReport] = useState<SlotsSettleReport | null>(null);
    const questionDialog = useDialogController();
    const [question, setQuestion] = useState<StartDateQuestion | null>(null);
    const { busy: reverting, rereadEditionThen } = useEditionReread(
        editionId,
        revertSchedule.isPending,
    );
    const createSlot = useCreateSlotMutation();
    const updateSlot = useUpdateSlotMutation();
    const deleteSlot = useDeleteSlotMutation();

    const place = (subject: DragSubject, candidate: Candidate) => {
        const target = {
            editionId,
            scheduleId: draft.id,
            locationId: candidate.locationId,
            ...candidateTiming(axis, candidate),
        };

        if (subject.kind === "create") {
            createSlot.mutate(
                { ...target, sessionId: subject.session.id },
                { onError: defaultMutationErrorHandler },
            );

            return;
        }

        updateSlot.mutate(
            { ...target, slotId: subject.slot.id },
            { onError: defaultMutationErrorHandler },
        );
    };

    const refuse = (refusal: Refusal) => {
        enqueueSnackbar(refusal.detail, { variant: "warning" });
    };

    const select = (slot: Slot) => {
        setSelectedId(slot.id);
    };

    const saveShape = (slot: Slot, shape: SlotShape) => {
        updateSlot.mutate(
            {
                editionId,
                scheduleId: draft.id,
                slotId: slot.id,
                locationId: slot.location.id,
                ...candidateTiming(axis, shapedCandidate(axis, slot, shape)),
            },
            {
                onSuccess: () => {
                    enqueueSnackbar("Slot has been updated", { variant: "success" });
                    setSelectedId(null);
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    /**
     * Takes a slot off after confirming, since a drag back makes a new one.
     *
     * It gets a fresh stableId and the session's current length rather than
     * whatever this one was given.
     */
    const remove = async (slot: Slot) => {
        const { confirmed } = await confirm({
            title: "Take a session off the schedule",
            description: `Do you really want to unschedule "${slot.session.title}"?`,
            confirmationText: "Take off",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteSlot.mutate(
            { editionId, scheduleId: draft.id, slotId: slot.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Session has been taken off the schedule", {
                        variant: "success",
                    });
                },
                onError: defaultMutationErrorHandler,
                onSettled: () => {
                    setSelectedId(null);
                },
            },
        );
    };

    const {
        drag,
        cornerRef,
        scrollRef,
        gridRef,
        handleRef,
        gridHandlers,
        startCreate,
        startMove,
        tapSlot,
    } = useSlotDrag({
        axis,
        slots: draft.slots,
        step,
        onPlace: place,
        onRefuse: refuse,
        onSelect: select,
        onRemove: remove,
    });

    const selected = draft.slots.find((slot) => slot.id === selectedId);
    const clashes = collisionCount(collisions);

    const published = schedules.some((schedule) => schedule.publishedAt !== null);

    /**
     * The publication a reversion copies from, which is the one the server takes.
     *
     * The server picks the highest sequence, which this document does not carry,
     * so this picks the latest published. A sequence is fixed when its draft is
     * created and drafts publish in that order, with the instant stamped from
     * the wall clock as each does, so the two agree unless that clock was
     * stepped back between publishes, which the server tolerates and this
     * cannot see.
     *
     * On an exact tie they agree only because of two things: the collection
     * arrives ordered by sequence descending, and `>= 0` keeps the incumbent, so
     * the earlier index and therefore the higher sequence wins. Narrowing that
     * to `> 0` would quietly take the lowest sequence instead.
     */
    const currentPublication = schedules.reduce<ScheduleSummary | null>((newest, schedule) => {
        if (schedule.publishedAt === null) {
            return newest;
        }

        if (newest === null || newest.publishedAt === null) {
            return schedule;
        }

        return isAfterOrEqual(newest.publishedAt, schedule.publishedAt) ? newest : schedule;
    }, null);

    /**
     * Whether any publication is final, which is what forbids a preliminary one.
     *
     * The server's own predicate rather than a reading of the newest one, so the
     * two cannot drift apart if the rule ever admits a preliminary after a final.
     */
    const finalPublished = schedules.some(
        (schedule) => schedule.publishedAt !== null && !schedule.preliminary,
    );

    /**
     * Throws the draft away and refills it from the last publication.
     *
     * The report is only shown when it names something: a reversion that fitted
     * everything reports an empty list, and a dialog saying nothing was lost is
     * a dialog in the way.
     */
    const revert = (startDateBecomes?: Temporal.PlainDate) => {
        revertSchedule.mutate(
            { editionId, scheduleId: draft.id, startDateBecomes },
            {
                onSuccess: (outcome) => {
                    revertDialog.dialogProps.onClose();
                    questionDialog.dialogProps.onClose();

                    if (outcome.kind === "unreadable") {
                        enqueueSnackbar(
                            "Draft schedule has been reverted, but this page could not read which" +
                                " sessions it could not keep. Check the draft for missing ones.",
                            { variant: "warning" },
                        );
                        return;
                    }

                    if (outcome.report.sessions.length > 0) {
                        setReport(outcome.report);
                        reportDialog.open();
                        return;
                    }

                    enqueueSnackbar("Draft schedule has been reverted", { variant: "success" });
                },
                onError: (error) => {
                    const asked = startDateQuestion(error);

                    if (!asked) {
                        defaultMutationErrorHandler(error);

                        // Its draft is a publication now, and the refetch has
                        // put a successor under whichever dialog asked.
                        if (hasErrorCode(error, "already_published")) {
                            revertDialog.dialogProps.onClose();
                            questionDialog.dialogProps.onClose();
                        }

                        return;
                    }

                    // The dialog reads the axis to say where the days went, and
                    // the page built that from the edition it cached, which
                    // another organizer may have moved since.
                    rereadEditionThen(() => {
                        setQuestion(asked);
                        revertDialog.dialogProps.onClose();
                        questionDialog.open();
                    });
                },
            },
        );
    };

    const publish = (phase: PublicationPhase) => {
        publishSchedule.mutate(
            { editionId, scheduleId: draft.id, preliminary: phase === "preliminary" },
            {
                onSuccess: () => {
                    publishDialog.dialogProps.onClose();
                    enqueueSnackbar(
                        phase === "preliminary"
                            ? "Schedule has been published as preliminary"
                            : "Schedule has been published as final",
                        { variant: "success" },
                    );
                },
                onError: (error) => {
                    defaultMutationErrorHandler(error);

                    // The draft this dialog was opened for is a publication now,
                    // and the refetch replaces it with its successor.
                    if (hasErrorCode(error, "already_published")) {
                        publishDialog.dialogProps.onClose();
                    }
                },
            },
        );
    };

    const startFromSidebar = (session: SlottableSession, press: PressPoint) => {
        startCreate(newSlotFor(session), press);
    };

    /**
     * The speakers of whatever is currently held, or none when nothing is.
     *
     * A move carries a slot rather than a session, and a slot's own session only
     * carries a title, so the hosts come from the list every slotted session is
     * already in.
     */
    const heldSession = match(drag?.subject)
        .with({ kind: "create" }, (subject) => subject.session)
        .with({ kind: "move" }, (subject) =>
            sessions.find((session) => session.id === subject.slot.session.id),
        )
        .with(P.nullish, () => undefined)
        .exhaustive();

    // Memoized on the held session rather than rebuilt each render: a drag
    // renders on every frame it moves, and the grid keys its own band memo on
    // this array's identity, so a fresh one each time defeats both.
    const unavailable: readonly MinuteSpan[] = useMemo(
        () => (heldSession ? unavailableRanges(axis, heldSession.hosts) : noRanges),
        [axis, heldSession],
    );

    const corner = cornerAction(drag);

    const clashLabel = clashes === 1 ? "1 speaker clash" : `${clashes.toString()} speaker clashes`;

    /**
     * Picks the end of the grid the drag note sits at, so it never covers the drop.
     *
     * Read against the grid's own middle rather than against the note's box: a
     * note that moved out from under the pointer would leave the pointer in the
     * half it had just left, and the two would trade places every frame.
     *
     * The raised end stops under the room names, which are pinned to the top of
     * the scroller and are the one thing a drag has to keep reading. Measured
     * from the header itself rather than from where the rooms begin: those two
     * agree only while the grid is at its start, and the columns climb out of
     * sight from there while the header stays put.
     *
     * The low end leaves the corner target its own band. That target is fixed to
     * the viewport while the note is absolute in the grid, and only the shell's
     * own bottom padding sits between the two, so nothing else keeps them apart.
     */
    const noteEnd = (): NoteEnd => {
        const box = gridBoxRef.current?.getBoundingClientRect();
        const header = gridBoxRef.current
            ?.querySelector('[data-testid="schedule-header"]')
            ?.getBoundingClientRect();

        if (box === undefined || drag === null || drag.at.clientY < box.top + box.height / 2) {
            return { bottom: CORNER_INSET + CORNER_SIZE + 8 };
        }

        return { top: header === undefined ? 8 : header.bottom - box.top + 8 };
    };

    // Nothing to go back to and nothing to clear, so the whole gesture would end
    // in a dialog offering to take sessions off a schedule that has none. The
    // other empty cases, an empty publication or a draft already equal to one,
    // cannot be told apart from here.
    const revertDisabled = !published && draft.slots.length === 0;
    const publishBlockedBy = unpublishedChanges
        ? null
        : "Nothing has changed since the last publication";

    const missingNote = candidateMissingNote(
        axis,
        heldSession?.hosts,
        drag?.candidate ?? null,
        drag?.refusal != null,
    );

    return (
        <Stack sx={{ flex: 1, minHeight: 0 }}>
            <ScheduleHeaderRow
                trailing={
                    <>
                        {clashes > 0 && (
                            // Counted in clashes rather than in people: one clash can
                            // hold two co-hosts, and one host can be in three of them.
                            // The number rather than the sentence, because this shares a
                            // row with controls a sentence pushes off the end of it, and
                            // the shell clips rather than scrolls, so what goes off is
                            // gone rather than merely out of sight.
                            <Tooltip title={clashLabel}>
                                <Chip
                                    icon={<WarningAmberIcon />}
                                    color="warning"
                                    variant="outlined"
                                    size="small"
                                    label={clashes.toString()}
                                    aria-label={clashLabel}
                                />
                            </Tooltip>
                        )}

                        <DraftActions
                            publishBlockedBy={publishBlockedBy}
                            revertDisabled={revertDisabled}
                            step={step}
                            onPublish={publishDialog.open}
                            onRevert={revertDialog.open}
                            onStepChange={setStep}
                        />
                    </>
                }
                picker={picker}
            />

            <Box sx={{ display: "flex", gap: 1, flex: 1, minHeight: 0 }}>
                <UnscheduledPanel
                    sessions={sessions}
                    slots={draft.slots}
                    dragging={drag !== null}
                    onStartDrag={startFromSidebar}
                />

                <Box
                    ref={gridBoxRef}
                    sx={{ minWidth: 0, flexGrow: 1, display: "flex", position: "relative" }}
                >
                    <ScheduleGrid
                        axis={axis}
                        locations={locations}
                        venues={venues}
                        slots={draft.slots}
                        step={step}
                        drag={drag}
                        warnings={warnings}
                        unavailable={unavailable}
                        selectedSlotId={selected?.id ?? null}
                        scrollRef={scrollRef}
                        gridRef={gridRef}
                        handleRef={handleRef}
                        gridHandlers={gridHandlers}
                        onStartMove={startMove}
                        onTapSlot={tapSlot}
                    />

                    {/* Over the grid rather than under it, so appearing costs
                        the grid no height. A line that pushed the rows would
                        move the very target the pointer is aiming at, and it
                        appears only while something is held. Wraps freely,
                        since the name is the part being communicated. */}
                    {missingNote !== undefined && (
                        <Alert
                            severity="warning"
                            variant="filled"
                            icon={<WarningAmberIcon fontSize="inherit" />}
                            sx={{
                                position: "absolute",
                                left: 8,
                                right: 8,
                                zIndex: GRID_CHROME_Z_INDEX + 1,
                                ...noteEnd(),
                                py: 0.25,
                                pointerEvents: "none",
                                alignItems: "center",
                            }}
                        >
                            {missingNote}
                        </Alert>
                    )}
                </Box>
            </Box>

            {corner !== null && (
                <DropCorner
                    cornerRef={cornerRef}
                    over={drag?.overCorner === true}
                    action={corner}
                />
            )}

            {publishDialog.mount && (
                <PublishDialog
                    placed={draft.slots.length}
                    clashes={clashes}
                    finalPublished={finalPublished}
                    publishing={publishSchedule.isPending}
                    onPublish={publish}
                    dialogProps={publishDialog.dialogProps}
                />
            )}

            {revertDialog.mount && (
                <RevertDialog
                    placed={draft.slots.length}
                    published={published}
                    reverting={reverting}
                    onRevert={revert}
                    dialogProps={revertDialog.dialogProps}
                />
            )}

            {reportDialog.mount && report && (
                <SettleReportDialog
                    report={report}
                    lead="Going back to the published schedule left these behind: each no longer fit the edition's days, would have changed length across a clock change, or would have overlapped another slot in its room."
                    dialogProps={reportDialog.dialogProps}
                />
            )}

            {questionDialog.mount && question && (
                <RevertStartDateDialog
                    question={question}
                    nextStartDate={axis.startsAt.toPlainDate()}
                    zoneChanges={currentPublication?.timeZone !== axis.timeZone}
                    pending={reverting}
                    onConfirm={revert}
                    dialogProps={questionDialog.dialogProps}
                />
            )}

            {selected && (
                // Keyed on the shape it opened against, so a draft that
                // refetches while this is open starts again from what the slot
                // now is. Seeded once, the fields would keep the old numbers
                // and saving would write another organizer's change back out.
                <SlotDetail
                    key={`${selected.id}:${selected.startsAt.toString()}:${selected.endsAt.toString()}:${selected.setupTime.toString()}:${selected.teardownTime.toString()}`}
                    slot={selected}
                    session={sessions.find((entry) => entry.id === selected.session.id)}
                    axis={axis}
                    slots={draft.slots}
                    collisions={collisions.get(selected.id) ?? []}
                    locations={locations}
                    timeZone={axis.timeZone}
                    removing={deleteSlot.isPending}
                    saving={updateSlot.isPending}
                    onRemove={remove}
                    onSave={saveShape}
                    onClose={() => {
                        setSelectedId(null);
                    }}
                />
            )}
        </Stack>
    );
};
