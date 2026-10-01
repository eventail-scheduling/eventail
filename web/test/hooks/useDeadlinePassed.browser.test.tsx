import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useDeadlinePassed } from "#/hooks/useDeadlinePassed.ts";
import { syncServerClock } from "#/utils/server-clock.ts";

type ProbeProps = {
    submissionDeadline: Temporal.Instant | null;
    onRender?: (passed: boolean) => void;
};

const Probe = ({ submissionDeadline, onRender }: ProbeProps): ReactNode => {
    const passed = useDeadlinePassed({ submissionDeadline });
    onRender?.(passed);

    return <output>{passed ? "closed" : "open"}</output>;
};

const anHourAgo = (): Temporal.Instant => Temporal.Now.instant().subtract({ hours: 1 });
const inAnHour = (): Temporal.Instant => Temporal.Now.instant().add({ hours: 1 });

describe("a deadline still ahead", () => {
    // Inside the minute the hook polls every second for, so the wait is a
    // couple of ticks rather than the ten minutes a distant deadline takes.
    it("closes submission on its own once the deadline arrives", async () => {
        const screen = await render(
            <Probe submissionDeadline={Temporal.Now.instant().add({ milliseconds: 1200 })} />,
        );
        await expect.element(screen.getByText("open")).toBeInTheDocument();

        await expect.element(screen.getByText("closed"), { timeout: 5000 }).toBeInTheDocument();
    });

    it("closes submission once an organizer pulls the deadline into the past", async () => {
        const screen = await render(<Probe submissionDeadline={inAnHour()} />);
        await expect.element(screen.getByText("open")).toBeInTheDocument();

        await screen.rerender(<Probe submissionDeadline={anHourAgo()} />);
        await expect.element(screen.getByText("closed")).toBeInTheDocument();
    });
});

describe("a deadline that has already passed", () => {
    it("reopens submission once an organizer extends it", async () => {
        const screen = await render(<Probe submissionDeadline={anHourAgo()} />);
        await expect.element(screen.getByText("closed")).toBeInTheDocument();

        await screen.rerender(<Probe submissionDeadline={inAnHour()} />);
        await expect.element(screen.getByText("open")).toBeInTheDocument();
    });

    it("reopens submission once an organizer removes the deadline", async () => {
        const screen = await render(<Probe submissionDeadline={anHourAgo()} />);
        await expect.element(screen.getByText("closed")).toBeInTheDocument();

        await screen.rerender(<Probe submissionDeadline={null} />);
        await expect.element(screen.getByText("open")).toBeInTheDocument();
    });
});

describe("a deadline the server has passed while this clock has not", () => {
    afterEach(() => {
        syncServerClock(Temporal.Now.instant(), performance.now(), performance.now());
    });

    // Every render rather than the settled one: the first is decided by the
    // initial state alone, before the effect's own check could correct it.
    it("shows submission closed from the first render", async () => {
        const submissionDeadline = inAnHour();
        const rendered: boolean[] = [];
        syncServerClock(
            submissionDeadline.add({ minutes: 1 }),
            performance.now(),
            performance.now(),
        );

        const screen = await render(
            <Probe
                submissionDeadline={submissionDeadline}
                onRender={(passed) => rendered.push(passed)}
            />,
        );

        await expect.element(screen.getByText("closed")).toBeInTheDocument();
        expect(rendered).not.toContain(false);
    });
});
