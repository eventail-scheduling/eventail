/**
 * Counts the responses the contract layer checked, across every worker.
 *
 * Imports nothing but node builtins on purpose: worker-db.ts loads this before
 * it registers the loader hook that provisions the worker database, so pulling
 * in openapi-contract.js here would drag the route tree and the ORM module in
 * ahead of that hook and leave every test sharing an untruncated database.
 *
 * node:test runs every test file in its own process, so each worker drops its
 * own total in a directory the global teardown sums. The directory name is
 * fixed, so two runs sharing a TMPDIR would corrupt each other's counts, which
 * db-setup.ts already rules out for the databases.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let checkedResponses = 0;

export const recordCheckedResponse = (): void => {
    checkedResponses += 1;
};

const tallyDirectory = join(tmpdir(), "eventail-contract-tally");

/**
 * The count below which the run is treated as not having checked anything.
 *
 * Measured at 471 on 2026-09-24. Set well under that so ordinary additions and
 * removals of tests never trip it, while a layer that resolves no operation at
 * all does.
 */
export const minimumCheckedResponses = 300;

/**
 * Says whether this run covers enough of the suite for the floor to mean anything.
 *
 * A run narrowed to one file or one name legitimately checks a handful of
 * responses, so the floor would fail it every time. Set CONTRACT_FLOOR=off for
 * those.
 */
export const contractFloorApplies = (): boolean => process.env.CONTRACT_FLOOR !== "off";

export const resetTally = (): void => {
    rmSync(tallyDirectory, { recursive: true, force: true });
    mkdirSync(tallyDirectory, { recursive: true });
};

export const writeWorkerTally = (): void => {
    // The preload runs without the global setup when a worker is launched on
    // its own, so the directory cannot be assumed to exist.
    mkdirSync(tallyDirectory, { recursive: true });
    writeFileSync(join(tallyDirectory, `${process.pid}`), String(checkedResponses));
};

export const readTally = (): number =>
    readdirSync(tallyDirectory)
        .map((name) => {
            const count = Number(readFileSync(join(tallyDirectory, name), "utf8"));

            if (!Number.isSafeInteger(count)) {
                throw new Error(`Contract tally ${name} does not hold a count`);
            }

            return count;
        })
        .reduce((total, count) => total + count, 0);

export const clearTally = (): void => {
    rmSync(tallyDirectory, { recursive: true, force: true });
};
