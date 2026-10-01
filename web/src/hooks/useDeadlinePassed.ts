import { useEffect, useState } from "react";
import { isBefore } from "temporal-extra";
import type { Edition } from "#/queries/edition.js";
import { onServerClockSync, serverNow } from "#/utils/server-clock.ts";

export const useDeadlinePassed = (edition: Pick<Edition, "submissionDeadline">): boolean => {
    const [passed, setPassed] = useState(() => {
        if (!edition.submissionDeadline) {
            return false;
        }

        return isBefore(edition.submissionDeadline, serverNow());
    });

    useEffect(() => {
        const deadline = edition.submissionDeadline;

        if (!deadline) {
            setPassed(false);
            return;
        }

        let timer: ReturnType<typeof setTimeout> | undefined;

        const check = () => {
            const now = serverNow();

            if (isBefore(deadline, now)) {
                setPassed(true);
                return;
            }

            setPassed(false);

            const secondsUntilDeadline = deadline.since(now).total({ unit: "seconds" });
            let nextInterval: number;

            if (secondsUntilDeadline > 60 * 60) {
                nextInterval = 10 * 60 * 1000;
            } else if (secondsUntilDeadline > 60) {
                nextInterval = 30 * 1000;
            } else {
                nextInterval = 1000;
            }

            timer = setTimeout(check, nextInterval);
        };

        check();
        const stopResync = onServerClockSync(() => {
            clearTimeout(timer);
            check();
        });

        return () => {
            stopResync();

            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [edition.submissionDeadline]);

    return passed;
};
