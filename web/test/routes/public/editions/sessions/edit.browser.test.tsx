import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";
import type { EditionDocument } from "#/queries/edition.ts";
import { deserializeSession, type SessionState } from "#/queries/session.ts";
import type { SessionType } from "#/queries/session-type.ts";
import type { Track } from "#/queries/track.ts";
import { Route } from "#/routes/_user/_public/editions/$editionId/sessions/$sessionId/edit.tsx";
import { replace } from "../../../../support/forms.ts";
import { answered } from "../../../../support/json-api.ts";
import { createTestTheme } from "../../../../support/theme.ts";
import { userWithRole } from "../../../../support/users.ts";

const { sent, navigate, editionId, sessionId } = vi.hoisted(() => ({
    sent: vi.fn(),
    navigate: vi.fn(),
    editionId: "edition-1",
    sessionId: "session-1",
}));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

// Lets the route component render without a router around it.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
    ...(await importOriginal()),
    createFileRoute: (() => (options: unknown) => ({
        options,
        useParams: () => ({ editionId, sessionId }),
    })) as never,
    useNavigate: () => navigate,
    useBlocker: (() => undefined) as never,
}));

const EditPage = Route.options.component as ComponentType;
const theme = createTestTheme();

const editionDocument = {
    edition: {
        id: editionId,
        name: "Dev Edition",
        startDate: Temporal.PlainDate.from("2026-11-21"),
        endDate: Temporal.PlainDate.from("2026-11-23"),
        submissionDeadline: null,
        timeZone: "Europe/Berlin",
        sessionFieldOptions: { title: {} },
        profileFieldOptions: {},
    },
    sessionFieldSpecs: {
        sessionType: { label: "Session type", forceRequired: true, type: "relationship" },
        title: { label: "Title", forceRequired: true, type: "string" },
    },
    profileFieldSpecs: {},
    uploadLimits: { maxFileSize: 1, fileContentTypes: [], imageContentTypes: [] },
} as unknown as EditionDocument;

const editionAskingTrack = {
    ...editionDocument,
    edition: {
        ...editionDocument.edition,
        sessionFieldOptions: { title: {}, track: {} },
    },
    sessionFieldSpecs: {
        ...editionDocument.sessionFieldSpecs,
        track: { label: "Track", forceRequired: false, type: "relationship" },
    },
} as unknown as EditionDocument;

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

const textField = (id: string, title: string, sessionTypes: SessionType[] = []): CustomField =>
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
        sessionTypes: sessionTypes.map(({ id: typeId }) => ({ id: typeId })),
        tracks: [],
    }) as unknown as CustomField;

// The second question asks talks only, so a move to a workshop leaves its
// stored answer with no question on the form to hold it.
const customFields = [
    textField("field-a", "What do you need?"),
    textField("field-b", "Anything else?", [talk]),
];

const bothAnswers = [
    { id: "answer-a", customFieldId: "field-a", value: "a projector" },
    { id: "answer-b", customFieldId: "field-b", value: "Berlin" },
];

type SessionShape = {
    state?: SessionState;
    hosting?: boolean;
    sessionType?: SessionType;
    track?: Track;
};

/** A session as the API serves it, answered on both questions. */
const sessionDocument = ({
    state = "submitted",
    hosting = true,
    sessionType = talk,
    track,
}: SessionShape = {}) => ({
    jsonapi: { version: "1.1" },
    data: {
        type: "session",
        id: sessionId,
        attributes: {
            createdAt: "2026-09-01T10:00:00Z",
            state,
            title: "Original title",
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
            responses: { data: bothAnswers.map(({ id }) => ({ type: "response", id })) },
        },
        meta: { hostTransitions: [], managerTransitions: [], hosting },
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
        ...bothAnswers.map(({ id, customFieldId, value }) => ({
            type: "response",
            id,
            attributes: { value },
            relationships: { customField: { data: { type: "custom_field", id: customFieldId } } },
        })),
    ],
});

const refused = (status: number, code: string, title: string): Response =>
    new Response(JSON.stringify({ errors: [{ status: String(status), code, title }] }), {
        status,
        headers: { "Content-Type": "application/vnd.api+json" },
    });

type ProvidersProps = {
    children: ReactNode;
};

// Retrying a refused refetch with backoff would hold the save's promise for seconds.
const newClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const mount = async (
    client: QueryClient,
    shape: SessionShape = {},
    edition: EditionDocument = editionDocument,
) => {
    client.setQueryData(["edition", editionId], edition);
    client.setQueryData(["customFields", editionId], customFields);
    client.setQueryData(["current-user"], userWithRole(null));
    client.setQueryData(["session-types", editionId], [talk, workshop]);
    client.setQueryData(["tracks", editionId], [mainStage, sideStage]);
    client.setQueryData(
        ["session", editionId, sessionId],
        deserializeSession(sessionDocument(shape)).data,
    );
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

    return render(<EditPage />, { wrapper: Providers });
};

