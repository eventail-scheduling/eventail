import { Box, Paper, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import {
    type ReactNode,
    type RefObject,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { match } from "ts-pattern";
import { columnIndexAt } from "#/components/AvailabilityField/geometry.js";
import { useLocale, useZonedRangeFormatters } from "#/components/LocaleProvider";
import { sessionStateLabels } from "#/components/SessionStateChip.tsx";
import type { Location } from "#/queries/location.js";
import type { Slot } from "#/queries/schedule.js";
import { slottableStates } from "#/queries/session.ts";
import type { Venue } from "#/queries/venue.js";
import {
    type BusinessHours,
    buildLayout,
    clamp,
    defaultBusinessHours,
    type GridLayout,
    type GridSegment,
    instantAtMinutes,
    MINUTES_PER_ROW,
    minutesAt,
    minutesAtTop,
    rowHeightFor,
    type ScheduleAxis,
    subdivisionSpacing,
    topAt,
    visibleRows,
} from "./geometry.js";
import {
    closedRanges,
    type MinuteSpan,
    type MinuteStep,
    occupiedRange,
    type Shoulders,
    slotOccupies,
    slotShoulders,
    slotSpan,
} from "./placement.js";
import { type BlockTone, ScheduleBlock } from "./ScheduleBlock.js";
import {
    draggedTitle,
    type GridHandlers,
    type PressPoint,
    type ScheduleGridHandle,
    type SlotDrag,
} from "./useSlotDrag.js";

/**
 * An hour is 36px, which fits a working day on a laptop.
 *
 * A taller hour shows less of a conference at a time, and the whole of one is
 * what this exists to let someone see.
 */
const PIXELS_PER_MINUTE = 0.6;
const ROW_HEIGHT = MINUTES_PER_ROW * PIXELS_PER_MINUTE;
const STUB_HEIGHT = 24;

/** One line of caption plus its padding, which is what a title needs. */
const READABLE_BLOCK = 22;

/** A single row may grow to this, past which the hour stops being an hour. */
const MAX_ROW_HEIGHT = 240;
const DAY_RULE_HEIGHT = 26;

/** The topmost layer the grid's own pinned chrome paints on. */
export const GRID_CHROME_Z_INDEX = 4;
const GUTTER_WIDTH = 64;

/**
 * Wide enough for a real title, since the grid scrolls under a pinned axis.
 *
 * Squeezing every room into the viewport truncates every block, and an edition
 * with a dozen rooms cannot fit that way regardless.
 */
const MIN_COLUMN_WIDTH = 172;

/**
 * Shading for the hours a room was not offered, which never refuses a placement.
 *
 * A room that named no availability is open throughout, so most editions draw
 * none of this. Flat rather than hatched, deliberately: the hatch belongs to a
 * slot's setup and teardown, which is time a session holds, and this is the
 * opposite claim. It also covers whole nights at a time, where a hatch is loud.
 */
const closedStyle = {
    position: "absolute",
    left: 0,
    right: 0,
    pointerEvents: "none",
    bgcolor: "rgba(128,128,128,0.1)",
} as const;

/**
 * When a dragged session's speakers are not free, shown only while it is held.
 *
 * Warning colored rather than gray, because a room that is closed is a fact
 * about the venue and this is a fact about people, which an organizer can
 * overrule by asking them. Absent unless something is being dragged: it answers
 * a question nobody is asking the rest of the time, and drawn always it would
 * compete with the room shading underneath it.
 */
const unavailableStyle = {
    position: "absolute",
    left: 0,
    right: 0,
    pointerEvents: "none",
    // Through the channel token rather than `alpha(theme.palette...)`, which
    // bakes in the default scheme's literal and never follows the active one.
    bgcolor: (theme: Theme) => `rgba(${theme.vars.palette.warning.mainChannel} / 0.14)`,
} as const;

/**
 * Draws the lines inside an hour that a gesture lands on, as one gradient.
 *
 * A line per step per row per room is thousands of elements on a long edition,
 * and this is a background on a box that is already drawn. Mid gray so one alpha
 * serves both themes, as the shoulder stripes do.
 *
 * A background begins at the padding edge while topAt measures from the border
 * edge, so the band written as ending on the boundary paints starting on it.
 * Both halves of that come from the one pixel border each row draws along its
 * top.
 */
const subdivisionBackground = (rowHeight: number, step: MinuteStep): string | undefined => {
    const spacing = subdivisionSpacing(rowHeight, step);

    if (spacing === undefined) {
        return undefined;
    }

    // A third of the weight of an hour rule on either theme, measured against a
    // paper of 18 dark and 255 light. Deliberately this faint: level with the
    // hour rule, an hour of these reads as uniform banding and the hour itself
    // stops being visible.
    const line = "rgba(128,128,128,0.08)";

    return `repeating-linear-gradient(to bottom, transparent, transparent ${(spacing - 1).toString()}px, ${line} ${(spacing - 1).toString()}px, ${line} ${spacing.toString()}px)`;
};

type SlotPresentation = {
    tone: BlockTone;
    tooltip: string;
    hint: string | undefined;
    warned: boolean;
};

/**
 * Tells a slot whose session may still be moved from one that only holds its place.
 *
 * A session leaving the slottable states keeps its slot, so an accidental
 * cancel does not cost the organizer where it was. The API refuses to move one,
 * and `held` is what withholds the handler here, which is also what drops the
 * grab cursor.
 */
const presentSlot = (slot: Slot, label: string, warning: string | undefined): SlotPresentation => {
    if (slottableStates.includes(slot.session.state)) {
        return {
            tone: "placed",
            tooltip: warning === undefined ? label : `${label} (also booked: ${warning})`,
            hint: undefined,
            warned: warning !== undefined,
        };
    }

    const state = sessionStateLabels[slot.session.state];

    return {
        tone: "held",
        tooltip: `${label} (${state.toLowerCase()})`,
        hint: state,
        warned: false,
    };
};

const bandStyle = (segment: GridSegment) => ({
    position: "absolute" as const,
    top: segment.top,
    height: segment.height,
    width: "100%",
    borderTop: segment.kind === "day" ? 2 : 1,
    borderColor: segment.kind === "day" ? "text.secondary" : "divider",
});

const segmentKey = (segment: GridSegment): string =>
    segment.kind === "stub"
        ? `stub-${segment.from.toString()}`
        : `${segment.kind}-${segment.index.toString()}`;

type BlockGeometry = {
    top: number;
    height: number;
    setup: number;
    teardown: number;
};

/**
 * Measures where a span draws through the layout rather than by scale.
 *
 * The hour a block sits in may have grown to fit a short slot, so a minute is
 * worth more pixels in one row than in the next.
 */
const blockGeometry = (
    layout: GridLayout,
    span: MinuteSpan,
    shoulders: Shoulders,
): BlockGeometry | null => {
    const top = topAt(layout, span.from);
    const bottom = topAt(layout, span.to);

    if (top === undefined || bottom === undefined) {
        return null;
    }

    const occupied = occupiedRange(span, shoulders);

    return {
        top,
        height: bottom - top,
        setup: top - (topAt(layout, occupied.from) ?? top),
        teardown: (topAt(layout, occupied.to) ?? bottom) - bottom,
    };
};

type ClosedBand = {
    key: string;
    top: number;
    height: number;
};

/**
 * Shades closed time by walking the segments rather than the ranges.
 *
 * A range's edge can land past the last row drawn or inside a collapsed run,
 * where there is no pixel to measure from, and measuring the range would then
 * drop the whole band including the part that is on screen. Segments tile the
 * layout, so every closed minute that is drawn at all gets covered. A collapsed
 * run takes the shading whole, having no inside to divide.
 */
const closedBands = (layout: GridLayout, closed: readonly MinuteSpan[]): ClosedBand[] =>
    layout.segments.flatMap((segment): ClosedBand[] => {
        // A day rule stands for no minutes of its own, but it has height inside
        // whatever surrounds it, so a night spanning it would otherwise be cut
        // in two. Shaded by the day it announces.
        if (segment.kind === "day") {
            const opens = segment.index * MINUTES_PER_ROW;

            return closed.some((range) => opens >= range.from && opens < range.to)
                ? [
                      {
                          key: `${segment.top.toString()}-day`,
                          top: segment.top,
                          height: segment.height,
                      },
                  ]
                : [];
        }

        const first = segment.kind === "row" ? segment.index : segment.from;
        const last = segment.kind === "row" ? segment.index : segment.to;
        const span = { from: first * MINUTES_PER_ROW, to: (last + 1) * MINUTES_PER_ROW };

        return closed.flatMap((range): ClosedBand[] => {
            const from = Math.max(range.from, span.from);
            const to = Math.min(range.to, span.to);

            if (to <= from) {
                return [];
            }

            if (segment.kind === "stub") {
                return [
                    {
                        key: `${segment.top.toString()}-${range.from.toString()}`,
                        top: segment.top,
                        height: segment.height,
                    },
                ];
            }

            const scale = segment.height / MINUTES_PER_ROW;

            return [
                {
                    key: `${segment.top.toString()}-${range.from.toString()}`,
                    top: segment.top + (from - span.from) * scale,
                    height: (to - from) * scale,
                },
            ];
        });
    });

type ScheduleGridProps = {
    axis: ScheduleAxis;
    locations: Location[];
    /**
     * Named under each room, but only once an edition has more than one.
     *
     * With one venue the line says the same thing in every column, and every
     * line in this header costs a visible hour row.
     */
    venues: readonly Venue[];
    slots: Slot[];
    businessHours?: BusinessHours;
    /** Drawn inside each hour, so a gesture has something to aim at. */
    step: MinuteStep;
    drag: SlotDrag | null;
    /** Slots wanted by someone who is somewhere else, to the names of those people. */
    warnings: ReadonlyMap<string, string>;
    /** When the held session's speakers are not free; drawn only while one is held. */
    unavailable: readonly MinuteSpan[];
    selectedSlotId: string | null;
    scrollRef: RefObject<HTMLDivElement | null>;
    gridRef: RefObject<HTMLDivElement | null>;
    handleRef: RefObject<ScheduleGridHandle | null>;
    /**
     * Absent where the grid is read only, which is how it becomes read only.
     *
     * A block already drops its grab cursor when given no handler, so leaving
     * these out is the whole of it.
     */
    gridHandlers?: GridHandlers;
    onStartMove?: (slot: Slot, press: PressPoint) => void;
    /** Opens a slot for a finger, whose tap never becomes a gesture to release. */
    onTapSlot?: (slot: Slot) => void;
};

export const ScheduleGrid = ({
    axis,
    locations,
    venues,
    slots,
    businessHours = defaultBusinessHours,
    step,
    drag,
    warnings,
    unavailable,
    selectedSlotId,
    scrollRef,
    gridRef,
    handleRef,
    gridHandlers,
    onStartMove,
    onTapSlot,
}: ScheduleGridProps): ReactNode => {
    const { timeFormatter, monthDayFormatter } = useLocale();
    const { timeRangeFormatter } = useZonedRangeFormatters(axis.timeZone);
    const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
    const columnRefs = useRef<(HTMLDivElement | null)[]>([]);

    const layout = useMemo(() => {
        const visible = visibleRows({
            axis,
            occupied: slots.map((slot) => slotOccupies(axis, slot)),
            expanded,
            businessHours,
        });

        const shortest = new Map<number, number>();

        for (const slot of slots) {
            const minutes = slot.endsAt.since(slot.startsAt).total("minutes");
            const first = Math.floor(minutesAt(axis, slot.startsAt) / MINUTES_PER_ROW);

            shortest.set(first, Math.min(shortest.get(first) ?? minutes, minutes));
        }

        return buildLayout(
            axis,
            visible,
            (index) =>
                rowHeightFor(ROW_HEIGHT, shortest.get(index), READABLE_BLOCK, MAX_ROW_HEIGHT),
            STUB_HEIGHT,
            DAY_RULE_HEIGHT,
        );
    }, [axis, slots, expanded, businessHours]);

    const expand = useCallback((from: number, to: number) => {
        setExpanded((current) => {
            const next = new Set(current);

            for (let index = from; index <= to; ++index) {
                next.add(index);
            }

            // The same set rather than an equal one, so a gesture running this
            // on every frame does not lay the grid out again each time.
            return next.size === current.size ? current : next;
        });
    }, []);

    // Rebuilt only when the layout or the rooms do. The drag re-renders this
    // component on every frame it scrolls, and these do not depend on it.
    const closedByRoom = useMemo(
        () =>
            new Map(
                locations.map((location) => [
                    location.id,
                    closedBands(layout, closedRanges(axis, location.availabilities ?? [])),
                ]),
            ),
        [axis, layout, locations],
    );

    // Same treatment, and the same reason: a drag re-renders this on every frame.
    // Only holds if the caller keeps the array identity stable across those
    // frames, which the editor does by memoizing on the held session.
    const unavailableBands = useMemo(() => closedBands(layout, unavailable), [layout, unavailable]);

    const candidate = drag?.candidate;

    /**
     * Opens the hours a gesture has reached into, and closes none again.
     *
     * A candidate longer than the row it starts in can end inside a collapsed
     * run, which has no pixel to draw that edge on. Only ever growing the set is
     * what keeps this from oscillating: a row appearing under the pointer
     * changes which minute the pointer is on, which would change whether that
     * row was wanted at all.
     */
    useEffect(() => {
        if (!candidate) {
            return;
        }

        const occupied = occupiedRange(candidate.span, candidate.shoulders);

        expand(
            Math.floor(occupied.from / MINUTES_PER_ROW),
            Math.ceil(occupied.to / MINUTES_PER_ROW) - 1,
        );
    }, [candidate, expand]);

    useImperativeHandle(
        handleRef,
        () => ({
            minutesAt: (clientY) => {
                const column = columnRefs.current[0];

                if (!column) {
                    return undefined;
                }

                const rect = column.getBoundingClientRect();

                return minutesAtTop(
                    layout,
                    clamp(clientY - rect.top, 0, Math.max(layout.height - 1, 0)),
                );
            },
            locationIdAt: (clientX) => {
                const found = columnIndexAt(columnRefs.current.slice(0, locations.length), clientX);

                return found === -1 ? undefined : locations[found].id;
            },
        }),
        [layout, locations],
    );

    const clockAt = (index: number) =>
        timeFormatter.format(axis.rows[index].startsAt.toPlainTime());

    const timeRange = (span: MinuteSpan) =>
        timeRangeFormatter.formatRange(
            instantAtMinutes(axis, span.from),
            instantAtMinutes(axis, span.to),
        );

    const venueNames = useMemo(
        () => (venues.length > 1 ? new Map(venues.map((venue) => [venue.id, venue.name])) : null),
        [venues],
    );

    const headerStyle = {
        position: "sticky",
        top: 0,
        zIndex: 2,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
    } as const;

    /**
     * The clock stays put when the rooms scroll under it.
     *
     * Losing the time axis is worst exactly when it is needed: an edition with
     * enough rooms to scroll sideways.
     */
    const pinnedLeft = {
        position: "sticky",
        left: 0,
        zIndex: 3,
        bgcolor: "background.paper",
    } as const;

    const movingSlotId =
        drag?.moved === true && drag.subject.kind === "move" ? drag.subject.slot.id : null;

    return (
        <Paper ref={scrollRef} data-testid="schedule-scroller" sx={{ overflow: "auto", flex: 1 }}>
            {/* One grid rather than a header grid over a body grid, so a column
                cannot drift away from the room it is labeled with. */}
            <Box
                ref={gridRef}
                {...gridHandlers}
                sx={{
                    display: "grid",
                    gridTemplateColumns: `${GUTTER_WIDTH.toString()}px repeat(${locations.length.toString()}, minmax(${MIN_COLUMN_WIDTH.toString()}px, 1fr))`,
                    userSelect: drag ? "none" : undefined,
                }}
            >
                <Box
                    data-testid="schedule-header"
                    sx={{ ...headerStyle, ...pinnedLeft, zIndex: GRID_CHROME_Z_INDEX }}
                />

                {locations.map((location) => (
                    <Box
                        key={location.id}
                        sx={{ ...headerStyle, px: 1, py: 0.5, textAlign: "center" }}
                    >
                        <Typography variant="subtitle2" noWrap>
                            {location.name}
                        </Typography>
                        {venueNames && (
                            <Typography
                                variant="caption"
                                noWrap
                                color="text.secondary"
                                sx={{ display: "block" }}
                            >
                                {venueNames.get(location.venue.id)}
                            </Typography>
                        )}
                    </Box>
                ))}

                <Box sx={{ ...pinnedLeft, height: layout.height }}>
                    {layout.segments.map((segment) =>
                        match(segment)
                            .with({ kind: "day" }, (day) => (
                                <Box
                                    key={segmentKey(day)}
                                    sx={{
                                        position: "absolute",
                                        top: day.top,
                                        height: day.height,
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        pl: 0.5,
                                        borderTop: 2,
                                        borderColor: "text.secondary",
                                        // The rooms tint this band, and the
                                        // gutter already tints its stubs, so
                                        // leaving it out here breaks the band at
                                        // the gutter edge.
                                        bgcolor: "action.hover",
                                    }}
                                >
                                    <Typography
                                        variant="caption"
                                        noWrap
                                        sx={{ fontWeight: "bold" }}
                                    >
                                        {monthDayFormatter.format(
                                            axis.rows[day.index].startsAt.toPlainDate(),
                                        )}
                                    </Typography>
                                </Box>
                            ))
                            .with({ kind: "row" }, (row) => (
                                <Box
                                    key={segmentKey(row)}
                                    sx={{
                                        position: "absolute",
                                        top: row.top,
                                        height: row.height,
                                        width: "100%",
                                        borderTop: 1,
                                        borderColor: "divider",
                                        pr: 0.5,
                                        textAlign: "right",
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary">
                                        {clockAt(row.index)}
                                    </Typography>
                                </Box>
                            ))
                            .with({ kind: "stub" }, (stub) => (
                                <Box
                                    key={segmentKey(stub)}
                                    component="button"
                                    type="button"
                                    onClick={() => {
                                        expand(stub.from, stub.to);
                                    }}
                                    title={`Show ${(stub.to - stub.from + 1).toString()} hours between ${clockAt(stub.from)} and ${clockAt(stub.to)}`}
                                    sx={{
                                        position: "absolute",
                                        top: stub.top,
                                        height: stub.height,
                                        width: "100%",
                                        border: 0,
                                        borderTop: 1,
                                        borderColor: "divider",
                                        p: 0,
                                        bgcolor: "action.hover",
                                        color: "text.secondary",
                                        cursor: "pointer",
                                        fontSize: 10,
                                    }}
                                >
                                    {`+${(stub.to - stub.from + 1).toString()}h`}
                                </Box>
                            ))
                            .exhaustive(),
                    )}
                </Box>

                {locations.map((location, index) => {
                    const closed = closedByRoom.get(location.id) ?? [];

                    const ghost =
                        candidate && candidate.locationId === location.id
                            ? blockGeometry(layout, candidate.span, candidate.shoulders)
                            : null;

                    return (
                        <Box
                            key={location.id}
                            data-testid={`schedule-room-${index.toString()}`}
                            ref={(element: HTMLDivElement | null) => {
                                columnRefs.current[index] = element;
                            }}
                            sx={{
                                position: "relative",
                                height: layout.height,
                                borderLeft: 1,
                                borderColor: "divider",
                            }}
                        >
                            {layout.segments.map((segment) =>
                                segment.kind === "stub" ? (
                                    // The band a collapsed run draws across the
                                    // rooms opens it too, so the whole row is the
                                    // target rather than the label in the gutter.
                                    // Hidden from assistive tech and out of the
                                    // tab order: the gutter button is this same
                                    // action, named once.
                                    <Box
                                        key={segmentKey(segment)}
                                        component="button"
                                        type="button"
                                        aria-hidden
                                        tabIndex={-1}
                                        onClick={() => {
                                            expand(segment.from, segment.to);
                                        }}
                                        sx={{
                                            ...bandStyle(segment),
                                            p: 0,
                                            border: 0,
                                            borderTop: 1,
                                            borderColor: "divider",
                                            cursor: "pointer",
                                            bgcolor: "action.hover",
                                        }}
                                    />
                                ) : (
                                    <Box
                                        key={segmentKey(segment)}
                                        data-testid={
                                            segment.kind === "row"
                                                ? `schedule-row-${segment.index.toString()}`
                                                : undefined
                                        }
                                        sx={{
                                            ...bandStyle(segment),
                                            // The band is what marks a new day.
                                            // Undrawn it reads as an empty hour,
                                            // and one sitting between two real
                                            // ones is the easier to mistake.
                                            bgcolor:
                                                segment.kind === "day" ? "action.hover" : undefined,
                                            backgroundImage:
                                                segment.kind === "row"
                                                    ? subdivisionBackground(segment.height, step)
                                                    : undefined,
                                        }}
                                    />
                                ),
                            )}

                            {drag &&
                                unavailableBands.map((band) => (
                                    <Box
                                        key={`unavailable-${band.key}`}
                                        data-testid="unavailable-band"
                                        sx={{
                                            ...unavailableStyle,
                                            top: band.top,
                                            height: band.height,
                                        }}
                                    />
                                ))}

                            {closed.map((band) => (
                                <Box
                                    key={band.key}
                                    data-testid="schedule-closed"
                                    sx={{ ...closedStyle, top: band.top, height: band.height }}
                                />
                            ))}

                            {slots
                                .filter((slot) => slot.location.id === location.id)
                                .map((slot) => {
                                    const span = slotSpan(axis, slot);
                                    const geometry = blockGeometry(
                                        layout,
                                        span,
                                        slotShoulders(slot),
                                    );

                                    if (geometry === null) {
                                        return null;
                                    }

                                    const shown = presentSlot(
                                        slot,
                                        `${timeRange(span)} ${slot.session.title}`,
                                        warnings.get(slot.id),
                                    );

                                    return (
                                        <ScheduleBlock
                                            key={slot.id}
                                            {...geometry}
                                            testId="schedule-block"
                                            title={slot.session.title}
                                            tooltip={shown.tooltip}
                                            hint={shown.hint}
                                            warned={shown.warned}
                                            tone={shown.tone}
                                            faded={slot.id === movingSlotId}
                                            selected={slot.id === selectedSlotId}
                                            onStartMove={
                                                shown.tone === "held" || onStartMove === undefined
                                                    ? undefined
                                                    : (press) => {
                                                          onStartMove(slot, press);
                                                      }
                                            }
                                            onTap={
                                                onTapSlot === undefined
                                                    ? undefined
                                                    : () => {
                                                          onTapSlot(slot);
                                                      }
                                            }
                                        />
                                    );
                                })}

                            {drag && candidate && ghost && (
                                <ScheduleBlock
                                    {...ghost}
                                    testId="schedule-ghost"
                                    title={draggedTitle(drag.subject)}
                                    tone={drag.refusal ? "refused" : "candidate"}
                                    hint={drag.refusal?.detail ?? timeRange(candidate.span)}
                                />
                            )}
                        </Box>
                    );
                })}
            </Box>
        </Paper>
    );
};
