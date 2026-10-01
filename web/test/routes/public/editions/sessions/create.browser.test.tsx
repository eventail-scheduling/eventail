import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";
import type { EditionDocument } from "#/queries/edition.ts";
import { deserializeOwnHost } from "#/queries/host.ts";
import type { SessionType } from "#/queries/session-type.ts";
import { Route } from "#/routes/_user/_public/editions/$editionId/sessions/create.tsx";
import { replace } from "../../../../support/forms.ts";
import { answered } from "../../../../support/json-api.ts";
import { createTestTheme } from "../../../../support/theme.ts";
import { userWithRole } from "../../../../support/users.ts";

const { sent, navigate, editionId } = vi.hoisted(() => ({
    sent: vi.fn(),
    navigate: vi.fn(),
    editionId: "edition-1",
}));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

// The native picker cannot be driven from a test.
vi.mock("browser-fs-access", () => ({
    fileOpen: async () => new File(["%PDF-1.4"], "slides.pdf", { type: "application/pdf" }),
}));

// Lets the route component render without a router around it.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
    ...(await importOriginal()),
    createFileRoute: (() => (options: unknown) => ({
        options,
        useParams: () => ({ editionId }),
    })) as never,
    useNavigate: () => navigate,
    useBlocker: (() => undefined) as never,
}));

const Wizard = Route.options.component as ComponentType;
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
    profileFieldSpecs: {
        displayName: { label: "Display name", forceRequired: true, type: "string" },
        emailAddress: { label: "Email address", forceRequired: true, type: "string" },
    },
    uploadLimits: { maxFileSize: 1, fileContentTypes: [], imageContentTypes: [] },
} as unknown as EditionDocument;

const talk = {
    id: "type-talk",
    name: "Talk",
    externalKey: null,
    defaultDuration: Temporal.Duration.from({ minutes: 30 }),
    internal: false,
    selectionDefault: true,
} as unknown as SessionType;

const question = (
    id: string,
    title: string,
    requirement: CustomField["requirement"],
): CustomField =>
    ({
        id,
        externalKey: null,
        target: "per_proposal",
        requirement,
        title,
        helperText: "",
        options: { type: "single_line_text" },
        answerMaxLength: 200,
        deadline: null,
        freezeAfter: null,
        sessionTypes: [],
        tracks: [],
    }) as unknown as CustomField;

const optionalQuestion = question("field-else", "Anything else?", "always_optional");
const requiredQuestion = question("field-needs", "What do you need?", "always_required");

type StoredAnswer = {
    id: string;
    customFieldId: string;
    value: string;
};

const hostDocument = (displayName: string, answers: StoredAnswer[] = []) => ({
    jsonapi: { version: "1.1" },
    data: {
        type: "host",
        id: "host-1",
        attributes: {
            displayName,
            emailAddress: "speaker@example.test",
            biography: "",
            avatar: null,
        },
        relationships: {
            responses: { data: answers.map(({ id }) => ({ type: "response", id })) },
            availabilities: { data: [] },
        },
    },
    included: answers.map(({ id, customFieldId, value }) => ({
        type: "response",
        id,
        attributes: { value },
        relationships: { customField: { data: { type: "custom_field", id: customFieldId } } },
    })),
});

const availabilityEdition = (startDate: string, endDate: string): EditionDocument =>
    ({
        ...editionDocument,
        edition: {
            ...editionDocument.edition,
            startDate: Temporal.PlainDate.from(startDate),
            endDate: Temporal.PlainDate.from(endDate),
            profileFieldOptions: { availability: { requirement: "optional" } },
        },
        profileFieldSpecs: {
            ...editionDocument.profileFieldSpecs,
            availability: { label: "Availability", type: "availability" },
        },
    }) as unknown as EditionDocument;

const hostAvailableFrom = (startsAt: string, endsAt: string) => {
    const document = hostDocument("Dev Speaker");

    return {
        ...document,
        data: {
            ...document.data,
            relationships: {
                ...document.data.relationships,
                availabilities: { data: [{ type: "host_availability", id: "availability-1" }] },
            },
        },
        included: [
            { type: "host_availability", id: "availability-1", attributes: { startsAt, endsAt } },
        ],
    } as unknown as ReturnType<typeof hostDocument>;
};

const refused = (status: number, code: string, title: string): Response =>
    new Response(JSON.stringify({ errors: [{ status: String(status), code, title }] }), {
        status,
        headers: { "Content-Type": "application/vnd.api+json" },
    });

type ProvidersProps = {
    children: ReactNode;
};

