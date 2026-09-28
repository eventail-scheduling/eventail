import { useRef } from "react";

const intervalMs = 2_000;
const maxWaitSeconds = 60;

type Episode = {
    key: string | undefined;
    startedAt: Temporal.Instant;
};

type PollPolicy = (processing: boolean, key: string | undefined) => number | false;

/**
 * Stops asking by the clock, so a flag nothing will clear cannot poll forever.
 *
 * A job that exhausts its retries, or is canceled, leaves `processing` true for
 * good. The deadline cannot be a count of answers: a refetch that fails leaves
 * the query's data untouched, and a failing API is where a stuck flag comes
 * from.
 *
 * Takes the image's key as well, because giving up stops the asking and so
 * stops anything from clearing the deadline. Replacing an image whose job
 * never finished would otherwise inherit the exhausted one.
 */
export const createPollPolicy = (): PollPolicy => {
    let episode: Episode | null = null;

    return (processing: boolean, key: string | undefined): number | false => {
        if (!processing) {
            episode = null;
            return false;
        }

        const now = Temporal.Now.instant();

        if (episode === null || episode.key !== key) {
            episode = { key, startedAt: now };
        }

        return now.since(episode.startedAt).total({ unit: "seconds" }) < maxWaitSeconds
            ? intervalMs
            : false;
    };
};

/** Keeps one policy across renders, since a policy built during one starts its wait over. */
export const usePollWhileProcessing = (): PollPolicy => {
    const policy = useRef<PollPolicy | null>(null);
    policy.current ??= createPollPolicy();

    return policy.current;
};
