import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";
import type { EditionDocument } from "#/queries/edition.ts";
import { deserializeOwnHost } from "#/queries/host.ts";
import type { CurrentUser } from "#/queries/user.ts";
import { CompleteHostProfile } from "#/routes/_user/-components/CompleteHostProfile.tsx";
import { mouse } from "../support/browser-input.ts";
import { answered } from "../support/json-api.ts";
import { createTestTheme } from "../support/theme.ts";
import { userWithRole } from "../support/users.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

// The form's leave guard needs a router, which these tests render without.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
    ...(await importOriginal()),
    useBlocker: (() => undefined) as never,
}));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const editionId = "edition-1";
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
    sessionFieldSpecs: {},
    profileFieldSpecs: {
        displayName: { label: "Display name", forceRequired: true, type: "string" },
        emailAddress: { label: "Email address", forceRequired: true, type: "string" },
    },
    uploadLimits: { maxFileSize: 1, fileContentTypes: [], imageContentTypes: [] },
} as unknown as EditionDocument;

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

const hostQuestion = (id: string, title: string, frozen: boolean): CustomField =>
    ({
        id,
        externalKey: null,
        target: "per_host",
        requirement: "always_optional",
        title,
        helperText: "",
        options: { type: "single_line_text" },
        answerMaxLength: 200,
        deadline: null,
        freezeAfter: frozen ? Temporal.Now.instant().subtract({ hours: 1 }) : null,
        sessionTypes: [],
        tracks: [],
    }) as unknown as CustomField;

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

type ProvidersProps = {
    children: ReactNode;
};

type MountOptions = {
    edition?: EditionDocument;
    host?: ReturnType<typeof hostDocument>;
    user?: CurrentUser;
    customFields?: CustomField[];
    answers?: StoredAnswer[];
    client?: QueryClient;
};

