import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { useCallback, useEffect, useRef } from "react";
import { isAfter, isBefore } from "temporal-extra";
import { useQueryOptionsFactory } from "#/queries";
import type { Edition } from "#/queries/edition.js";
import { getErrorMessage, hasErrorCode } from "#/utils/api.js";
import type { AvailabilityInterval } from "#/utils/availability.js";

type AvailabilityFollowsWindowOptions = {
    edition: Edition;
    /** The availability the form was last seeded with, which its changes are measured against. */
    seededAvailability: () => AvailabilityInterval[];
    /** The availability the form holds now, edits included. */
    currentAvailability: () => AvailabilityInterval[];
    /** Makes these intervals both the form's availability and the seed it is measured against. */
    settleAvailability: (intervals: AvailabilityInterval[]) => void;
};

type AvailabilityFollowsWindow = {
    /**
     * Reports a refused save, rereading the edition first when it was refused `outside_edition`.
     *
     * A page that holds its edition would otherwise judge every retry against the old days.
     */
    reportRefusal: (error: unknown, report: (error: unknown) => void) => void;
};

/** Stands in for an absent availability, the same array every time, so a reseed is told by identity. */
export const noAvailability: AvailabilityInterval[] = [];

const windowKeyOf = (edition: Edition): string =>
    `${edition.startDate}/${edition.endDate}/${edition.timeZone}`;

/** Reports whether any interval reaches before the edition's first day or past its last. */
export const liesOutside = (edition: Edition, intervals: AvailabilityInterval[]): boolean => {
    const start = edition.startDate.toZonedDateTime(edition.timeZone).toInstant();
    const end = edition.endDate.add({ days: 1 }).toZonedDateTime(edition.timeZone).toInstant();

    return intervals.some(
        ({ startsAt, endsAt }) => isBefore(startsAt, start) || isAfter(endsAt, end),
    );
};

const intervalKeys = (intervals: AvailabilityInterval[]): string =>
    intervals
        .map(({ startsAt, endsAt }) => `${startsAt.toString()}/${endsAt.toString()}`)
        .sort()
        .join(",");

/**
 * Reseeds a profile form's availability when the edition's days move under it.
 *
 * Moving an edition re-anchors every stored interval, while the form still holds what was drawn
 * against the old days, and a save would write those back over the settled set. A window change
 * that settled nothing, such as a later end date, leaves the form as it is, unless something it
 * holds now lies outside the new days, where the grid can no longer show it to be removed.
 */
export const useAvailabilityFollowsWindow = ({
    edition,
    seededAvailability,
    currentAvailability,
    settleAvailability,
}: AvailabilityFollowsWindowOptions): AvailabilityFollowsWindow => {
    const qof = useQueryOptionsFactory();
    const queryClient = useQueryClient();
    const windowKey = windowKeyOf(edition);
    const asksForAvailability = edition.profileFieldOptions.availability !== undefined;
    const seenWindow = useRef(windowKey);
    const callbacks = useRef({
        edition,
        seededAvailability,
        currentAvailability,
        settleAvailability,
    });
    callbacks.current = { edition, seededAvailability, currentAvailability, settleAvailability };

    useEffect(() => {
        if (seenWindow.current === windowKey) {
            return;
        }

        seenWindow.current = windowKey;

        if (!asksForAvailability) {
            return;
        }

        let current = true;
        const seededBefore = callbacks.current.seededAvailability();

        queryClient
            .fetchQuery({ ...qof.host.mine(edition.id), staleTime: 0 })
            .then((host) => {
                const seeded = callbacks.current.seededAvailability();

                // A save reseeded the form while this was out, from a newer answer than this.
                if (!current || seeded !== seededBefore) {
                    return;
                }

                const settled = host.availabilities.map(({ startsAt, endsAt }) => ({
                    startsAt,
                    endsAt,
                }));

                if (
                    intervalKeys(settled) === intervalKeys(seeded) &&
                    !liesOutside(callbacks.current.edition, callbacks.current.currentAvailability())
                ) {
                    return;
                }

                callbacks.current.settleAvailability(settled);
                enqueueSnackbar(
                    "The edition's dates changed while this was open. The availability shown is what it settled to; change it if that is not what you want.",
                    { variant: "warning" },
                );
            })
            .catch(() => {
                if (current) {
                    enqueueSnackbar(
                        "The edition's dates changed while this was open, and your availability could not be read again. Reload the page before saving.",
                        { variant: "error" },
                    );
                }
            });

        return () => {
            current = false;
        };
    }, [windowKey, asksForAvailability, queryClient, qof, edition.id]);

    const reportRefusal = useCallback(
        (error: unknown, report: (error: unknown) => void) => {
            if (!hasErrorCode(error, "outside_edition")) {
                report(error);

                return;
            }

            const refusedIn = seenWindow.current;

            queryClient
                .fetchQuery({ ...qof.edition.get(edition.id), staleTime: 0 })
                .then((fetched) => {
                    if (windowKeyOf(fetched.edition) === refusedIn) {
                        enqueueSnackbar(getErrorMessage(error), { variant: "error" });
                    }
                })
                .catch(() => {
                    enqueueSnackbar(
                        "The edition's dates may have changed while this was open, and the new ones could not be read. Reload the page before saving.",
                        { variant: "error" },
                    );
                });
        },
        [queryClient, qof, edition.id],
    );

    return { reportRefusal };
};
