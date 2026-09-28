import { JsonApiError } from "@jsonapi-serde/client";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
    extendedReplaceEqualDeep,
    flagStaleForm,
    getErrorMessage,
    hasErrorCode,
    refreshStaleForm,
    reportingErrors,
    StaleFormError,
} from "#/utils/api.ts";

const { enqueueSnackbar } = vi.hoisted(() => ({ enqueueSnackbar: vi.fn() }));

vi.mock("notistack", () => ({ enqueueSnackbar }));

const refusal = (...codes: (string | undefined)[]): JsonApiError =>
    new JsonApiError(
        "Unprocessable entity",
        422,
        codes.map((code) => ({ code, title: "Something" })),
    );

describe("hasErrorCode", () => {
    it("finds the code on the only error", () => {
        expect(hasErrorCode(refusal("outside_edition"), "outside_edition")).toBe(true);
    });

    it("finds it among several", () => {
        expect(
            hasErrorCode(refusal("reversed_interval", "outside_edition"), "outside_edition"),
        ).toBe(true);
    });

    it("says no when every code is a different one", () => {
        expect(hasErrorCode(refusal("reversed_interval"), "outside_edition")).toBe(false);
    });

    it("says no when the errors carry no code at all", () => {
        expect(hasErrorCode(refusal(undefined), "outside_edition")).toBe(false);
    });

    it("says no for a document with no errors in it", () => {
        expect(hasErrorCode(refusal(), "outside_edition")).toBe(false);
    });

    // A network failure or a bug reaches the same handler as a refusal does.
    it("says no for anything that is not a refusal", () => {
        expect(hasErrorCode(new Error("offline"), "outside_edition")).toBe(false);
        expect(hasErrorCode(undefined, "outside_edition")).toBe(false);
        expect(hasErrorCode(null, "outside_edition")).toBe(false);
    });
});

describe("extendedReplaceEqualDeep", () => {
    it("keeps the old object when nothing changed", () => {
        const oldData = { title: { position: 0 }, abstract: { position: 1 } };
        const newData = { title: { position: 0 }, abstract: { position: 1 } };

        expect(extendedReplaceEqualDeep(oldData, newData)).toBe(oldData);
    });

    it("keeps untouched branches when a sibling changed", () => {
        const oldData = { title: { position: 0 }, abstract: { position: 1 } };
        const newData = { title: { position: 0 }, abstract: { position: 2 } };

        const result = extendedReplaceEqualDeep(oldData, newData) as typeof oldData;

        expect(result).not.toBe(oldData);
        expect(result.title).toBe(oldData.title);
        expect(result.abstract).toEqual({ position: 2 });
    });

    it("carries a key the old object did not have", () => {
        const oldData = { title: { position: 0 } };
        const newData = { title: { position: 0 }, setupTime: { position: 1 } };

        expect(extendedReplaceEqualDeep(oldData, newData)).toEqual(newData);
    });

    it("drops a key the new object no longer has", () => {
        const oldData = { title: { position: 0 }, setupTime: { position: 1 } };
        const newData = { title: { position: 0 } };

        expect(extendedReplaceEqualDeep(oldData, newData)).toEqual(newData);
    });

    it("swaps a key for another of the same count", () => {
        const oldData = { title: { position: 0 }, setupTime: { position: 1 } };
        const newData = { title: { position: 0 }, teardownTime: { position: 1 } };

        expect(extendedReplaceEqualDeep(oldData, newData)).toEqual(newData);
    });

    it("keeps the old array when its items are unchanged", () => {
        const oldData = [{ id: "a" }, { id: "b" }];
        const newData = [{ id: "a" }, { id: "b" }];

        expect(extendedReplaceEqualDeep(oldData, newData)).toBe(oldData);
    });

    it("carries an appended array item", () => {
        const oldData = [{ id: "a" }];
        const newData = [{ id: "a" }, { id: "b" }];

        const result = extendedReplaceEqualDeep(oldData, newData) as typeof newData;

        expect(result).toEqual(newData);
        expect(result[0]).toBe(oldData[0]);
    });

    it("compares Temporal values by value rather than identity", () => {
        const oldData = { at: Temporal.PlainDate.from("2026-08-18") };
        const newData = { at: Temporal.PlainDate.from("2026-08-18") };

        expect(extendedReplaceEqualDeep(oldData, newData)).toBe(oldData);
    });
});