const mount = async ({
    edition = editionDocument,
    host,
    user = userWithRole(null),
    customFields = [],
    answers = [],
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
}: MountOptions = {}) => {
    client.setQueryData(["edition", editionId], edition);
    client.setQueryData(["customFields", editionId], customFields);
    client.setQueryData(["current-user"], user);
    client.setQueryData(
        ["me", "host", editionId],
        deserializeOwnHost(host ?? hostDocument("Dev Speaker", answers)).data,
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

    return render(
        <CompleteHostProfile editionId={editionId} isAccepting={false} onSaved={() => undefined} />,
        { wrapper: Providers },
    );
};

beforeEach(() => {
    sent.mockReset();
    window.localStorage.setItem("preferredLocale", "en-US");
});

describe("completing a host profile before accepting", () => {
    // With no custom fields in this fixture, the form reads neither isDirty nor
    // dirtyFields while rendering, so RHF's dirtyFields stays empty in its
    // handler and cannot be what decides the body.
    it("sends the display name it changed", async () => {
        sent.mockImplementation(async () => answered(hostDocument("Stage Name")));
        const screen = await mount();

        const input = screen.getByRole("textbox", { name: "Display name" });
        await userEvent.clear(input);
        await userEvent.type(input, "Stage Name");
        await screen.getByRole("button", { name: "Save and accept" }).click();
        await expect
            .poll(() => sent.mock.calls.filter(([, request]) => request?.method === "PATCH").length)
            .toEqual(1);

        const [, request] = sent.mock.calls.find(([, init]) => init?.method === "PATCH") as [
            URL,
            RequestInit,
        ];

        expect(JSON.parse(request.body as string)).toEqual({
            data: { type: "host", attributes: { displayName: "Stage Name" } },
            included: [],
        });
    });

    // Fields stay editable while a save is out. The stored name differs from
    // the one sent, so only a rebase measured from the values sent keeps both.
    it("keeps what was typed while the save was out", async () => {
        const { promise: patched, resolve: answerPatch } = Promise.withResolvers<Response>();
        sent.mockReturnValueOnce(patched).mockImplementation(async () =>
            answered(hostDocument("Stage Name (stored)")),
        );
        const screen = await mount();
        const displayName = screen.getByRole("textbox", { name: "Display name" });
        const emailAddress = screen.getByRole("textbox", { name: "Email address" });

        await userEvent.clear(displayName);
        await userEvent.type(displayName, "Stage Name");
        await screen.getByRole("button", { name: "Save and accept" }).click();
        await expect.poll(() => sent.mock.calls.length).toEqual(1);
        await userEvent.clear(emailAddress);
        await userEvent.type(emailAddress, "stage@example.test");

        answerPatch(answered(hostDocument("Stage Name (stored)")));

        await expect.element(displayName).toHaveValue("Stage Name (stored)");
        await expect.element(emailAddress).toHaveValue("stage@example.test");
    });

    describe("with a question frozen since it was answered", () => {
        const questions = [
            hostQuestion("field-open", "Pronouns", false),
            hostQuestion("field-frozen", "T-shirt size", true),
        ];
        const answers = [
            { id: "answer-open", customFieldId: "field-open", value: "they/them" },
            { id: "answer-frozen", customFieldId: "field-frozen", value: "M" },
        ];

        const pronounsSent = {
            type: "response",
            lid: "field-open",
            attributes: { value: "she/her" },
            relationships: { customField: { data: { type: "custom_field", id: "field-open" } } },
        };

        const saveChangedPronouns = async (user: CurrentUser): Promise<unknown> => {
            sent.mockImplementation(async () => answered(hostDocument("Dev Speaker", answers)));
            const screen = await mount({ user, customFields: questions, answers });

            const input = screen.getByRole("textbox", { name: "Pronouns" });
            await userEvent.clear(input);
            await userEvent.type(input, "she/her");
            await screen.getByRole("button", { name: "Save and accept" }).click();
            await expect
                .poll(() => sent.mock.calls.filter(([, init]) => init?.method === "PATCH").length)
                .toEqual(1);
            const [, request] = sent.mock.calls.find(([, init]) => init?.method === "PATCH") as [
                URL,
                RequestInit,
            ];

            return JSON.parse(request.body as string);
        };

        // An organizer reopens a question by moving its freeze later or
        // clearing it; this test clears it.
        it("shows the stored answer when the question unfreezes", async () => {
            const client = new QueryClient();
            const screen = await mount({ customFields: questions, answers, client });

            await expect
                .element(screen.getByRole("textbox", { name: "T-shirt size" }))
                .not.toBeInTheDocument();

            client.setQueryData(
                ["customFields", editionId],
                [questions[0], hostQuestion("field-frozen", "T-shirt size", false)],
            );

            await expect
                .element(screen.getByRole("textbox", { name: "T-shirt size" }))
                .toHaveValue("M");
        });

        it.each([
            ["a host", null],
            ["a manager", "manager"],
        ] as const)("keeps the frozen answer by its id for %s", async (_label, role) => {
            expect(await saveChangedPronouns(userWithRole(role))).toEqual({
                data: {
                    type: "host",
                    attributes: {},
                    relationships: {
                        responses: {
                            data: [
                                { type: "response", lid: "field-open" },
                                { type: "response", id: "answer-frozen" },
                            ],
                        },
                    },
                },
                included: [pronounsSent],
            });
        });
    });

    // Moving an edition re-anchors stored availability a day on. The form's
    // copy, drawn against the old days, falls outside the new ones, and any
    // gesture on the grid would write it back over the settled set.
    it("takes the settled availability when the edition moves under the form", async () => {
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const settled = hostAvailableFrom("2026-11-22T08:00:00Z", "2026-11-22T16:00:00Z");
        sent.mockImplementation(async () => answered(settled));
        const screen = await mount({
            client,
            edition: availabilityEdition("2026-11-21", "2026-11-23"),
            host: hostAvailableFrom("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z"),
        });
        const blocks = () =>
            screen.container.querySelectorAll('[data-testid="availability-block"]').length;
        await expect.poll(blocks).toBe(1);

        client.setQueryData(
            ["edition", editionId],
            availabilityEdition("2026-11-22", "2026-11-24"),
        );

        await expect
            .element(screen.getByText(/The availability shown is what it settled to/))
            .toBeVisible();
        await expect.poll(blocks).toBe(1);

        const displayName = screen.getByRole("textbox", { name: "Display name" });
        await userEvent.clear(displayName);
        await userEvent.type(displayName, "Stage Name");
        await screen.getByRole("button", { name: "Save and accept" }).click();
        await expect
            .poll(() => sent.mock.calls.filter(([, request]) => request?.method === "PATCH").length)
            .toEqual(1);

        const [, request] = sent.mock.calls.find(([, init]) => init?.method === "PATCH") as [
            URL,
            RequestInit,
        ];

        // Settled is the new baseline, so an untouched grid sends nothing.
        expect(request.body as string).not.toContain("availabilit");
    });

    // Drawn rather than stored: a stored block on the dropped day would change
    // the settled set and reseed on that alone, so only an unsaved one reaches
    // the check on what the form holds.
    it("clears a block drawn on a day the edition then drops", async () => {
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        sent.mockImplementation(async () => answered(hostDocument("Dev Speaker")));
        const screen = await mount({
            client,
            edition: availabilityEdition("2026-11-21", "2026-11-23"),
        });
        const lastDay = screen.container.querySelector<HTMLElement>(
            '[data-testid="availability-day-2"]',
        );
        const scroller = screen.container.querySelector<HTMLElement>(
            '[data-testid="availability-scroller"]',
        );

        if (!(lastDay && scroller)) {
            throw new Error("no grid");
        }

        lastDay.scrollIntoView({ block: "center", inline: "center" });
        const column = lastDay.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        const slot = {
            x: column.left + column.width / 2,
            y:
                (Math.max(column.top, view.top, 0) +
                    Math.min(column.bottom, view.bottom, window.innerHeight)) /
                2,
        };
        const input = mouse();
        await input.down(slot);
        await input.up(slot);
        await expect
            .element(screen.getByText(/You are available only at the times drawn below/))
            .toBeVisible();

        client.setQueryData(
            ["edition", editionId],
            availabilityEdition("2026-11-21", "2026-11-22"),
        );

        await expect
            .element(screen.getByText(/The availability shown is what it settled to/))
            .toBeVisible();
        await expect
            .element(screen.getByText(/You are available at any time during the edition/))
            .toBeVisible();
    });

    it("does not reseed availability when a later end date settles nothing", async () => {
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const stored = hostAvailableFrom("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z");
        sent.mockImplementation(async () => answered(stored));
        const screen = await mount({
            client,
            edition: availabilityEdition("2026-11-21", "2026-11-23"),
            host: stored,
        });

        client.setQueryData(
            ["edition", editionId],
            availabilityEdition("2026-11-21", "2026-11-24"),
        );

        await expect
            .poll(() => sent.mock.calls.some(([url]) => String(url).includes("/me/host")))
            .toBe(true);
        await expect
            .poll(() => client.getQueryState(["me", "host", editionId])?.fetchStatus)
            .toBe("idle");
        // The reseed runs in the fetch's continuation, a turn after the cache settles.
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(
            screen.getByText(/The edition's dates changed while this was open/).query(),
        ).toBeNull();
    });

    // The page holds its edition, so without this every retry is judged
    // against the old days and refused the same way. Reread and unmoved, the
    // refusal is the API's own to report.
    it("rereads a held edition when a save lands outside its days", async () => {
        sent.mockImplementation(async (_url: URL, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                return new Response(
                    JSON.stringify({
                        errors: [
                            {
                                status: "422",
                                code: "outside_edition",
                                title: "Outside",
                                detail: "An availability has to lie within the days of the edition",
                            },
                        ],
                    }),
                    { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
                );
            }

            return answered({
                jsonapi: { version: "1.1" },
                data: {
                    type: "edition",
                    id: editionId,
                    attributes: {
                        name: "Dev Edition",
                        startDate: "2026-11-21",
                        endDate: "2026-11-23",
                        submissionDeadline: null,
                        timeZone: "Europe/Berlin",
                        sessionFieldOptions: { title: {} },
                        profileFieldOptions: {},
                    },
                    meta: { version: 1 },
                },
                meta: {
                    sessionFieldSpecs: {},
                    profileFieldSpecs: editionDocument.profileFieldSpecs,
                    maxFileSize: 1,
                    fileContentTypes: [],
                    imageContentTypes: [],
                },
            });
        });
        const screen = await mount();

        await screen.getByRole("button", { name: "Save and accept" }).click();

        await expect
            .element(screen.getByText("An availability has to lie within the days of the edition"))
            .toBeVisible();
        expect(
            sent.mock.calls.some(
                ([url, init]) =>
                    String(url).endsWith(`/editions/${editionId}`) &&
                    (init?.method ?? "GET") === "GET",
            ),
        ).toBe(true);
    });
});
