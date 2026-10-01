import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryOptionsFactory } from "#/queries";
import type { Track } from "#/queries/track.ts";
import { ensureScopeOptions } from "#/routes/_user/manage/$editionId/custom-fields/-components/scope-options.ts";

const editionId = "edition-1";

const track = (id: string): Track =>
    ({
        id,
        name: id,
        externalKey: null,
        description: "",
        color: "#123456",
        internal: false,
    }) as Track;

const trackList = (ids: string[]): Response =>
    new Response(
        JSON.stringify({
            jsonapi: { version: "1.1" },
            data: ids.map((id) => ({
                type: "track",
                id,
                attributes: {
                    name: id,
                    externalKey: null,
                    description: "",
                    color: "#123456",
                    internal: false,
                },
            })),
        }),
        { status: 200, headers: { "Content-Type": "application/vnd.api+json" } },
    );

const setUp = (cachedTracks: Track[]) => {
    const sent = vi.fn(async () => trackList(["track-old", "track-new"]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const qof = createQueryOptionsFactory(sent as unknown as typeof fetch);
    client.setQueryData(qof.sessionType.list(editionId).queryKey, []);
    client.setQueryData(qof.track.list(editionId).queryKey, cachedTracks);

    return { sent, client, qof };
};

describe("ensureScopeOptions", () => {
    it("refetches a track list that lacks a track the question is scoped to", async () => {
        const { sent, client, qof } = setUp([track("track-old")]);

        await ensureScopeOptions(client, qof, editionId, {
            sessionTypes: [],
            tracks: [{ id: "track-old" }, { id: "track-new" }] as never,
        });

        expect(sent).toHaveBeenCalledTimes(1);
        expect(
            client.getQueryData(qof.track.list(editionId).queryKey)?.map(({ id }) => id),
        ).toEqual(["track-old", "track-new"]);
    });

    it("leaves a list that already holds every scoped row alone", async () => {
        const { sent, client, qof } = setUp([track("track-old")]);

        await ensureScopeOptions(client, qof, editionId, {
            sessionTypes: [],
            tracks: [{ id: "track-old" }] as never,
        });

        expect(sent).not.toHaveBeenCalled();
    });
});
