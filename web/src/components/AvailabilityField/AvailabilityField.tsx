import { Box, FormControl, FormHelperText, FormLabel, Typography, useTheme } from "@mui/material";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useLocale } from "#/components/LocaleProvider/index.js";
import type { AvailabilityInterval } from "#/utils/availability.ts";
import { AvailabilityBlock } from "./AvailabilityBlock.js";
import { buildGrid, dayOf, plainTimeAt, wallTimeAt } from "./geometry.ts";
import { useAvailabilityDrag } from "./useAvailabilityDrag.ts";

const HOUR_HEIGHT = 44;
const HEADER_HEIGHT = 44;
const GUTTER_WIDTH = 60;
const MIN_COLUMN_WIDTH = 132;
const INITIAL_SCROLL_HOUR = 8;

type RowLabel = {
    hour: string;
    offset?: string;
};

export type AvailabilityFieldProps = {
    value: readonly AvailabilityInterval[];
    onValueChange: (value: AvailabilityInterval[]) => void;
    /**
     * The first day of the window the grid shows.
     *
     * A stored interval outside the window collapses to nothing on the grid, so
     * it cannot be found there, and the next edit to any block drops it from the
     * value. A caller that moves the window has to settle the value into it.
     */
    startDate: Temporal.PlainDate;
    /** The last day of the window, inclusive. */
    endDate: Temporal.PlainDate;
    timeZone: string;
    label?: string;
    helperText?: string;
    emptyText: string;
    drawnText: string;
    error?: boolean;
    disabled?: boolean;
    name?: string;
    onBlur?: () => void;
};