const mount = async (
    client: QueryClient,
    customFields: CustomField[] = [],
    document: EditionDocument = editionDocument,
    answers: StoredAnswer[] = [],
    host = hostDocument("Dev Speaker", answers),
) => {
    client.setQueryData(["edition", editionId], document);
    client.setQueryData(["customFields", editionId], customFields);
    client.setQueryData(["current-user"], userWithRole(null));
    client.setQueryData(["session-types", editionId], [talk]);
    client.setQueryData(["tracks", editionId], []);
    client.setQueryData(["me", "host", editionId], deserializeOwnHost(host).data);
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

    return render(<Wizard />, { wrapper: Providers });
};

// The refetches a save triggers are refused like any other request a test does
// not answer, and the cache keeps its copy. Retrying them with backoff would
// hold the save's own promise for seconds.
const newClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

type Screen = Awaited<ReturnType<typeof mount>>;

/** Fills the session step and moves on through any others to the profile, which is always last. */
const reachProfile = async (screen: Screen, stepsBetween = 0): Promise<void> => {
    await replace(screen, "Title", "Temporal in practice");

    for (let step = 0; step <= stepsBetween; step++) {
        await screen.getByRole("button", { name: "Next" }).click();
    }

    await expect.element(screen.getByRole("textbox", { name: "Display name" })).toBeVisible();
};

const requestsBy = (method: string): RequestInit[] =>
    sent.mock.calls
        .map(([, init]) => init as RequestInit | undefined)
        .filter((init): init is RequestInit => init?.method === method);

const bodyOf = (request: RequestInit | undefined): unknown => JSON.parse(request?.body as string);

beforeEach(() => {
    sent.mockReset();
    navigate.mockReset();
    window.localStorage.setItem("preferredLocale", "en-US");
});

