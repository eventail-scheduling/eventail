/**
 * Entry for --test-global-setup, which runs in the coordinator process.
 *
 * The coordinator skips --import preloads (they only run in test workers), so
 * tsx's loader is never registered there and TypeScript modules cannot be
 * loaded directly. This plain-JS shim registers tsx manually and defers to the
 * TypeScript implementation.
 */

import { register } from "tsx/esm/api";

register();

const { globalSetup, globalTeardown } = await import("./db-setup.ts");

export { globalSetup, globalTeardown };