export const AvailabilityField = ({
    value,
    onValueChange,
    startDate,
    endDate,
    timeZone,
    label,
    helperText,
    emptyText,
    drawnText,
    error = false,
    disabled = false,
    name,
    onBlur,
}: AvailabilityFieldProps): ReactNode => {
    const theme = useTheme();
    const { resolvedLocale, timeFormatter } = useLocale();

    const grid = useMemo(
        () => buildGrid(startDate, endDate, timeZone),
        [startDate, endDate, timeZone],
    );
    const { days, axis } = grid;
    const { minutesPerColumn } = axis;

    const {
        previewRanges,
        missingByDay,
        selected,
        scrollRef,
        gridRef,
        columnRefs,
        gridHandlers,
        startCreate,
        startMove,
        startResize,
    } = useAvailabilityDrag({ grid, value, onValueChange, onBlur, disabled });

    const dayFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(resolvedLocale, {
                weekday: "short",
                day: "numeric",
                month: "numeric",
            }),
        [resolvedLocale],
    );

    const rowLabels = useMemo(
        (): RowLabel[] =>
            axis.rows.map((row) => {
                const hour = timeFormatter.format(plainTimeAt(row.hour * 60));

                if (row.offset === undefined) {
                    return { hour };
                }

                return { hour, offset: row.offset };
            }),
        [axis.rows, timeFormatter],
    );

    /**
     * Leaves the separator to the locale.
     *
     * The locale writes 9時30分～17時00分 and 上午9:00至下午5:00 rather than anything a
     * dash of ours would produce. German's trailing "Uhr" and the width CJK
     * takes are the price of not guessing, and the label is a convenience
     * anyway: the block's place on the grid is what says when it is.
     */
    const formatRange = useCallback(
        (fromMinutes: number, toMinutes: number): string =>
            timeFormatter.formatRange(wallTimeAt(axis, fromMinutes), wallTimeAt(axis, toMinutes)),
        [timeFormatter, axis],
    );

    const openingRow = Math.max(
        axis.rows.findIndex((row) => row.hour === INITIAL_SCROLL_HOUR),
        0,
    );

    // Depending on the row rather than the rows: the array is rebuilt whenever
    // the grid is, and scrolling the user back to the morning on an unrelated
    // render throws away where they were.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: openingRow * HOUR_HEIGHT + 1 });
    }, [openingRow, scrollRef]);

    const chromeSurface = {
        bgcolor: "background.paper",
        backgroundImage: `linear-gradient(${theme.vars.palette.action.hover}, ${theme.vars.palette.action.hover}), var(--Paper-overlay, none)`,
    };

    return (
        <FormControl fullWidth error={error} disabled={disabled} component="fieldset" name={name}>
            {label !== undefined && (
                <FormLabel component="legend" sx={{ mb: 1 }}>
                    {label}
                </FormLabel>
            )}

            {/*
             * Always here, saying whichever of the two things is true. Drawing
             * the first block is what makes the other true, and taking the line
             * away at that moment would move the grid out from under the
             * pointer that had just drawn it.
             */}
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                {value.length === 0 ? emptyText : drawnText}
            </Typography>

            <Box
                sx={{
                    border: 1,
                    borderColor: error ? "error.main" : theme.vars.palette.TableCell.border,
                    borderRadius: 1,
                    overflow: "hidden",
                }}
            >
                <Box
                    ref={scrollRef}
                    data-testid="availability-scroller"
                    sx={{
                        overflow: "auto",
                        maxHeight: 560,
                        // On a Firefox whose GPU probe failed, so that most
                        // GPU features are blocklisted, glyphs paint about a
                        // pixel outside this clip while boxes stay inside it,
                        // and slivers of the scrolled-away hours show on the
                        // frame above. A fresh profile does not show it. Its
                        // own compositing layer is what holds them in.
                        transform: "translateZ(0)",
                    }}
                >
                    <Box
                        ref={gridRef}
                        {...gridHandlers}
                        onDragStart={(event) => {
                            event.preventDefault();
                        }}
                        sx={{
                            display: "grid",
                            "--hour-height": `${HOUR_HEIGHT}px`,
                            gridTemplateColumns: `max-content repeat(${days.length}, minmax(max-content, 1fr))`,
                            gridTemplateRows: `${HEADER_HEIGHT}px repeat(${axis.rows.length}, var(--hour-height))`,
                            minWidth: "fit-content",
                            userSelect: "none",
                        }}
                    >
                        <Box
                            sx={{
                                gridColumn: 1,
                                gridRow: 1,
                                position: "sticky",
                                top: 0,
                                insetInlineStart: 0,
                                zIndex: 4,
                                ...chromeSurface,
                                borderBottom: 1,
                                borderColor: theme.vars.palette.TableCell.border,
                            }}
                        />

                        {days.map((day, dayIndex) => (
                            <Box
                                key={day.toString()}
                                sx={{
                                    gridColumn: dayIndex + 2,
                                    gridRow: 1,
                                    position: "sticky",
                                    top: 0,
                                    zIndex: 3,
                                    minWidth: MIN_COLUMN_WIDTH,
                                    px: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    ...chromeSurface,
                                    borderBottom: 1,
                                    borderInlineStart: "1px solid",
                                    borderColor: theme.vars.palette.TableCell.border,
                                }}
                            >
                                <Typography variant="subtitle2" noWrap>
                                    {dayFormatter.format(day)}
                                </Typography>
                            </Box>
                        ))}

                        {axis.rows.slice(1).map((row, index) => (
                            <Box
                                key={`rule-${row.hour}-${row.offset ?? ""}`}
                                aria-hidden
                                sx={{
                                    gridColumn: "2 / -1",
                                    gridRow: index + 3,
                                    pointerEvents: "none",
                                    borderTop: 1,
                                    borderColor: theme.vars.palette.TableCell.border,
                                }}
                            />
                        ))}

                        <Box
                            aria-hidden
                            sx={{
                                gridColumn: 1,
                                gridRow: "2 / -1",
                                position: "sticky",
                                insetInlineStart: 0,
                                zIndex: 1,
                                ...chromeSurface,
                            }}
                        />

                        {axis.rows.map((row, index) => (
                            <Box
                                key={`hour-${row.hour}-${row.offset ?? ""}`}
                                aria-hidden
                                sx={{
                                    gridColumn: 1,
                                    gridRow: index + 2,
                                    position: "sticky",
                                    insetInlineStart: 0,
                                    zIndex: 2,
                                    minWidth: GUTTER_WIDTH,
                                    px: 1,
                                }}
                            >
                                <Box
                                    sx={{
                                        textAlign: "end",
                                        pt: "2px",
                                    }}
                                >
                                    <Typography
                                        variant="caption"
                                        noWrap
                                        sx={{
                                            display: "block",
                                            color: "text.secondary",
                                        }}
                                    >
                                        {rowLabels[index].hour}
                                    </Typography>

                                    {rowLabels[index].offset !== undefined && (
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                display: "block",
                                                height: 0,
                                                overflow: "visible",
                                                whiteSpace: "nowrap",
                                                fontSize: "0.85em",
                                                lineHeight: 1.2,
                                                opacity: 0.75,
                                                color: "text.secondary",
                                            }}
                                        >
                                            {rowLabels[index].offset}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        ))}

                        {days.map((day, dayIndex) => {
                            const dayStart = dayIndex * minutesPerColumn;

                            return (
                                <Box
                                    key={day.toString()}
                                    ref={(element: HTMLDivElement | null) => {
                                        columnRefs.current[dayIndex] = element;
                                    }}
                                    data-testid={`availability-day-${dayIndex}`}
                                    onPointerDown={(event) => {
                                        startCreate(dayIndex, event);
                                    }}
                                    sx={{
                                        gridColumn: dayIndex + 2,
                                        gridRow: "2 / -1",
                                        position: "relative",
                                        borderInlineStart: "1px solid",
                                        borderColor: theme.vars.palette.TableCell.border,
                                        // Panning both ways and pinch zoom stay
                                        // the browser's until a long press arms a
                                        // gesture; double tap to zoom goes, since
                                        // a second tap here removes a block.
                                        touchAction: "manipulation",
                                        cursor: disabled ? "default" : "crosshair",
                                    }}
                                >
                                    {missingByDay[dayIndex].map((range) => (
                                        <Box
                                            key={range.from}
                                            title="The clocks skip this hour on this day"
                                            sx={{
                                                position: "absolute",
                                                insetInline: 0,
                                                top: `${(range.from / minutesPerColumn) * 100}%`,
                                                height: `${((range.to - range.from) / minutesPerColumn) * 100}%`,
                                                zIndex: 1,
                                                pointerEvents: "none",
                                                backgroundImage: `repeating-linear-gradient(45deg, ${theme.vars.palette.action.disabledBackground} 0 5px, transparent 5px 10px)`,
                                            }}
                                        />
                                    ))}

                                    {previewRanges.map((range, index) =>
                                        dayOf(minutesPerColumn, range.from) === dayIndex ? (
                                            <AvailabilityBlock
                                                // biome-ignore lint/suspicious/noArrayIndexKey: a drag rewrites its range in place, so the position is what holds still while the pointer is captured on this element
                                                key={index}
                                                fromMinutes={range.from - dayStart}
                                                toMinutes={range.to - dayStart}
                                                minutesPerColumn={minutesPerColumn}
                                                selected={selected === index}
                                                disabled={disabled}
                                                formatRange={formatRange}
                                                onGrab={(event) => {
                                                    startMove(
                                                        index,
                                                        dayIndex,
                                                        range.from - dayStart,
                                                        event,
                                                    );
                                                }}
                                                onGrabEdge={(edge, event) => {
                                                    startResize(index, edge, event);
                                                }}
                                            />
                                        ) : null,
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            </Box>

            {helperText !== undefined && <FormHelperText>{helperText}</FormHelperText>}
        </FormControl>
    );
};
