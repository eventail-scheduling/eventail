import { describe, expect, it } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useFreezeSplit } from "#/hooks/useFreezeSplit.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import { syncServerClock } from "#/utils/server-clock.ts";

describe("useFreezeSplit", () => {
    it("moves a question over when a new reading puts its freeze in the past", async () => {
        const freezeAfter = Temporal.Now.instant().add({ hours: 1 });
        const question = { id: "field-diet", freezeAfter } as unknown as CustomField;
        const { result, act } = await renderHook(() => useFreezeSplit([question]));

        expect(result.current.open).toEqual([question]);

        await act(() => {
            syncServerClock(freezeAfter.add({ minutes: 1 }), performance.now(), performance.now());
        });

        expect(result.current.frozen).toEqual([question]);
    });
});