type Screen = Awaited<ReturnType<typeof mount>>;

type ResponseIdentifier = {
    type: "response";
    id?: string;
    lid?: string;
};

type IncludedResponse = {
    lid: string;
    attributes: { value: unknown };
};

type PatchBody = {
    data: {
        attributes: unknown;
        relationships: { responses?: { data: ResponseIdentifier[] } };
    };
    included?: IncludedResponse[];
};

const patches = (): RequestInit[] =>
    sent.mock.calls
        .map(([, init]) => init as RequestInit | undefined)
        .filter((init): init is RequestInit => init?.method === "PATCH");

const save = async (screen: Screen, count: number): Promise<PatchBody> => {
    await screen.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => patches().length).toBe(count);

    return JSON.parse(patches()[count - 1]?.body as string) as PatchBody;
};

beforeEach(() => {
    sent.mockReset();
    navigate.mockReset();
    window.localStorage.setItem("preferredLocale", "en-US");
});

describe("editing a session as its host", () => {
    it("keeps the answer the new type no longer asks by id", async () => {
        sent.mockImplementation(async () => answered(sessionDocument({ sessionType: workshop })));
        const screen = await mount(newClient());

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
                    data: expect.arrayContaining([
                        { type: "response", id: "answer-a" },
                        { type: "response", id: "answer-b" },
                    ]),
                },
            },
        });
        expect(body.data.relationships.responses?.data).toHaveLength(2);
    });

    // An organizer moved the session to a workshop while the page was open.
    // Left on the old seed, the type would read as the host's change and be
    // sent back.
    it("follows a session type someone else changed, keeping the host's own edit", async () => {
        const client = newClient();
        sent.mockImplementation(async (_url: URL, init?: RequestInit) => {
            if (init?.method !== "PATCH") {
                return refused(503, "unavailable", "Service unavailable");
            }

            if (patches().length > 1) {
                return answered(sessionDocument({ sessionType: workshop }));
            }

            client.setQueryData(
                ["session", editionId, sessionId],
                deserializeSession(sessionDocument({ sessionType: workshop })).data,
            );

            return refused(422, "inapplicable_response", "Inapplicable response");
        });
        const screen = await mount(client);

        await replace(screen, "Title", "New title");
        await replace(screen, "What do you need?", "a whiteboard");
        await save(screen, 1);

        await expect
            .element(screen.getByRole("combobox", { name: "Session type" }))
            .toHaveValue("Workshop");
        await expect
            .element(screen.getByRole("textbox", { name: "Title" }))
            .toHaveValue("New title");

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
        expect(retry.included?.find(({ lid }) => lid === "field-a")?.attributes.value).toBe(
            "a whiteboard",
        );
    });

    // Kept on the form, a track the edition stopped asking for would never be
    // sent, yet would stay marked as changed, so every save would carry the
    // answers, scoped by a track the session does not have.
    it("puts the stored track back when the edition stops asking for one", async () => {
        const client = newClient();
        sent.mockImplementation(async (_url: URL, init?: RequestInit) => {
            if (init?.method !== "PATCH") {
                return refused(503, "unavailable", "Service unavailable");
            }

            if (patches().length > 1) {
                return answered(sessionDocument({ track: mainStage }));
            }

            client.setQueryData(["edition", editionId], editionDocument);

            return refused(422, "session_fields_changed", "Session fields changed");
        });
        const screen = await mount(client, { track: mainStage }, editionAskingTrack);

        await replace(screen, "Title", "New title");
        await screen.getByRole("combobox", { name: "Track" }).click();
        await screen.getByRole("option", { name: "Side stage" }).click();
        await save(screen, 1);

        await expect
            .element(screen.getByRole("combobox", { name: "Track" }))
            .not.toBeInTheDocument();

        const retry = await save(screen, 2);

        expect(retry.data).toEqual({
            type: "session",
            id: sessionId,
            attributes: { title: "New title" },
            relationships: {},
        });
    });

    it("tells someone who does not host the session that only a host can edit it", async () => {
        const screen = await mount(newClient(), { hosting: false });

        await expect
            .element(screen.getByText("Only a host of this session can edit it."))
            .toBeVisible();
        expect(screen.container.querySelector("form")).toBeNull();
    });

    it("tells a host the session can no longer be edited once it is confirmed", async () => {
        const screen = await mount(newClient(), { state: "confirmed" });

        await expect
            .element(screen.getByText("This session can no longer be edited."))
            .toBeVisible();
        expect(screen.container.querySelector("form")).toBeNull();
    });
});
