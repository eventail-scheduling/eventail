import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition, SessionFieldSpec, UploadLimits } from "#/queries/edition.ts";
import { deserializeSession, type Session } from "#/queries/session.ts";
import type { SessionType } from "#/queries/session-type.ts";
import type { Track } from "#/queries/track.ts";
import { SessionForm } from "#/routes/_user/manage/$editionId/sessions/-components/SessionForm.tsx";
import { replace } from "../../../support/forms.ts";
import { answered } from "../../../support/json-api.ts";
import { createTestTheme } from "../../../support/theme.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

// The form's leave guard needs a router, which these tests render without.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
    ...(await importOriginal()),
    useBlocker: (() => undefined) as never,
}));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

// The native picker cannot be driven from a test.
vi.mock("browser-fs-access", () => ({
    fileOpen: async () => new File(["%PDF-1.4"], "slides.pdf", { type: "application/pdf" }),
}));

const editionId = "edition-1";
const sessionId = "session-1";
const theme = createTestTheme();

const edition = {
    id: editionId,
    name: "Dev Edition",
    startDate: Temporal.PlainDate.from("2026-11-21"),
    endDate: Temporal.PlainDate.from("2026-11-23"),
    submissionDeadline: null,
    timeZone: "Europe/Berlin",
    sessionFieldOptions: { title: {}, duration: { requirement: "optional" } },
    profileFieldOptions: {},
} as unknown as Edition;

const specs: Record<string, SessionFieldSpec> = {
    sessionType: { label: "Session type", forceRequired: true, type: "relationship" },
    title: { label: "Title", forceRequired: true, type: "string" },
    duration: { label: "Duration", forceRequired: false, type: "duration" },
};

const talk = {
    id: "type-talk",
    name: "Talk",
    externalKey: null,
    defaultDuration: Temporal.Duration.from({ minutes: 30 }),
    internal: false,
    selectionDefault: true,
} as unknown as SessionType;

const workshop = { ...talk, id: "type-workshop", name: "Workshop", selectionDefault: false };

const mainStage = {
    id: "track-main",
    name: "Main stage",
    externalKey: null,
    description: "",
    color: "#000000",
    internal: false,
} as unknown as Track;

const sideStage = { ...mainStage, id: "track-side", name: "Side stage" };

const textField = (id: string, title: string): CustomField =>
    ({
        id,
        externalKey: null,
        target: "per_proposal",
        requirement: "always_optional",
        title,
        helperText: "",
        options: { type: "single_line_text" },
        answerMaxLength: 200,
        deadline: null,
        freezeAfter: null,
        sessionTypes: [],
        tracks: [],
    }) as unknown as CustomField;

const customFields = [
    textField("field-a", "What do you need?"),
    textField("field-b", "Anything else?"),
];

type StoredAnswer = {
    id: string;
    customFieldId: string;
    value: string;
};

/** Builds the session document the API serves, for seeding the form and answering a patch. */
const sessionDocument = (
    title: string,
    answers: StoredAnswer[],
    sessionType: SessionType = talk,
    track?: Track,
) => ({
    jsonapi: { version: "1.1" },
    data: {
        type: "session",
        id: sessionId,
        attributes: {
            createdAt: "2026-09-01T10:00:00Z",
            state: "submitted",
            title,
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
            sessionType: { data: { type: "session_type", id: sessionType.id } },
            track: { data: track === undefined ? null : { type: "track", id: track.id } },
            responses: { data: answers.map(({ id }) => ({ type: "response", id })) },
        },
        meta: { hostTransitions: [], managerTransitions: [], hosting: false },
    },
    included: [
        {
            type: "session_type",
            id: sessionType.id,
            attributes: {
                name: sessionType.name,
                externalKey: null,
                defaultDuration: "PT30M",
                internal: false,
                selectionDefault: true,
            },
        },
        ...(track === undefined
            ? []
            : [
                  {
                      type: "track",
                      id: track.id,
                      attributes: {
                          name: track.name,
                          externalKey: null,
                          description: "",
                          color: track.color,
                          internal: false,
                      },
                  },
              ]),
        ...answers.map(({ id, customFieldId, value }) => ({
            type: "response",
            id,
            attributes: { value },
            relationships: { customField: { data: { type: "custom_field", id: customFieldId } } },
        })),
    ],
});

