import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

const browserTests = "test/**/*.browser.test.{ts,tsx}";

// Kept out of vite.config.ts so that `vite build` never imports vitest/config
// or the Playwright provider at all. Vite only probes for vite.config.*, so
// nothing here reaches a build.
export default mergeConfig(
    viteConfig,
    defineConfig({
        // Imported only from a web worker, which the dependency scan does not
        // follow. Found mid-run instead, it makes Vite reload the test frames,
        // and whichever test file was starting then never initializes.
        optimizeDeps: {
            include: ["hash-wasm"],
        },
        test: {
            // Vite resolves tsconfig paths from the nearest tsconfig, whose
            // include covers src alone, so the prefix it maps there does not
            // reach a test file.
            alias: {
                "#/": fileURLToPath(new URL("./src/", import.meta.url)),
            },
            setupFiles: ["test/setup.ts"],
            projects: [
                {
                    extends: true,
                    test: {
                        name: "unit",
                        include: ["test/**/*.test.{ts,tsx}"],
                        exclude: [...configDefaults.exclude, browserTests],
                    },
                },
                {
                    extends: true,
                    test: {
                        name: "browser",
                        include: [browserTests],
                        browser: {
                            enabled: true,
                            headless: true,
                            // Small enough to fit the window headless Chrome
                            // opens, which is what keeps Vitest from scaling
                            // the frame the tests measure themselves against.
                            viewport: { width: 1024, height: 640 },
                            provider: playwright({
                                // The system browser, which spares everyone a
                                // 100 MB download for the default run.
                                launchOptions: { channel: "chrome" },
                            }),
                            // Chromium alone, because the input these tests
                            // drive is CDP and only Chromium speaks it. Firefox
                            // has had rendering bugs of its own here twice, so
                            // to go looking: `playwright install firefox`, drop
                            // the channel above, and swap this for firefox.
                            // Touch cannot follow: Playwright does not emulate
                            // it there.
                            instances: [{ browser: "chromium" }],
                        },
                    },
                },
            ],
        },
    }),
);
