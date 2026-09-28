import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition } from "#/queries/edition.ts";
import { deserializeSession } from "#/queries/session.ts";
import { SessionDetails } from "#/routes/_user/manage/$editionId/sessions/-components/SessionDetails.tsx";
import { createTestTheme } from "../../../support/theme.ts";

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: vi.fn() }),
}));

const editionId = "edition-1";
const theme = createTestTheme();

const edition = {
    id: editionId,
    name: "Dev Edition",
    sessionFieldOptions: { title: {} },
} as unknown as Edition;

const question = (id: string, title: string, confidential: boolean): CustomField =>
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
        confidential,
        sessionTypes: [],
        tracks: [],
    }) as unknown as CustomField;

const questions = [
    question("field-open", "Equipment", false),
    question("field-confidential", "Accessibility needs", true),
];

/**
 * Deserializes the session the API serves a viewer, with the confidential
 * answer only when they host it.
 */
const sessionAs = (hosting: boolean) => {
    const answers = [
        { id: "answer-open", customFieldId: "field-open", value: "a projector" },
        ...(hosting
            ? [{ id: "answer-confidential", customFieldId: "field-confidential", value: "ramp" }]
            : []),
    ];

    return deserializeSession({
        jsonapi: { version: "1.1" },
        data: {
            type: "session",
            id: "session-1",
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
                responses: { data: answers.map(({ id }) => ({ type: "response", id })) },
            },
            meta: { hostTransitions: [], managerTransitions: [], hosting },
        },
        included: [
            {
                type: "session_type",
                id: "type-talk",
                attributes: {
                    name: "Talk",
                    externalKey: null,
                    defaultDuration: "PT30M",
                    internal: false,
                    selectionDefault: true,
                },
            },
            ...answers.map(({ id, customFieldId, value }) => ({
                type: "response",
                id,
                attributes: { value },
                relationships: {
                    customField: { data: { type: "custom_field", id: customFieldId } },
                },
            })),
        ],
    }).data;
};

type ProvidersProps = {
    children: ReactNode;
};

const mount = async (hosting: boolean) => {
    const factory = createQueryOptionsFactory(vi.fn());
    const Providers = ({ children }: ProvidersProps): ReactNode => (
        <QueryClientProvider client={new QueryClient()}>
            <QueryOptionsFactoryProvider factory={factory}>
                <ThemeProvider theme={theme}>
                    <CssBaseline />
                    <LocaleProvider>{children}</LocaleProvider>
                </ThemeProvider>
            </QueryOptionsFactoryProvider>
        </QueryClientProvider>
    );

    return render(
        <SessionDetails
            session={sessionAs(hosting)}
            edition={edition}
            specs={{ title: { label: "Title", forceRequired: true, type: "string" } }}
            fieldNames={["title"]}
            customFields={questions}
        />,
        { wrapper: Providers },
    );
};

describe("reading a session below manager", () => {
    it("leaves out a confidential question for someone who does not host it", async () => {
        const screen = await mount(false);

        await expect.element(screen.getByText("a projector")).toBeVisible();
        await expect.element(screen.getByText("Accessibility needs")).not.toBeInTheDocument();
    });

    it("shows a confidential answer to a host of the session", async () => {
        const screen = await mount(true);

        await expect.element(screen.getByText("ramp")).toBeVisible();
    });
});