type ProvidersProps = {
    children: ReactNode;
};

const noUploads: UploadLimits = { maxFileSize: 1, fileContentTypes: [], imageContentTypes: [] };

type FormOverrides = Partial<ComponentProps<typeof SessionForm>>;

const formFor = (
    session: Session,
    fields: CustomField[] = customFields,
    uploadLimits: UploadLimits = noUploads,
    overrides: FormOverrides = {},
): ReactNode => (
    <SessionForm
        editionId={editionId}
        sessionId={sessionId}
        session={session}
        edition={edition}
        specs={specs}
        fieldNames={["sessionType", "title", "duration"]}
        sessionTypes={[talk, workshop]}
        tracks={[]}
        customFields={fields}
        uploadLimits={uploadLimits}
        {...overrides}
    />
);

const mount = async (
    session: Session,
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
    fields: CustomField[] = customFields,
    uploadLimits: UploadLimits = noUploads,
    overrides: FormOverrides = {},
) => {
    const factory = createQueryOptionsFactory(sent);
    const Providers = ({ children }: ProvidersProps): ReactNode => (
        <QueryClientProvider client={client}>
            <QueryOptionsFactoryProvider factory={factory}>
                <ThemeProvider theme={theme}>
                    <CssBaseline />
                    <SnackbarProvider>
                        <LocaleProvider>{children}</LocaleProvider>
                    </SnackbarProvider>
                </ThemeProvider>
            </QueryOptionsFactoryProvider>
        </QueryClientProvider>
    );

    return render(formFor(session, fields, uploadLimits, overrides), { wrapper: Providers });
};

type Screen = Awaited<ReturnType<typeof mount>>;

type PatchBody = {
    data: { attributes: unknown; relationships: unknown };
};

const save = async (screen: Screen, calls: number): Promise<PatchBody> => {
    await screen.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => sent.mock.calls.length).toEqual(calls);
    const [, request] = sent.mock.lastCall as [URL, RequestInit];

    return JSON.parse(request.body as string) as PatchBody;
};

beforeEach(() => {
    sent.mockReset();
    window.localStorage.setItem("preferredLocale", "en-US");
});