describe("submitting a session through the wizard", () => {
    // What the host write stores can differ from what it was sent, as a
    // consumed upload does, so the server here normalizes the name. Only
    // reseeding both the measure and the fields from the stored profile leaves
    // the retry nothing to send.
    it("sends an empty host patch when retrying after a failed create", async () => {
        const { promise: hostWritten, resolve: finishHostWrite } = Promise.withResolvers<void>();
        sent.mockImplementation(async (_url: URL, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                await hostWritten;

                return answered(hostDocument("Stage name"));
            }

            return refused(503, "unavailable", "Service unavailable");
        });
        const screen = await mount(newClient());

        await reachProfile(screen);
        await replace(screen, "Display name", "Stage Name");
        await screen.getByRole("button", { name: "Submit session" }).click();

        // While the host write is out, the profile fields the reseed will
        // overwrite must not take edits.
        await expect.poll(() => requestsBy("PATCH").length).toBe(1);
        await expect.element(screen.getByRole("button", { name: "Back" })).toBeDisabled();
        expect(
            screen.getByRole("textbox", { name: "Display name" }).element().closest("[inert]"),
        ).not.toBeNull();

        finishHostWrite();
        await expect.poll(() => requestsBy("POST").length).toBe(1);
        await expect.element(screen.getByRole("button", { name: "Back" })).toBeEnabled();
        await screen.getByRole("button", { name: "Submit session" }).click();
        await expect.poll(() => requestsBy("PATCH").length).toBe(2);

        expect(bodyOf(requestsBy("PATCH")[0])).toEqual({
            data: { type: "host", attributes: { displayName: "Stage Name" } },
            included: [],
        });
        expect(bodyOf(requestsBy("PATCH")[1])).toEqual({
            data: { type: "host", attributes: {} },
            included: [],
        });
    });

    // Moving an edition re-anchors stored availability a day on. Until the
    // speaker reaches the profile step its field is not mounted, which is the
    // case where the settled set has to reach the form's values and not only
    // the field's default.
    it("sends no availability after the edition moves before the profile step", async () => {
        const client = newClient();
        const settled = hostAvailableFrom("2026-11-22T08:00:00Z", "2026-11-22T16:00:00Z");
        sent.mockImplementation(async (url: URL, init?: RequestInit) => {
            if (init?.method === "PATCH" || url.pathname.endsWith("/me/host")) {
                return answered(settled);
            }

            return refused(503, "unavailable", "Service unavailable");
        });
        const screen = await mount(
            client,
            [],
            availabilityEdition("2026-11-21", "2026-11-23"),
            [],
            hostAvailableFrom("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z"),
        );
        await expect.element(screen.getByRole("textbox", { name: "Title" })).toBeVisible();

        client.setQueryData(
            ["edition", editionId],
            availabilityEdition("2026-11-22", "2026-11-24"),
        );
        await expect
            .element(screen.getByText(/The availability shown is what it settled to/))
            .toBeVisible();

        await reachProfile(screen);
        await screen.getByRole("button", { name: "Submit session" }).click();
        await expect.poll(() => requestsBy("PATCH").length).toBe(1);

        expect(bodyOf(requestsBy("PATCH")[0])).toEqual({
            data: { type: "host", attributes: {} },
            included: [],
        });
    });

    // The profile keeps its position when the question lands on a step that was
    // already there, so only the jump can bring the user back to it.
    it("jumps back to a question a refused create brings in", async () => {
        const client = newClient();
        vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        sent.mockImplementation(async (_url: URL, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                return answered(hostDocument("Dev Speaker"));
            }

            if (init?.method === "POST") {
                // What the refusal's refetch would have brought in.
                client.setQueryData(
                    ["customFields", editionId],
                    [optionalQuestion, requiredQuestion],
                );

                return refused(422, "missing_responses", "Missing responses");
            }

            return refused(503, "unavailable", "Service unavailable");
        });
        const screen = await mount(client, [optionalQuestion]);

        await reachProfile(screen, 1);
        await screen.getByRole("button", { name: "Submit session" }).click();

        await expect
            .element(screen.getByRole("textbox", { name: "What do you need?", exact: false }))
            .toBeVisible();
        expect(client.invalidateQueries).toHaveBeenCalledWith({
            queryKey: ["customFields", editionId],
        });
    });

    // Only the field it was started from can show its progress or cancel it,
    // so leaving the step would strand it.
    it("waits for an upload before moving on, then files its answer", async () => {
        const { promise: uploaded, resolve: finishUpload } = Promise.withResolvers<void>();

        class HeldUpload extends EventTarget {
            public readonly upload = new EventTarget();
            public status = 0;

            public open = (): void => undefined;

            public abort = (): void => undefined;

            public send(): void {
                void uploaded.then(() => {
                    this.status = 204;
                    this.dispatchEvent(new Event("load"));
                });
            }
        }

        vi.stubGlobal("XMLHttpRequest", HeldUpload);

        try {
            const slides = {
                ...question("field-slides", "Slides", "always_optional"),
                options: { type: "file" },
            } as CustomField;
            sent.mockImplementation(async (url: URL, init?: RequestInit) => {
                if (String(url).endsWith("/signed-posts")) {
                    return new Response(
                        JSON.stringify({
                            data: {
                                type: "signed_post",
                                id: "post-1",
                                attributes: {
                                    key: "temp/slides-key.pdf",
                                    url: "https://store.test/",
                                    fields: {},
                                    expiresIn: 600,
                                },
                            },
                        }),
                        { status: 201, headers: { "Content-Type": "application/vnd.api+json" } },
                    );
                }

                if (init?.method === "PATCH") {
                    return answered(hostDocument("Dev Speaker"));
                }

                return refused(503, "unavailable", "Service unavailable");
            });
            const screen = await mount(newClient(), [slides, optionalQuestion], {
                ...editionDocument,
                uploadLimits: {
                    maxFileSize: 1_000_000,
                    fileContentTypes: ["application/pdf"],
                    imageContentTypes: [],
                },
            });

            await replace(screen, "Title", "Temporal in practice");
            await screen.getByRole("button", { name: "Next" }).click();
            await screen.getByRole("button", { name: /Choose file/ }).click();

            await expect.element(screen.getByRole("button", { name: "Next" })).toBeDisabled();
            await expect.element(screen.getByRole("button", { name: "Back" })).toBeDisabled();
            // Had Enter moved on, the profile step would offer Submit, and the
            // Next awaited below would never appear.
            await userEvent.type(
                screen.getByRole("textbox", { name: "Anything else?" }),
                "a projector{Enter}",
            );

            finishUpload();
            await expect.element(screen.getByRole("button", { name: "Next" })).toBeEnabled();
            await screen.getByRole("button", { name: "Next" }).click();
            await screen.getByRole("button", { name: "Submit session" }).click();
            await expect.poll(() => requestsBy("POST").length).toBe(2);

            expect(JSON.stringify(bodyOf(requestsBy("POST")[1]))).toContain(
                '"value":{"key":"temp/slides-key.pdf","filename":"slides.pdf"}',
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("asks for a file again at its question when the upload expired before the save", async () => {
        class LandedUpload extends EventTarget {
            public readonly upload = new EventTarget();
            public status = 0;

            public open = (): void => undefined;

            public abort = (): void => undefined;

            public send(): void {
                queueMicrotask(() => {
                    this.status = 204;
                    this.dispatchEvent(new Event("load"));
                });
            }
        }

        vi.stubGlobal("XMLHttpRequest", LandedUpload);

        try {
            const slides = {
                ...question("field-slides", "Slides", "always_optional"),
                options: { type: "file" },
            } as CustomField;
            sent.mockImplementation(async (url: URL, init?: RequestInit) => {
                if (String(url).endsWith("/signed-posts")) {
                    return new Response(
                        JSON.stringify({
                            data: {
                                type: "signed_post",
                                id: "post-1",
                                attributes: {
                                    key: "temp/slides-key.pdf",
                                    url: "https://store.test/",
                                    fields: {},
                                    expiresIn: 600,
                                },
                            },
                        }),
                        { status: 201, headers: { "Content-Type": "application/vnd.api+json" } },
                    );
                }

                if (init?.method === "PATCH") {
                    return answered(hostDocument("Dev Speaker"));
                }

                if (init?.method !== "POST") {
                    return refused(503, "unavailable", "Service unavailable");
                }

                return new Response(
                    JSON.stringify({
                        errors: [
                            {
                                status: "404",
                                code: "missing_file",
                                title: "Missing file",
                                meta: { customFieldId: "field-slides", key: "temp/slides-key.pdf" },
                            },
                        ],
                    }),
                    { status: 404, headers: { "Content-Type": "application/vnd.api+json" } },
                );
            });
            const screen = await mount(newClient(), [slides], {
                ...editionDocument,
                uploadLimits: {
                    maxFileSize: 1_000_000,
                    fileContentTypes: ["application/pdf"],
                    imageContentTypes: [],
                },
            });

            await replace(screen, "Title", "Temporal in practice");
            await screen.getByRole("button", { name: "Next" }).click();
            await screen.getByRole("button", { name: /Choose file/ }).click();
            await expect.element(screen.getByText("slides.pdf")).toBeVisible();
            await screen.getByRole("button", { name: "Next" }).click();
            await screen.getByRole("button", { name: "Submit session" }).click();

            await expect
                .element(screen.getByRole("group", { name: "Slides" }))
                .toHaveAccessibleDescription(/This upload expired before it was saved/);
            await expect.element(screen.getByText("slides.pdf")).not.toBeInTheDocument();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    // An organizer reopens a question by moving its freeze later or clearing
    // it; this test clears it.
    it("shows a host answer when its question unfreezes", async () => {
        const tshirt = (freezeAfter: Temporal.Instant | null) =>
            ({
                ...question("field-tshirt", "T-shirt size", "always_optional"),
                target: "per_host",
                freezeAfter,
            }) as CustomField;
        const client = newClient();
        const screen = await mount(
            client,
            [tshirt(Temporal.Now.instant().subtract({ hours: 1 }))],
            editionDocument,
            [{ id: "answer-tshirt", customFieldId: "field-tshirt", value: "M" }],
        );

        client.setQueryData(["customFields", editionId], [tshirt(null)]);
        await replace(screen, "Title", "Temporal in practice");
        await screen.getByRole("button", { name: "Next" }).click();

        await expect
            .element(screen.getByRole("textbox", { name: "T-shirt size" }))
            .toHaveValue("M");
    });

    // Leaving the profile step would unmount it and cancel an avatar upload
    // running there, and the speaker never asked to move.
    it("keeps the speaker on the profile when a question step arrives ahead of it", async () => {
        const client = newClient();
        const screen = await mount(client);
        await reachProfile(screen);

        client.setQueryData(["customFields", editionId], [optionalQuestion]);

        await expect.element(screen.getByText("More info")).toBeVisible();
        await expect.element(screen.getByRole("textbox", { name: "Display name" })).toBeVisible();
        await expect
            .element(screen.getByRole("textbox", { name: "Anything else?" }))
            .not.toBeInTheDocument();
    });

    // A form with one text input submits on Enter, and More info here holds
    // exactly one.
    it("moves on rather than submitting when Enter is pressed before the last step", async () => {
        sent.mockImplementation(async () => refused(503, "unavailable", "Service unavailable"));
        const screen = await mount(newClient(), [optionalQuestion]);

        await replace(screen, "Title", "Temporal in practice");
        await screen.getByRole("button", { name: "Next" }).click();
        await userEvent.type(
            screen.getByRole("textbox", { name: "Anything else?" }),
            "a projector{Enter}",
        );

        await expect.element(screen.getByRole("textbox", { name: "Display name" })).toBeVisible();
        expect(requestsBy("PATCH")).toEqual([]);
        expect(requestsBy("POST")).toEqual([]);
    });
});
