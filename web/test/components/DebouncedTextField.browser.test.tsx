import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DebouncedTextField } from "#/components/DebouncedTextField.tsx";

// Long enough that a land always beats the debounce: typing through the
// browser driver takes longer than a realistic delay would allow.
const DELAY_MS = 800;

const LAND_MS = 500;

/**
 * Stands in for a list route, whose committed search param the box reads back.
 *
 * The router publishes that param only once the navigation commits, which is
 * after the loader has fetched, so the probe lands it a moment after each
 * commit. `onCommit` is inline on purpose: both real call sites pass one, so a
 * fresh identity on every render is the condition the box has to survive.
 */
const Probe = (): ReactNode => {
    const [value, setValue] = useState<string | undefined>(undefined);
    const [commits, setCommits] = useState<string[]>([]);

    return (
        <>
            <DebouncedTextField
                label="Search"
                delay={DELAY_MS}
                value={value}
                onCommit={(next) => {
                    setCommits((all) => [...all, next ?? "(none)"]);
                    // The navigation, which publishes the param only once the
                    // loader has answered. On a timer rather than a click: a
                    // click would blur the box, and blur commits by its own
                    // path, which hides whether the queued one survived.
                    setTimeout(() => setValue(next), LAND_MS);
                }}
            />
            <button type="button" onClick={() => setValue("zz")}>
                land zz
            </button>
            <output>{commits.join(",")}</output>
        </>
    );
};

const mount = async () => {
    const screen = await render(<Probe />);
    const box = screen.getByRole("textbox");

    return {
        box,
        type: async (text: string) => {
            await userEvent.click(box);
            await userEvent.fill(box, text);
        },
        land: (what: string) =>
            userEvent.click(screen.getByRole("button", { name: `land ${what}` })),
        committed: () => screen.getByRole("status").element().textContent,
        typed: () => box.element().getAttribute("value"),
    };
};

describe("a search box committing on its own", () => {
    // Rebuilding the debounce whenever the parent re-renders with a fresh
    // callback would clear what was queued. A commit landing is exactly such a
    // re-render, so the characters typed while it traveled would never be
    // committed.
    it("still commits what was typed while the last commit was landing", async () => {
        const { type, committed } = await mount();

        await type("ab");
        await expect.poll(committed, { timeout: 4000 }).toEqual("ab");

        await type("abc");

        await expect.poll(committed, { timeout: 4000 }).toEqual("ab,abc");
    });

    it("keeps what is being typed when its own earlier commit lands", async () => {
        const { type, committed, typed } = await mount();

        await type("ab");
        await expect.poll(committed, { timeout: 4000 }).toEqual("ab");

        await type("abc");

        await expect.poll(typed, { timeout: 4000 }).toEqual("abc");
        await expect.poll(committed, { timeout: 4000 }).toEqual("ab,abc");
    });

    // Two in flight at once, landing oldest first, which is the order the
    // router commits them in.
    it("keeps what is being typed until the newest of its commits lands", async () => {
        const { type, committed, typed } = await mount();

        await type("ab");
        await expect.poll(committed, { timeout: 4000 }).toEqual("ab");
        await type("abc");
        await expect.poll(committed, { timeout: 4000 }).toEqual("ab,abc");

        await type("abcd");

        await expect.poll(typed, { timeout: 4000 }).toEqual("abcd");
    });

    it("takes a value it never committed", async () => {
        const { type, land, committed, typed } = await mount();

        await type("ab");
        await expect.poll(committed, { timeout: 4000 }).toEqual("ab");

        await land("zz");

        await expect.poll(typed, { timeout: 4000 }).toEqual("zz");
    });

    it("takes a value it never committed while one of its own is outstanding", async () => {
        const { type, land, typed } = await mount();

        await type("ab");
        await land("zz");

        await expect.poll(typed, { timeout: 4000 }).toEqual("zz");
    });
});