describe("saving a session as an organizer", () => {
    const bothAnswered = sessionDocument("Original title", [
        { id: "answer-a", customFieldId: "field-a", value: "a projector" },
        { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
    ]);

    it("sends the answer it changed and names the other by id", async () => {
        sent.mockResolvedValue(answered(bothAnswered));
        const screen = await mount(deserializeSession(bothAnswered).data);

        await replace(screen, "What do you need?", "a whiteboard");
        const body = await save(screen, 1);

        expect(body).toEqual({
            data: {
                type: "session",
                id: sessionId,
                attributes: {},
                relationships: {
                    responses: {
                        data: [
                            { type: "response", lid: "field-a" },
                            { type: "response", id: "answer-b" },
                        ],
                    },
                },
            },
            included: [
                {
                    type: "response",
                    lid: "field-a",
                    attributes: { value: "a whiteboard" },
                    relationships: {
                        customField: { data: { type: "custom_field", id: "field-a" } },
                    },
                },
            ],
        });
    });

    // Fields stay editable while a save is out, and resetting to what the save
    // stored would take back what was typed meanwhile without a trace.
    it("keeps an answer typed while the save was out", async () => {
        const { promise: patched, resolve: answerPatch } = Promise.withResolvers<Response>();
        sent.mockReturnValueOnce(patched).mockResolvedValue(answered(bothAnswered));
        const screen = await mount(deserializeSession(bothAnswered).data);

        await replace(screen, "Title", "Renamed");
        await screen.getByRole("button", { name: "Save changes" }).click();
        await expect.poll(() => sent.mock.calls.length).toBe(1);
        await replace(screen, "Anything else?", "Hamburg");

        // Stored differently from what was sent, so only a rebase measured from
        // the values sent, rather than from the seed before them, shows it.
        answerPatch(
            answered(
                sessionDocument("Renamed (stored)", [
                    { id: "answer-a", customFieldId: "field-a", value: "a projector" },
                    { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
                ]),
            ),
        );

        await expect.element(screen.getByText("The session has been updated")).toBeVisible();
        await expect
            .element(screen.getByRole("textbox", { name: "Anything else?" }))
            .toHaveValue("Hamburg");
        await expect
            .element(screen.getByRole("textbox", { name: "Title" }))
            .toHaveValue("Renamed (stored)");
        await expect.element(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    });

    it("sends a changed duration", async () => {
        sent.mockResolvedValue(answered(bothAnswered));
        const screen = await mount(deserializeSession(bothAnswered).data);

        await replace(screen, "Duration", "45");
        const body = await save(screen, 1);

        expect(body.data.attributes).toEqual({ duration: "PT45M" });
    });

    it("carries the answers, all kept by id, when only the session type changed", async () => {
        sent.mockResolvedValue(answered(bothAnswered));
        const screen = await mount(deserializeSession(bothAnswered).data);

        await screen.getByRole("combobox", { name: "Session type" }).click();
        await screen.getByRole("option", { name: "Workshop" }).click();
        const body = await save(screen, 1);

        expect(body.data).toEqual({
            type: "session",
            id: sessionId,
            attributes: {},
            relationships: {
                sessionType: { data: { type: "session_type", id: "type-workshop" } },
                responses: {
                    data: [
                        { type: "response", id: "answer-a" },
                        { type: "response", id: "answer-b" },
                    ],
                },
            },
        });
    });

    it("refetches the form's sources before saying so when the API says it is out of date", async () => {
        sent.mockResolvedValue(
            new Response(
                JSON.stringify({
                    errors: [
                        { status: "422", code: "unknown_response", title: "Unknown response" },
                    ],
                }),
                { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
            ),
        );
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const { promise: refetched, resolve: finishRefetch } = Promise.withResolvers<void>();
        const invalidated = vi
            .spyOn(client, "invalidateQueries")
            .mockImplementation(() => refetched);
        const screen = await mount(deserializeSession(bothAnswered).data, client);
        const message = screen.getByText("This form was out of date", { exact: false });

        await replace(screen, "What do you need?", "a whiteboard");
        await save(screen, 1);

        // The message says the form has been refreshed, so it may only show
        // once the refetch is done.
        await expect.poll(() => invalidated.mock.calls.length).toBe(6);
        await expect.element(message).not.toBeInTheDocument();
        finishRefetch();
        await expect.element(message).toBeVisible();
        expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
            expect.arrayContaining([
                ["edition", editionId],
                ["customFields", editionId],
                ["session-types", editionId],
                ["tracks", editionId],
                ["session", editionId, sessionId],
            ]),
        );
    });

    const refusedAsStale = (): Response =>
        new Response(
            JSON.stringify({
                errors: [
                    {
                        status: "422",
                        code: "inapplicable_response",
                        title: "Inapplicable response",
                    },
                ],
            }),
            { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
        );

    // The second question asks talks only, so after the move to a workshop its
    // stored answer no longer applies, and the API wants it kept by id.
    const talkScoped = [
        customFields[0],
        { ...customFields[1], sessionTypes: [{ id: talk.id }] } as CustomField,
    ];

    const movedToWorkshop = () =>
        deserializeSession(
            sessionDocument(
                "Original title",
                [
                    { id: "answer-a", customFieldId: "field-a", value: "a projector" },
                    { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
                ],
                workshop,
            ),
        ).data;

    // An organizer moved the session to another type while the form was open,
    // and the refusal's refetch brought that in. The retry body shows the seed
    // moved too: left on the old seed, the type would read as the user's change
    // and be sent back.
    it("follows a session type someone else changed, keeping the user's own edit", async () => {
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        sent.mockImplementationOnce(async () => {
            client.setQueryData(["session", editionId, sessionId], movedToWorkshop());

            return refusedAsStale();
        });
        const screen = await mount(deserializeSession(bothAnswered).data, client, talkScoped);

        // An answer as well as the title, since the API judges answers only
        // when a save carries them, and only then can it refuse them.
        await replace(screen, "Title", "New title");
        await replace(screen, "What do you need?", "a whiteboard");
        await save(screen, 1);

        await expect
            .element(screen.getByRole("combobox", { name: "Session type" }))
            .toHaveValue("Workshop");
        await expect
            .element(screen.getByRole("textbox", { name: "Title" }))
            .toHaveValue("New title");

        sent.mockResolvedValueOnce(answered(bothAnswered));
        const retry = await save(screen, 2);

        expect(retry.data).toEqual({
            type: "session",
            id: sessionId,
            attributes: { title: "New title" },
            relationships: {
                responses: {
                    data: [
                        { type: "response", lid: "field-a" },
                        { type: "response", id: "answer-b" },
                    ],
                },
            },
        });
    });

    it("stays put when the refusal's refetch did not land", async () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        client.setQueryData(["session", editionId, sessionId], movedToWorkshop());
        // Watched, as the page watches it, and failing to refetch.
        const unsubscribe = new QueryObserver(client, {
            queryKey: ["session", editionId, sessionId],
            queryFn: () => Promise.reject(new Error("unavailable")),
            staleTime: Number.POSITIVE_INFINITY,
        }).subscribe(() => undefined);
        sent.mockResolvedValueOnce(refusedAsStale());
        const screen = await mount(deserializeSession(bothAnswered).data, client, talkScoped);

        await replace(screen, "Title", "New title");
        await replace(screen, "What do you need?", "a whiteboard");
        await save(screen, 1);

        await expect
            .element(screen.getByText("could not be refreshed", { exact: false }))
            .toBeVisible();
        unsubscribe();
        await expect
            .element(screen.getByRole("combobox", { name: "Session type" }))
            .toHaveValue("Talk");
    });

    // Kept on the form, a track the edition stopped asking for would never be
    // sent, yet would stay marked as changed, so every save would carry the
    // answers, scoped by a track the session does not have.
    it("puts the stored track back when the edition stops asking for one", async () => {
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const onMainStage = deserializeSession(
            sessionDocument("Original title", [], talk, mainStage),
        ).data;
        const askingTrack: FormOverrides = {
            edition: {
                ...edition,
                sessionFieldOptions: { ...edition.sessionFieldOptions, track: {} },
            } as Edition,
            specs: {
                ...specs,
                track: { label: "Track", forceRequired: false, type: "relationship" },
            },
            fieldNames: ["sessionType", "title", "track", "duration"],
            tracks: [mainStage, sideStage],
        };
        sent.mockImplementationOnce(async () => {
            client.setQueryData(["session", editionId, sessionId], onMainStage);
            client.setQueryData(["edition", editionId], { edition });

            return new Response(
                JSON.stringify({
                    errors: [
                        {
                            status: "422",
                            code: "session_fields_changed",
                            title: "Session fields changed",
                        },
                    ],
                }),
                { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
            );
        });
        const screen = await mount(onMainStage, client, customFields, noUploads, askingTrack);

        await replace(screen, "Title", "New title");
        await screen.getByRole("combobox", { name: "Track" }).click();
        await screen.getByRole("option", { name: "Side stage" }).click();
        await save(screen, 1);
        await expect
            .element(screen.getByText("This form was out of date", { exact: false }))
            .toBeVisible();
        await screen.rerender(
            formFor(onMainStage, customFields, noUploads, { tracks: [mainStage, sideStage] }),
        );

        await expect
            .element(screen.getByRole("combobox", { name: "Track" }))
            .not.toBeInTheDocument();

        sent.mockResolvedValueOnce(answered(sessionDocument("New title", [], talk, mainStage)));
        const retry = await save(screen, 2);

        expect(retry.data).toEqual({
            type: "session",
            id: sessionId,
            attributes: { title: "New title" },
            relationships: {},
        });
    });

    it("leaves the answers out when only the title changed", async () => {
        sent.mockResolvedValue(answered(bothAnswered));
        const screen = await mount(deserializeSession(bothAnswered).data);

        await replace(screen, "Title", "New title");
        const body = await save(screen, 1);

        expect(body).toEqual({
            data: {
                type: "session",
                id: sessionId,
                attributes: { title: "New title" },
                relationships: {},
            },
            included: [],
        });
    });

    it("keeps an answer someone else gave while the form was open", async () => {
        const oneAnswered = sessionDocument("Original title", [
            { id: "answer-a", customFieldId: "field-a", value: "a projector" },
        ]);
        const answeredMeanwhile = sessionDocument("Original title", [
            { id: "answer-a", customFieldId: "field-a", value: "a projector" },
            { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
        ]);
        sent.mockResolvedValue(answered(answeredMeanwhile));
        const screen = await mount(deserializeSession(oneAnswered).data);

        await screen.rerender(formFor(deserializeSession(answeredMeanwhile).data));
        await replace(screen, "What do you need?", "a whiteboard");
        const body = await save(screen, 1);

        expect(body.data.relationships).toEqual({
            responses: {
                data: [
                    { type: "response", lid: "field-a" },
                    { type: "response", id: "answer-b" },
                ],
            },
        });
    });

    it("names an answer the last save created even when its refetch failed", async () => {
        const oneAnswered = sessionDocument("Original title", [
            { id: "answer-a", customFieldId: "field-a", value: "a projector" },
        ]);
        sent.mockResolvedValueOnce(
            answered(
                sessionDocument("Original title", [
                    { id: "answer-a", customFieldId: "field-a", value: "a projector" },
                    { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
                ]),
            ),
        );
        const screen = await mount(deserializeSession(oneAnswered).data);

        await replace(screen, "Anything else?", "Berlin");
        await save(screen, 1);
        await expect.element(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

        sent.mockResolvedValueOnce(answered(oneAnswered));
        await replace(screen, "What do you need?", "a whiteboard");
        const second = await save(screen, 2);

        expect(second.data.relationships).toEqual({
            responses: {
                data: [
                    { type: "response", lid: "field-a" },
                    { type: "response", id: "answer-b" },
                ],
            },
        });
    });

    it("measures a second save against what the first one stored", async () => {
        const oneAnswered = sessionDocument("Original title", [
            { id: "answer-a", customFieldId: "field-a", value: "a projector" },
        ]);
        const firstStored = sessionDocument("Original title", [
            { id: "answer-a", customFieldId: "field-a", value: "a projector" },
            { id: "answer-b", customFieldId: "field-b", value: "Berlin, Germany" },
        ]);
        sent.mockResolvedValueOnce(answered(firstStored));
        const screen = await mount(deserializeSession(oneAnswered).data);

        await replace(screen, "Anything else?", "Berlin");
        const first = await save(screen, 1);
        expect(first.data.relationships).toEqual({
            responses: {
                data: [
                    { type: "response", lid: "field-b" },
                    { type: "response", id: "answer-a" },
                ],
            },
        });

        sent.mockResolvedValueOnce(answered(sessionDocument("Third title", [])));
        await expect.element(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
        // What the server stored rather than what was sent, which another
        // writer or the server itself may have changed on the way.
        await expect
            .element(screen.getByRole("textbox", { name: "Anything else?" }))
            .toHaveValue("Berlin, Germany");
        // What the route hands down once the save's refetch lands.
        await screen.rerender(formFor(deserializeSession(firstStored).data));
        await replace(screen, "Title", "Third title");
        const second = await save(screen, 2);

        expect(second).toEqual({
            data: {
                type: "session",
                id: sessionId,
                attributes: { title: "Third title" },
                relationships: {},
            },
            included: [],
        });
    });
});

describe("a frozen question on the organizer's form", () => {
    const frozenField = {
        ...textField("field-frozen", "T-shirt size"),
        requirement: "always_required",
        freezeAfter: Temporal.Now.instant().subtract({ hours: 1 }),
    } as CustomField;
    const withFrozenAnswer = sessionDocument("Original title", [
        { id: "answer-a", customFieldId: "field-a", value: "a projector" },
        { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
        { id: "answer-frozen", customFieldId: "field-frozen", value: "XXL" },
    ]);

    const mountWithFrozen = () =>
        mount(deserializeSession(withFrozenAnswer).data, undefined, [...customFields, frozenField]);

    it("shows the stored answer without offering an input for it", async () => {
        const screen = await mountWithFrozen();

        await expect.element(screen.getByText("Frozen questions")).toBeVisible();
        await expect.element(screen.getByText("XXL")).toBeVisible();
        await expect
            .element(screen.getByRole("textbox", { name: "T-shirt size" }))
            .not.toBeInTheDocument();
    });

    it("keeps its stored answer by id in the answers a type change carries", async () => {
        sent.mockResolvedValue(answered(withFrozenAnswer));
        const screen = await mountWithFrozen();

        await screen.getByRole("combobox", { name: "Session type" }).click();
        await screen.getByRole("option", { name: "Workshop" }).click();
        const body = await save(screen, 1);

        expect(body.data.relationships).toEqual({
            sessionType: { data: { type: "session_type", id: "type-workshop" } },
            responses: {
                data: [
                    { type: "response", id: "answer-frozen" },
                    { type: "response", id: "answer-a" },
                    { type: "response", id: "answer-b" },
                ],
            },
        });
    });
});

describe("a question freezing while the form is open", () => {
    it("moves it among the frozen questions when it freezes", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });

        try {
            const now = Temporal.Instant.from("2026-10-01T10:00:00Z");
            vi.setSystemTime(now.epochMilliseconds);
            const freezing = {
                ...textField("field-diet", "Dietary needs"),
                freezeAfter: now.add({ seconds: 30 }),
            } as CustomField;
            const document = sessionDocument("Original title", [
                { id: "answer-diet", customFieldId: "field-diet", value: "Vegan" },
            ]);
            const screen = await mount(deserializeSession(document).data, undefined, [freezing]);

            await expect
                .element(screen.getByRole("textbox", { name: "Dietary needs" }))
                .toBeVisible();

            await vi.advanceTimersByTimeAsync(31_000);

            await expect.element(screen.getByText("Frozen questions")).toBeVisible();
            await expect.element(screen.getByText("Vegan")).toBeVisible();
            await expect
                .element(screen.getByRole("textbox", { name: "Dietary needs" }))
                .not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("an upload in flight", () => {
    // A save sent now would carry the field's old value, and the reset after it
    // would wipe the upload when it landed.
    it("holds the save until the upload has settled", async () => {
        const { promise: presign, resolve: answerPresign } = Promise.withResolvers<Response>();
        const slides = {
            ...textField("field-slides", "Slides"),
            options: { type: "file" },
        } as CustomField;
        const document = sessionDocument("Original title", []);
        sent.mockImplementation(async (url: URL) =>
            String(url).endsWith("/signed-posts") ? presign : answered(document),
        );
        const screen = await mount(deserializeSession(document).data, undefined, [slides], {
            maxFileSize: 1_000_000,
            fileContentTypes: ["application/pdf"],
            imageContentTypes: [],
        });
        const saveButton = screen.getByRole("button", { name: "Save changes" });

        await replace(screen, "Title", "Renamed");
        await expect.element(saveButton).toBeEnabled();

        await screen.getByRole("button", { name: /Choose file/ }).click();
        await expect.element(saveButton).toBeDisabled();
        // A spinner there would read as the save already running.
        await expect.element(saveButton.getByRole("progressbar")).not.toBeInTheDocument();
        await expect
            .element(screen.getByText("You can save once the upload has finished."))
            .toBeVisible();

        answerPresign(
            new Response(
                JSON.stringify({ errors: [{ status: "500", title: "Internal Server Error" }] }),
                { status: 500, headers: { "Content-Type": "application/vnd.api+json" } },
            ),
        );
        await expect.element(saveButton).toBeEnabled();
        // The helper text below the field, rather than the hidden live region
        // repeating it for screen readers.
        await expect
            .element(screen.getByRole("group", { name: "Slides" }))
            .toHaveAccessibleDescription(/The file could not be uploaded\. Try again\./);
    });

    // A question can leave the form mid-upload, as one freezing does, and
    // nothing would be left to show the upload or cancel it.
    it("stops holding the save when the field it runs in goes away", async () => {
        const presign = new Promise<Response>(() => undefined);
        const slides = {
            ...textField("field-slides", "Slides"),
            options: { type: "file" },
        } as CustomField;
        const uploadLimits = {
            maxFileSize: 1_000_000,
            fileContentTypes: ["application/pdf"],
            imageContentTypes: [],
        };
        const document = sessionDocument("Original title", []);
        const session = deserializeSession(document).data;
        sent.mockImplementation(async (url: URL) =>
            String(url).endsWith("/signed-posts") ? presign : answered(document),
        );
        const screen = await mount(session, undefined, [slides], uploadLimits);
        const saveButton = screen.getByRole("button", { name: "Save changes" });

        await replace(screen, "Title", "Renamed");
        await screen.getByRole("button", { name: /Choose file/ }).click();
        await expect.element(saveButton).toBeDisabled();

        await screen.rerender(formFor(session, [], uploadLimits));
        await expect.element(saveButton).toBeEnabled();
    });
});