describe("flagStaleForm", () => {
    const caught = (error: unknown): unknown => {
        try {
            flagStaleForm(error);
        } catch (thrown) {
            return thrown;
        }

        return undefined;
    };

    it.each([
        "unknown_custom_field",
        "unknown_response",
        "inapplicable_response",
        "frozen_response",
        "missing_responses",
        "incomplete_profile",
        "availability_not_asked",
        "session_fields_changed",
    ])("turns a %s refusal into a stale form", (code) => {
        expect(caught(refusal(code))).toBeInstanceOf(StaleFormError);
    });

    it("passes a not_found refusal through untouched", () => {
        const refused = refusal("not_found");

        expect(caught(refused)).toBe(refused);
    });

    it("records a refresh whose refetch failed as not refreshed", async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        let failing = false;
        const observer = new QueryObserver(client, {
            queryKey: ["customFields", "edition-1"],
            queryFn: async () => {
                if (failing) {
                    throw new Error("unavailable");
                }

                return [];
            },
        });
        const unsubscribe = observer.subscribe(() => undefined);

        try {
            await vi.waitFor(() => {
                expect(observer.getCurrentResult().isSuccess).toBe(true);
            });
            const flagged = caught(refusal("unknown_response")) as StaleFormError;

            await refreshStaleForm(client, flagged, [["customFields", "edition-1"]]);
            expect(flagged.refreshed).toBe(true);

            failing = true;
            flagged.refreshed = false;
            await refreshStaleForm(client, flagged, [["customFields", "edition-1"]]);
            expect(flagged.refreshed).toBe(false);
        } finally {
            unsubscribe();
        }
    });

    it("records a refresh held back offline as not refreshed", async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const observer = new QueryObserver(client, {
            queryKey: ["customFields", "edition-1"],
            queryFn: async () => [],
        });
        const unsubscribe = observer.subscribe(() => undefined);

        try {
            await vi.waitFor(() => {
                expect(observer.getCurrentResult().isSuccess).toBe(true);
            });
            onlineManager.setOnline(false);
            const flagged = caught(refusal("unknown_response")) as StaleFormError;

            await refreshStaleForm(client, flagged, [["customFields", "edition-1"]]);

            expect(flagged.refreshed).toBe(false);
        } finally {
            onlineManager.setOnline(true);
            unsubscribe();
        }
    });

    it("promises a refreshed form only once the refresh has landed", () => {
        const flagged = caught(refusal("unknown_response")) as StaleFormError;

        expect(getErrorMessage(flagged)).toBe(
            "This form is out of date and could not be refreshed. Try saving again in a moment.",
        );

        flagged.refreshed = true;

        expect(getErrorMessage(flagged)).toBe(
            "This form was out of date and has been refreshed. Check your answers and save again.",
        );
    });

    it("passes a refusal of what the user typed through untouched", () => {
        const refused = refusal("invalid_responses");

        expect(caught(refused)).toBe(refused);
    });
});

describe("reportingErrors", () => {
    it("reports what a submit handler throws rather than letting it escape", async () => {
        enqueueSnackbar.mockReset();
        const submit = reportingErrors(() => {
            throw new Error("A stored file cannot be sent back");
        });

        await expect(submit()).resolves.toBeUndefined();
        expect(enqueueSnackbar).toHaveBeenCalledWith("An unknown error occurred", {
            variant: "error",
        });
    });

    it("reports what an async submit handler rejects with", async () => {
        enqueueSnackbar.mockReset();
        const submit = reportingErrors(async () => {
            await Promise.resolve();
            throw new Error("A stored file cannot be sent back");
        });

        await expect(submit()).resolves.toBeUndefined();
        expect(enqueueSnackbar).toHaveBeenCalledOnce();
    });
});
