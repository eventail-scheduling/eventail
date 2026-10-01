import type { ReactNode } from "react";
import { NumberField, type NumberFieldProps } from "#/components/NumberField/index.js";
import { durationToMinutes, formatDurationLabel, minutesToDuration } from "#/utils/duration.ts";

// The API rejects anything above 24 hours, or carrying seconds.
const MAX_MINUTES = 60 * 24;

const suffixFor = (value: Temporal.Duration | null | undefined): string => {
    if (!value) {
        return "min";
    }

    return durationToMinutes(value) < 60 ? "min" : formatDurationLabel(value);
};

export type DurationFieldProps = Omit<NumberFieldProps, "value" | "onValueChange" | "suffix"> & {
    value: Temporal.Duration | null | undefined;
    onValueChange: (value: Temporal.Duration | null) => void;
};

export const DurationField = ({
    value,
    onValueChange,
    min = 0,
    max = MAX_MINUTES,
    ...numberFieldProps
}: DurationFieldProps): ReactNode => (
    <NumberField
        {...numberFieldProps}
        min={min}
        max={max}
        step={5}
        value={value ? durationToMinutes(value) : null}
        onValueChange={(minutes) => {
            onValueChange(minutes === null ? null : minutesToDuration(minutes));
        }}
        suffix={suffixFor(value)}
    />
);
