import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import {
    type UseMutationResult,
    useMutation,
    useMutationState,
    useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

/**
 * The two durations may carry hours and minutes and nothing else.
 *
 * The API refuses seconds, sub-second units, days and anything past 24 hours, so
 * a duration derived from a drag distance or from `since()` needs rounding to
 * minutes before it is sent.
 */
type SlotTiming = {
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant;
    setupTime: Temporal.Duration;
    teardownTime: Temporal.Duration;
};

type TimingAttributes = {
    startsAt: string;
    endsAt: string;
    setupTime: string;
    teardownTime: string;
};

type ScheduleTarget = {
    editionId: string;
    scheduleId: string;
};

type CreateSlotValues = ScheduleTarget &
    SlotTiming & {
        sessionId: string;
        locationId: string;
    };

/**
 * Reads the draft again whether or not the write landed.
 *
 * Every slot write settles through this rather than succeeding through it: a
 * refusal means this copy of the draft disagrees with the one the API holds the
 * lock on, which is exactly when the grid most needs reading again.
 */
const useScheduleInvalidation = (): ((editionId: string) => Promise<void>) => {
    const queryClient = useQueryClient();

    return async (editionId) => {
        await queryClient.invalidateQueries({ queryKey: ["schedules", editionId] });
    };
};

const buildTimingAttributes = (timing: SlotTiming): TimingAttributes => ({
    startsAt: timing.startsAt.toString(),
    endsAt: timing.endsAt.toString(),
    setupTime: timing.setupTime.toString(),
    teardownTime: timing.teardownTime.toString(),
});

const createSlotMutationKey = ["slots", "create"];

export const useCreateSlotMutation = (): UseMutationResult<void, Error, CreateSlotValues> => {
    const { fetch } = useOidcFetch();
    const invalidateSchedules = useScheduleInvalidation();

    return useMutation({
        mutationKey: createSlotMutationKey,
        mutationFn: async ({ editionId, scheduleId, sessionId, locationId, ...timing }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/schedules/${scheduleId}/slots`),
                {
                    method: "POST",
                    headers: jsonApiHeaders,
                    body: JSON.stringify({
                        data: {
                            type: "slot",
                            attributes: buildTimingAttributes(timing),
                            relationships: {
                                session: { data: { type: "session", id: sessionId } },
                                location: { data: { type: "location", id: locationId } },
                            },
                        },
                    }),
                },
            );
            await handleJsonApiError(response);
        },
        onSettled: (_result, _error, { editionId }) => invalidateSchedules(editionId),
    });
};

/**
 * Maps each session with a placement still on its way to whether it waits for the connection.
 *
 * A create stays pending until the draft has been read again, which is when the grid first shows
 * it, and pauses rather than failing while offline.
 */
export const usePendingPlacements = (): ReadonlyMap<string, boolean> => {
    const pending = useMutationState({
        filters: { mutationKey: createSlotMutationKey, status: "pending" },
        select: (mutation) => ({
            sessionId: (mutation.state.variables as CreateSlotValues | undefined)?.sessionId,
            paused: mutation.state.isPaused,
        }),
    });

    return useMemo(() => {
        const placements = new Map<string, boolean>();

        for (const { sessionId, paused } of pending) {
            if (sessionId !== undefined) {
                placements.set(sessionId, (placements.get(sessionId) ?? false) || paused);
            }
        }

        return placements;
    }, [pending]);
};

/**
 * Moving a slot and changing its length are the same write.
 *
 * Both only restate the timing. The location is required here even when it has
 * not changed, so every caller states where the slot sits. The API takes a
 * patch without it and keeps the stored room.
 */
type UpdateSlotValues = ScheduleTarget &
    SlotTiming & {
        slotId: string;
        locationId: string;
    };

export const useUpdateSlotMutation = (): UseMutationResult<void, Error, UpdateSlotValues> => {
    const { fetch } = useOidcFetch();
    const invalidateSchedules = useScheduleInvalidation();

    return useMutation({
        mutationFn: async ({ editionId, scheduleId, slotId, locationId, ...timing }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/schedules/${scheduleId}/slots/${slotId}`),
                {
                    method: "PATCH",
                    headers: jsonApiHeaders,
                    body: JSON.stringify({
                        data: {
                            type: "slot",
                            id: slotId,
                            attributes: buildTimingAttributes(timing),
                            relationships: {
                                location: { data: { type: "location", id: locationId } },
                            },
                        },
                    }),
                },
            );
            await handleJsonApiError(response);
        },
        onSettled: (_result, _error, { editionId }) => invalidateSchedules(editionId),
    });
};

type DeleteSlotValues = ScheduleTarget & { slotId: string };

export const useDeleteSlotMutation = (): UseMutationResult<void, Error, DeleteSlotValues> => {
    const { fetch } = useOidcFetch();
    const invalidateSchedules = useScheduleInvalidation();

    return useMutation({
        mutationFn: async ({ editionId, scheduleId, slotId }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/schedules/${scheduleId}/slots/${slotId}`),
                { method: "DELETE", headers: jsonApiAcceptHeaders },
            );
            await handleJsonApiError(response);
        },
        onSettled: (_result, _error, { editionId }) => invalidateSchedules(editionId),
    });
};
