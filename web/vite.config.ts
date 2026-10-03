import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import favicons from "vite-plugin-hashed-favicons";
import { defineConfig } from "vite";
import TanStackRouterVite from "@tanstack/router-plugin/vite";

const isInPackage = (path: string, name: string): boolean =>
    name.endsWith("/*")
        ? path.includes(`/node_modules/${name.slice(0, -1)}`)
        : path.includes(`/node_modules/${name}/`);

/**
 * Builds a code splitting group test from package names.
 *
 * A trailing "/*" takes a whole scope, and a leading "!" leaves a package out of the others.
 */
const packages = (...names: string[]): ((id: string) => boolean) => {
    const excluded = names.filter((name) => name.startsWith("!")).map((name) => name.slice(1));
    const included = names.filter((name) => !name.startsWith("!"));

    return (id) => {
        const path = id.replaceAll("\\", "/");

        return (
            included.some((name) => isInPackage(path, name)) &&
            !excluded.some((name) => isInPackage(path, name))
        );
    };
};

export default defineConfig({
    plugins: [
        TanStackRouterVite({
            target: "react",
            // Off under Vitest: tests render a route's component directly, and
            // when split, that component is a lazy wrapper that suspends while
            // its chunk loads, which React's development build warns about.
            autoCodeSplitting: process.env.VITEST !== "true",
            routeFileIgnorePrefix: "-",
            quoteStyle: "double",
            semicolons: true,
            customScaffolding: {
                routeTemplate: [
                    "%%tsrImports%%\n",
                    `import type { ReactNode } from "react";\n`,
                    "\n",
                    "const Root = (): ReactNode => {\n",
                    '    return <div>Hello "%%tsrPath%%"!</div>\n',
                    "};\n",
                    "\n",
                    "%%tsrExportStart%%{\n    component: Root,\n }%%tsrExportEnd%%\n",
                ].join(""),
            },
        }),
        react(),
        visualizer(),
        favicons("./src/assets/favicon.svg"),
    ],
    resolve: {
        tsconfigPaths: true,
    },
    build: {
        // Shipped and served, so a production stack trace names the original
        // source. The code is public anyway, and the maps roughly triple the
        // served asset payload, which is the price of readable traces.
        sourcemap: true,
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        { name: "react", priority: 30, test: packages("react", "react-dom") },
                        // Outranks the pickers, because a group also takes in the
                        // dependencies of what it matches, and the pickers depend
                        // on most of MUI.
                        {
                            name: "mui",
                            priority: 25,
                            test: packages(
                                "@mui/*",
                                "!@mui/x-date-pickers",
                                "@emotion/*",
                                "material-ui-popup-state",
                                "material-ui-confirm",
                            ),
                        },
                        {
                            name: "pickers",
                            priority: 20,
                            test: packages("@mui/x-date-pickers", "mui-temporal-pickers"),
                        },
                        { name: "zod", priority: 20, test: packages("zod", "zod-temporal") },
                        { name: "base-ui", priority: 10, test: packages("@base-ui/*") },
                        { name: "notistack", priority: 10, test: packages("notistack") },
                        {
                            name: "drag-and-drop",
                            priority: 10,
                            test: packages(
                                "@atlaskit/pragmatic-drag-and-drop",
                                "@atlaskit/pragmatic-drag-and-drop-auto-scroll",
                                "@atlaskit/pragmatic-drag-and-drop-hitbox",
                                "@atlaskit/pragmatic-drag-and-drop-live-region",
                            ),
                        },
                        {
                            name: "query",
                            priority: 10,
                            test: packages(
                                "@tanstack/react-query",
                                "@tanstack/query-core",
                                "@jsonapi-serde/*",
                            ),
                        },
                        {
                            name: "form",
                            priority: 10,
                            test: packages("react-hook-form", "@hookform/*", "mui-rhf-integration"),
                        },
                        { name: "temporal", priority: 10, test: packages("temporal-polyfill") },
                    ],
                },
            },
        },
    },
    // Imported only from a web worker, which the dependency scan does not
    // follow. Found mid-run instead, it re-optimizes and reloads: in dev that
    // lands under the first file someone picks, and under Vitest it reloads the
    // test frames, so whichever test file was starting never initializes.
    optimizeDeps: {
        include: ["hash-wasm"],
    },
    server: {
        port: 12000,
    },
});
