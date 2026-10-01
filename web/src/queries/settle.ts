import { z } from "zod/mini";

const settledSessionSchema = z.object({
    id: z.string(),
    title: z.string(),
    slotsRemoved: z.int(),
    slotsLeft: z.int(),
});

export type SettledSession = z.output<typeof settledSessionSchema>;

/** What a reversion reports: it settles slots and never touches availability. */
export const slotsSettleReportSchema = z.object({
    sessions: z.array(settledSessionSchema),
});

export type SlotsSettleReport = z.output<typeof slotsSettleReportSchema>;

/**
 * What an edition patch reports when its dates or timezone changed.
 *
 * Slots settle against the new window and availability is trimmed to it. A
 * reversion reports {@link slotsSettleReportSchema} instead.
 */
export const settleReportSchema = z.object({
    sessions: z.array(settledSessionSchema),
    trimmedAvailability: z.int(),
    droppedAvailability: z.int(),
});

export type SettleReport = z.output<typeof settleReportSchema>;

export const anythingWasRemoved = (report: SettleReport): boolean =>
    report.sessions.length > 0 || report.trimmedAvailability > 0 || report.droppedAvailability > 0;
