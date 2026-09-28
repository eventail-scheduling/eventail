import { useEffect, useMemo, useState } from "react";
import { isAfter, isBefore } from "temporal-extra";
import { isFrozenAt } from "#/components/SessionFormFields/index.js";
import type { CustomField } from "#/queries/custom-field.js";
import { onServerClockSync, serverNow } from "#/utils/server-clock.ts";

type FreezeSplit = {
    open: CustomField[];
    frozen: CustomField[];
};

const frozenKey = (customFields: CustomField[], instant: Temporal.Instant): string =>
    customFields
        .filter((customField) => isFrozenAt(customField, instant))
        .map(({ id }) => id)
        .join(",");

const nextFreeze = (
    customFields: CustomField[],
    instant: Temporal.Instant,
): Temporal.Instant | undefined => {
    let next: Temporal.Instant | undefined;

    for (const { freezeAfter } of customFields) {
        if (
            freezeAfter !== null &&
            !isAfter(instant, freezeAfter) &&
            (next === undefined || isBefore(freezeAfter, next))
        ) {
            next = freezeAfter;
        }
    }

    return next;
};

/**
 * Splits custom fields into those still taking answers and those frozen, again as each freezes.
 *
 * A form's question list is otherwise computed for the data it was handed, and
 * a refetch of unchanged data keeps it, so a question freezing while the form
 * is open would stay an input whose answer the API then refuses.
 */
export const useFreezeSplit = (customFields: CustomField[]): FreezeSplit => {
    const [checkedAt, setCheckedAt] = useState(() => serverNow());

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastKey = frozenKey(customFields, checkedAt);

        const check = () => {
            const now = serverNow();
            const key = frozenKey(customFields, now);

            if (key !== lastKey) {
                lastKey = key;
                setCheckedAt(now);
            }

            const next = nextFreeze(customFields, now);

            if (next === undefined) {
                return;
            }

            const secondsUntilFreeze = next.since(now).total({ unit: "seconds" });
            let nextInterval: number;

            if (secondsUntilFreeze > 60 * 60) {
                nextInterval = 10 * 60 * 1000;
            } else if (secondsUntilFreeze > 60) {
                nextInterval = 30 * 1000;
            } else {
                nextInterval = 1000;
            }

            timer = setTimeout(check, nextInterval);
        };

        // Timers stall while the machine sleeps and are throttled in a hidden
        // tab, so a freeze passed meanwhile is caught when the page is back.
        const recheck = () => {
            if (document.visibilityState === "visible") {
                clearTimeout(timer);
                check();
            }
        };

        const resync = () => {
            clearTimeout(timer);
            check();
        };

        check();
        document.addEventListener("visibilitychange", recheck);
        const stopResync = onServerClockSync(resync);

        return () => {
            document.removeEventListener("visibilitychange", recheck);
            stopResync();

            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [customFields, checkedAt]);

    return useMemo(
        () => ({
            open: customFields.filter((customField) => !isFrozenAt(customField, checkedAt)),
            frozen: customFields.filter((customField) => isFrozenAt(customField, checkedAt)),
        }),
        [customFields, checkedAt],
    );
};
