import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { type ReactNode, useMemo } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod/mini";
import { RhfDurationField } from "#/components/DurationField/index.js";
import { useLocale, useZonedRangeFormatters } from "#/components/LocaleProvider";
import {
    type Collision,
    type ScheduleAxis,
    type SlotShape,
    sessionShape,
} from "#/components/ScheduleGrid/index.js";
import { sessionStateLabels } from "#/components/SessionStateChip.tsx";
import type { Location } from "#/queries/location.js";
import type { Slot } from "#/queries/schedule.js";
import { type SlottableSession, slottableStates } from "#/queries/session.js";
import { durationToMinutes } from "#/utils/duration.ts";
import { durationSchema, formResolver } from "#/utils/zod.js";
import { completeShape, sameShape, shapeRefusal, slotShape } from "./slot-shape.ts";

const shapeFormSchema = z.object({
    length: durationSchema,
    setupTime: durationSchema,
    teardownTime: durationSchema,
});

/**
 * What the form is declared to hold, which is not all it can hold.
 *
 * The schema refuses an absent duration, so nothing missing reaches a submit,
 * but a field hands back null while its text is empty and this type does not
 * admit it. `completeShape` is what stands between that and a render.
 */
type ShapeFieldValues = z.input<typeof shapeFormSchema>;

type SlotDetailProps = {
    slot: Slot;
    /**
     * What the session itself asks for.
     *
     * Absent for a slot whose session has left the slottable states, since the
     * list this comes from holds only the sessions that may still be placed.
     */
    session: SlottableSession | undefined;
    axis: ScheduleAxis;
    /** Everything already placed, which is what a new shape has to fit among. */
    slots: Slot[];
    locations: Location[];
    /** Everywhere else this slot's speakers are wanted while it runs. */
    collisions: Collision[];
    timeZone: string;
    removing: boolean;
    saving: boolean;
    onRemove: (slot: Slot) => void;
    onSave: (slot: Slot, shape: SlotShape) => void;
    onClose: () => void;
};

export const SlotDetail = ({
    slot,
    session,
    axis,
    slots,
    locations,
    collisions,
    timeZone,
    removing,
    saving,
    onRemove,
    onSave,
    onClose,
}: SlotDetailProps): ReactNode => {
    const { timeFormatter } = useLocale();
    const { weekdayDateTimeRangeFormatter } = useZonedRangeFormatters(timeZone);
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const room = locations.find((location) => location.id === slot.location.id);
    // The API refuses to reshape one of these, so the dialog offers only what
    // it will accept: taking the slot off, which is how the room is freed.
    const held = !slottableStates.includes(slot.session.state);
    const asked = useMemo(() => (session ? sessionShape(session) : null), [session]);

    const placed = slotShape(slot);

    const form = useForm<ShapeFieldValues, unknown, SlotShape>({
        resolver: formResolver(shapeFormSchema),
        defaultValues: placed,
    });

    const shape = completeShape(form.watch());
    const refusal = shape === null ? null : shapeRefusal(axis, slots, slot, shape);

    const clock = (instant: Temporal.Instant) =>
        timeFormatter.format(instant.toZonedDateTimeISO(timeZone).toPlainTime());

    const when = weekdayDateTimeRangeFormatter.formatRange(slot.startsAt, slot.endsAt);

    // Named one by one rather than counted: an organizer resolving a clash needs
    // to know which session to move, and there are rarely more than a couple.
    //
    // The room is part of that name, not decoration. Only a room refuses an
    // overlap, so the same session can sit in two of them at one time, and
    // without the room those two clashes read as one sentence printed twice.
    const clashes = collisions.map((collision) => {
        const who = collision.hostNames.join(" and ");
        const where = locations.find((location) => location.id === collision.slot.location.id);
        const what = `"${collision.slot.session.title}" in ${where?.name ?? "an unknown room"}`;

        const clashAt = `${what} at ${clock(collision.slot.startsAt)}`;

        // Whose margin it is goes unsaid on purpose: either end can own it, and
        // this same sentence is read from both.
        const sentence = collision.marginOnly
            ? `${who} on ${clashAt}, near enough that the setup or teardown either side overlaps`
            : `${who} on ${clashAt}`;

        return { id: collision.slot.id, sentence };
    });

    const asksFor = (of: keyof SlotShape) =>
        asked === null
            ? undefined
            : `Session asks for ${durationToMinutes(asked[of]).toString()} min`;

    return (
        <Dialog
            open
            fullScreen={fullScreen}
            fullWidth
            maxWidth="xs"
            onClose={onClose}
            slotProps={{
                paper: {
                    component: "form",
                    noValidate: true,
                    onSubmit: form.handleSubmit((values) => {
                        onSave(slot, values);
                    }),
                },
            }}
        >
            <DialogTitle>{slot.session.title}</DialogTitle>

            <DialogContent>
                <Stack spacing={0.5} sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        {when}
                    </Typography>

                    <Typography variant="body2" color="text.secondary">
                        {room?.name ?? "Unknown room"}
                    </Typography>
                </Stack>

                {held && (
                    <Alert severity="info">
                        {`This session is ${sessionStateLabels[slot.session.state].toLowerCase()}.`}
                        {" Its slot holds the room until you take it off the schedule."}
                    </Alert>
                )}

                <Stack spacing={2} sx={{ display: held ? "none" : undefined }}>
                    <RhfDurationField
                        control={form.control}
                        name="length"
                        label="Length"
                        required
                        helperText={asksFor("length")}
                    />

                    <RhfDurationField
                        control={form.control}
                        name="setupTime"
                        label="Setup"
                        required
                        helperText={asksFor("setupTime")}
                    />

                    <RhfDurationField
                        control={form.control}
                        name="teardownTime"
                        label="Teardown"
                        required
                        helperText={asksFor("teardownTime")}
                    />
                </Stack>

                {refusal && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        {refusal.detail}
                    </Alert>
                )}

                {clashes.length > 0 && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <Stack spacing={0.5}>
                            {clashes.map((clash) => (
                                <Typography key={clash.id} variant="body2">
                                    {`Also booked: ${clash.sentence}`}
                                </Typography>
                            ))}
                        </Stack>
                    </Alert>
                )}
            </DialogContent>

            <DialogActions>
                <Button
                    type="button"
                    color="error"
                    loading={removing}
                    sx={{ mr: "auto" }}
                    onClick={() => {
                        onRemove(slot);
                    }}
                >
                    Take off the schedule
                </Button>

                {!held && asked !== null && (
                    <Button
                        type="button"
                        disabled={shape !== null && sameShape(shape, asked)}
                        onClick={() => {
                            form.reset(asked);
                        }}
                    >
                        Use the session's
                    </Button>
                )}

                <Button type="button" onClick={onClose}>
                    Cancel
                </Button>

                {!held && (
                    <Button
                        type="submit"
                        variant="contained"
                        loading={saving}
                        disabled={shape === null || refusal !== null || sameShape(shape, placed)}
                    >
                        Save
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
