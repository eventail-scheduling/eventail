export const formatDurationLabel = (duration: Temporal.Duration): string => {
    const totalMinutes = Math.floor(duration.abs().total("minutes"));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);

    if (hours === 0) {
        return `${minutes}m`;
    }

    if (minutes === 0) {
        return `${hours}h`;
    }

    return `${hours}h ${minutes}m`;
};

export const durationToMinutes = (duration: Temporal.Duration): number =>
    Math.floor(duration.total("minutes"));

export const minutesToDuration = (minutes: number): Temporal.Duration =>
    Temporal.Duration.from({ minutes });
