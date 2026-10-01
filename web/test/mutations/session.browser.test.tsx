import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import {
    useCreateSessionMutation,
    useTransitionSessionMutation,
    useUpdateSessionMutation,
} from "#/mutations/session.ts";
import { useRemoveSessionHostMutation } from "#/mutations/session-host.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const editionId = "edition-1";
const sessionId = "session-1";

const talk = {
    type: "session_type",
    id: "type-talk",
    attributes: {
        name: "Talk",
        externalKey: null,
        defaultDuration: "PT30M",
        internal: false,
        selectionDefault: true,
    },
};

const document = (data: unknown): Response =>
    new Response(JSON.stringify({ jsonapi: { version: "1.1" }, data, included: [talk] }), {
        status: 200,
        headers: { "Content-Type": "application/vnd.api+json" },
    });

const storedSession = {
    type: "session",
    id: sessionId,
    attributes: {
        createdAt: "2026-09-01T10:00:00Z",
        state: "submitted",
        title: "Temporal in practice",
        abstract: "",
        description: "",
        notes: "",
        duration: "PT30M",
        setupTime: null,
        teardownTime: null,
        teaserImage: null,
    },
    relationships: {
        hosts: { data: [] },
        sessionType: { data: { type: "session_type", id: "type-talk" } },
        track: { data: null },
        responses: { data: [] },
    },
    meta: { hostTransitions: [], managerTransitions: [], hosting: false },
};

type ProvidersProps = {
    children: ReactNode;
};

/** Mounts a mutation hook and records every key it invalidates. */
const mountRecording = async <TResult,>(useHook: () => TResult) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const Providers = ({ children }: ProvidersProps): ReactNode => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = await renderHook(useHook, { wrapper: Providers });

    return {
        mutation: result,
        keys: () => invalidated.mock.calls.map(([filters]) => filters?.queryKey),
    };
};

beforeEach(() => {
    sent.mockReset();
});

describe("what a session write refreshes", () => {
    it("refreshes the schedules after an update", async () => {
        sent.mockResolvedValue(document(storedSession));
        const { mutation, keys } = await mountRecording(useUpdateSessionMutation);

        await mutation.current.mutateAsync({
            editionId,
            sessionId,
            attributes: { title: "Renamed" },
            sessionType: undefined,
            track: undefined,
            responses: undefined,
        });

        expect(keys()).toContainEqual(["schedules", editionId]);
    });

    it("refreshes the schedules after a transition", async () => {
        sent.mockResolvedValue(new Response(null, { status: 204 }));
        const { mutation, keys } = await mountRecording(useTransitionSessionMutation);

        await mutation.current.mutateAsync({ editionId, sessionId, state: "accepted", note: null });

        expect(keys()).toContainEqual(["schedules", editionId]);
    });

    // A refused move means the page offered it from a state the session left.
    it("refreshes the session after a refused transition", async () => {
        sent.mockResolvedValue(
            new Response(
                JSON.stringify({
                    errors: [{ status: "409", code: "illegal_transition", title: "Illegal" }],
                }),
                { status: 409, headers: { "Content-Type": "application/vnd.api+json" } },
            ),
        );
        const { mutation, keys } = await mountRecording(useTransitionSessionMutation);

        await expect(
            mutation.current.mutateAsync({ editionId, sessionId, state: "withdrawn", note: null }),
        ).rejects.toThrow();

        expect(keys()).toContainEqual(["session", editionId, sessionId]);
        expect(keys()).toContainEqual(["sessions", editionId]);
    });

    it("refreshes the hosts after a speaker files their own", async () => {
        sent.mockResolvedValue(document(storedSession));
        const { mutation, keys } = await mountRecording(useCreateSessionMutation);

        await mutation.current.mutateAsync({
            editionId,
            attributes: { title: "Temporal in practice" },
            sessionType: "type-talk",
            track: null,
            responses: {},
            selfService: true,
        });

        expect(keys()).toContainEqual(["hosts", editionId]);
    });

    it("leaves the hosts alone after an organizer files one", async () => {
        sent.mockResolvedValue(document(storedSession));
        const { mutation, keys } = await mountRecording(useCreateSessionMutation);

        await mutation.current.mutateAsync({
            editionId,
            attributes: { title: "Temporal in practice" },
            sessionType: "type-talk",
            track: null,
            responses: {},
            selfService: false,
        });

        expect(keys()).not.toContainEqual(["hosts", editionId]);
    });

    it("refreshes the hosts and the lists after a host is removed", async () => {
        sent.mockResolvedValue(new Response(null, { status: 204 }));
        const { mutation, keys } = await mountRecording(useRemoveSessionHostMutation);

        await mutation.current.mutateAsync({ editionId, sessionId, hostId: "host-1" });

        expect(keys()).toEqual(
            expect.arrayContaining([
                ["hosts", editionId],
                ["sessions", editionId],
                ["me", "sessions", editionId],
            ]),
        );
    });
});
