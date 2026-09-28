import { Box, Typography } from "@mui/material";
import { darken, type Theme } from "@mui/material/styles";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { match } from "ts-pattern";
import { useLongPress } from "#/hooks/useLongPress.ts";
import type { PressPoint } from "./useSlotDrag.js";

/**
 * Inset and striped, so a shoulder reads as part of its block rather than a slab.
 *
 * The API reserves setup and teardown, so two sessions can be legal by their
 * bodies and refused by their shoulders. Drawn full width they would look
 * like separate sessions sitting in the row above.
 */
const shoulderStyle = {
    position: "absolute",
    left: "18%",
    right: "18%",
    borderRadius: 0.5,
    bgcolor: "action.disabledBackground",
    backgroundImage:
        "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(128,128,128,0.3) 3px, rgba(128,128,128,0.3) 6px)",
} as const;

export type BlockTone = "placed" | "held" | "candidate" | "refused";

/**
 * Every arm takes the theme, so a caller has to call one before spreading it.
 *
 * A lone function spread into an sx object vanishes quietly.
 */
type ToneStyle = (theme: Theme) => Record<string, unknown>;

/**
 * Gives each tone its colors, a placed block stating both rather than taking the pair.
 *
 * `primary.contrastText` is computed against `primary.main`, not against the
 * `primary.dark` a block is drawn on, so the two agree only by chance. In dark
 * mode that gives black on a mid blue, and the palette has nothing deeper to move
 * to: `primary.dark` is already the darkest blue it carries there. Darkened by
 * hand so a block reads the same in either mode.
 */
const toneStyle = (tone: BlockTone): ToneStyle =>
    match(tone)
        .with("placed", () => (theme: Theme) => ({
            backgroundColor: theme.vars.palette.primary.dark,
            color: theme.vars.palette.common.white,
            // The one literal that stays one: `darken` needs a color to compute
            // on and a var reference is a string it cannot read. This is a
            // hand-picked blue rather than the dark scheme's, on purpose.
            ...theme.applyStyles("dark", {
                backgroundColor: darken(theme.palette.primary.dark, 0.4),
            }),
        }))
        // Muted rather than colored: it holds its room and its time, and the
        // only thing left to do with it is delete it.
        .with("held", () => (theme: Theme) => ({
            backgroundColor: theme.vars.palette.action.disabledBackground,
            color: theme.vars.palette.text.secondary,
            outline: `1px dashed ${theme.vars.palette.divider}`,
        }))
        .with("candidate", () => (theme: Theme) => ({
            backgroundColor: theme.vars.palette.primary.main,
            color: theme.vars.palette.primary.contrastText,
            outline: `2px solid ${theme.vars.palette.primary.light}`,
        }))
        .with("refused", () => (theme: Theme) => ({
            backgroundColor: theme.vars.palette.error.dark,
            color: theme.vars.palette.error.contrastText,
            outline: `2px solid ${theme.vars.palette.error.light}`,
        }))
        .exhaustive();

type ScheduleBlockProps = {
    title: string;
    top: number;
    height: number;
    setup: number;
    teardown: number;
    tone: BlockTone;
    testId?: string;
    /** The block a gesture is carrying somewhere else, left behind as a trace. */
    faded?: boolean;
    selected?: boolean;
    tooltip?: string;
    /**
     * What the block says beside its title.
     *
     * A ghost carries the time it would take or why it would be refused; a
     * block whose session may no longer be moved carries that session's state.
     */
    hint?: string;
    /**
     * Something about this placement is worth knowing, and none of it refuses it.
     *
     * Drawn as an outline because a placed block has none, so it cannot be read
     * as the refused ghost, and it costs a short block no width.
     */
    warned?: boolean;
    onStartMove?: (press: PressPoint) => void;
    /** What a finger means by a press it lets go of before anything is held. */
    onTap?: () => void;
};

export const ScheduleBlock = ({
    title,
    top,
    height,
    setup,
    teardown,
    tone,
    testId,
    faded = false,
    selected = false,
    tooltip,
    hint,
    warned = false,
    onStartMove,
    onTap,
}: ScheduleBlockProps): ReactNode => {
    const { armGesture, trackPending, finishPending, cancelPending } = useLongPress();

    const press = (event: ReactPointerEvent<HTMLElement>, start: (point: PressPoint) => void) => {
        const { pointerId, button } = event;

        armGesture(
            event,
            (at) => {
                start({ pointerId, button, ...at });
            },
            () => {
                onTap?.();
            },
        );
    };

    return (
        <Box
            data-testid={testId}
            sx={{
                position: "absolute",
                top,
                left: 2,
                right: 2,
                height: Math.max(height, 2),
                opacity: faded ? 0.35 : 1,
                pointerEvents: faded ? "none" : undefined,
                // A finger scrolls the grid until it rests long enough to mean
                // otherwise. A schedule with few gaps is mostly blocks, so
                // holding the scroll off them leaves nothing to scroll by.
                touchAction: "manipulation",
            }}
        >
            {setup > 0 && (
                <Box
                    data-testid={testId === undefined ? undefined : `${testId}-setup`}
                    sx={{ ...shoulderStyle, top: -setup, height: setup }}
                />
            )}

            <Box
                title={tooltip}
                onPointerDown={(event) => {
                    if (onStartMove) {
                        press(event, onStartMove);
                    }
                }}
                onPointerMove={trackPending}
                onPointerUp={finishPending}
                onPointerCancel={cancelPending}
                data-warned={warned ? "true" : undefined}
                sx={(theme) => ({
                    ...toneStyle(tone)(theme),
                    // The chip that counts these reads vars, so the outline has
                    // to as well or the two disagree in dark mode.
                    ...(warned && { outline: `2px solid ${theme.vars.palette.warning.main}` }),
                    height: "100%",
                    borderRadius: 1,
                    px: 0.5,
                    overflow: "hidden",
                    display: "flex",
                    gap: 0.5,
                    alignItems: "baseline",
                    cursor: onStartMove ? "grab" : undefined,
                    boxShadow: selected ? 4 : undefined,
                })}
            >
                <Typography variant="caption" noWrap>
                    {title}
                </Typography>

                {hint !== undefined && (
                    <Typography
                        variant="caption"
                        noWrap
                        // A state label holds its width, because half of
                        // "Canceled" reads as a button rather than a state. A
                        // ghost's hint is a sentence and shrinks with the title.
                        sx={{ opacity: 0.9, ...(tone === "held" && { flexShrink: 0 }) }}
                    >
                        {hint}
                    </Typography>
                )}
            </Box>

            {teardown > 0 && (
                <Box
                    data-testid={testId === undefined ? undefined : `${testId}-teardown`}
                    sx={{ ...shoulderStyle, bottom: -teardown, height: teardown }}
                />
            )}
        </Box>
    );
};
