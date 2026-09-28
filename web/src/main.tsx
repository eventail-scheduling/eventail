import { ErrorCard } from "#/components/ErrorCard.js";
import { FullPageSpinner } from "#/components/FullPageSpinner.js";
import { MultiProvider } from "#/components/MultiProvider.js";
import { NotFoundCard } from "#/components/NotFoundCard.js";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { OidcClient, OidcProvider, OidcSecure, useOidcFetch } from "@axa-fr/react-oidc";
import { JsonApiError } from "@jsonapi-serde/client";
import { CssBaseline, createTheme } from "@mui/material";
import { type ComponentsVariants, type Theme, ThemeProvider } from "@mui/material/styles";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ConfirmProvider } from "material-ui-confirm";
import { SnackbarProvider } from "notistack";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod/mini";
import { LocaleProvider } from "#/components/LocaleProvider/index.js";
import {
    AuthenticateError,
    CallbackSuccess,
    callbackPath,
    LoggedOutElsewhere,
} from "#/components/Oidc/index.js";
import {
    createQueryOptionsFactory,
    type QueryOptionsFactory,
    QueryOptionsFactoryProvider,
} from "#/queries";
import { routeTree } from "#/routeTree.gen.js";
import { extendedReplaceEqualDeep } from "#/utils/api.js";
import { runtimeEnvProblems } from "#/utils/runtime-env.js";
import { takeSignInResumePath } from "#/utils/sign-in-resume.js";

z.config(z.locales.en());

const container = document.getElementById("root");

if (!container) {
    throw new Error("Root element missing");
}

const configurationProblems = runtimeEnvProblems();

if (configurationProblems.length > 0) {
    const listed = configurationProblems.join(", ");
    // Whoever sees this is an operator looking at a deployment, so the message
    // goes on the page rather than into a console trace. The throw is what
    // keeps it there: it stops this module, and the render below would
    // otherwise replace it with the app.
    container.textContent = `This deployment is not configured: ${listed}.`;
    throw new Error(`Runtime configuration incomplete: ${listed}`);
}

const signInResumePath = takeSignInResumePath();

const returnToLogin = () => {
    const oidc = OidcClient.get();

    if (!oidc) {
        return;
    }

    void oidc.loginAsync(`${window.location.pathname}${window.location.search}`);
};

const isUnauthorized = (error: unknown): boolean =>
    error instanceof JsonApiError && error.status === 401;

// A write or a read the page catches itself would otherwise only report a
// 401, and a revoked token or a rotated key would fail every save that follows.
// A read that already holds data stays put: a background refetch leaving for
// the provider would take whatever was being typed with it. So does a read
// nothing renders, such as a hover preload; a navigation's own loader failing
// reaches the error card, which signs in again.
const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (error, query) => {
            if (
                isUnauthorized(error) &&
                query.state.data === undefined &&
                query.getObserversCount() > 0
            ) {
                returnToLogin();
            }
        },
    }),
    mutationCache: new MutationCache({
        onError: (error) => {
            if (isUnauthorized(error)) {
                returnToLogin();
            }
        },
    }),
    defaultOptions: {
        queries: {
            structuralSharing: extendedReplaceEqualDeep,
            retry: false,
        },
    },
});

const root = createRoot(container);

const router = createRouter({
    routeTree,
    defaultPendingComponent: FullPageSpinner,
    defaultErrorComponent: ErrorCard,
    defaultNotFoundComponent: NotFoundCard,
    context: {
        queryClient,
        // Injected through React
        qof: undefined as unknown as QueryOptionsFactory,
    },
    defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

const App = (): ReactNode => {
    const { fetch } = useOidcFetch();
    const queryOptionsFactory = createQueryOptionsFactory(fetch);

    return (
        <QueryOptionsFactoryProvider factory={queryOptionsFactory}>
            <RouterProvider
                router={router}
                context={{
                    qof: queryOptionsFactory,
                }}
            />
        </QueryOptionsFactoryProvider>
    );
};

const alertSeverities = ["error", "info", "success", "warning"] as const;

type AlertVariant = NonNullable<ComponentsVariants<Theme>["MuiAlert"]>[number];

const theme = createTheme({
    cssVariables: {
        colorSchemeSelector: "class",
    },
    colorSchemes: {
        light: true,
        dark: true,
    },
    components: {
        MuiStack: {
            defaultProps: {
                useFlexGap: true,
            },
        },
        MuiAlert: {
            variants: [
                {
                    props: { variant: "standard" },
                    style: { border: "1px solid transparent" },
                },
                ...alertSeverities.map(
                    (severity): AlertVariant => ({
                        props: { variant: "standard", severity },
                        // Material UI derives the dark tint by darkening the severity
                        // color, which lands below the page background and leaves the
                        // alert reading as a hole rather than a surface.
                        style: ({ theme }) =>
                            theme.applyStyles("dark", {
                                backgroundColor: `rgba(${theme.vars.palette[severity].lightChannel} / 0.14)`,
                                borderColor: `rgba(${theme.vars.palette[severity].lightChannel} / 0.3)`,
                            }),
                    }),
                ),
            ],
        },
    },
});

root.render(
    <StrictMode>
        <MultiProvider
            providerCreators={[
                (children) => (
                    <ThemeProvider theme={theme} defaultMode="system">
                        <CssBaseline />
                        {children}
                    </ThemeProvider>
                ),
                (children) => (
                    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                ),
                (children) => (
                    <OidcProvider
                        configuration={{
                            client_id: window.RUNTIME_ENV.OIDC_CLIENT_ID,
                            redirect_uri: `${window.location.origin}${callbackPath}`,
                            scope: `openid offline_access ${window.RUNTIME_ENV.OIDC_SCOPES}`,
                            authority: window.RUNTIME_ENV.OIDC_AUTHORITY,
                            // Absent rather than empty where nothing was
                            // configured, since an empty audience is a claim
                            // about the deployment that nobody made.
                            ...(window.RUNTIME_ENV.OIDC_AUDIENCE === ""
                                ? {}
                                : {
                                      token_request_extras: {
                                          audience: window.RUNTIME_ENV.OIDC_AUDIENCE,
                                      },
                                  }),
                            storage: window.localStorage,
                        }}
                        loadingComponent={FullPageSpinner}
                        authenticatingErrorComponent={AuthenticateError}
                        callbackSuccessComponent={CallbackSuccess}
                        sessionLostComponent={LoggedOutElsewhere}
                        onSessionLost={returnToLogin}
                        authenticatingComponent={FullPageSpinner}
                    >
                        {children}
                    </OidcProvider>
                ),
                (children) => <OidcSecure callbackPath={signInResumePath}>{children}</OidcSecure>,
                (children) => <SnackbarProvider>{children}</SnackbarProvider>,
                (children) => <ConfirmProvider>{children}</ConfirmProvider>,
                (children) => <LocaleProvider>{children}</LocaleProvider>,
            ]}
        >
            <App />
        </MultiProvider>
    </StrictMode>,
);
