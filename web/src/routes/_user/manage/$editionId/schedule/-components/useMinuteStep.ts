import { useState } from "react";
import {
    defaultMinuteStep,
    isMinuteStep,
    type MinuteStep,
} from "#/components/ScheduleGrid/index.js";

const LOCAL_STORAGE_KEY = "scheduleMinuteStep";

type MinuteStepPreference = [MinuteStep, (step: MinuteStep) => void];

/**
 * Keeps the step with the organizer rather than with the edition.
 *
 * pretalx keeps its grid interval the same way. Nothing about a step describes
 * the event, two organizers can disagree without either being wrong, and what a
 * published schedule is read against is the slots rather than the grid they
 * were placed on.
 */
export const useMinuteStep = (): MinuteStepPreference => {
    const [step, setStep] = useState<MinuteStep>(() => {
        const stored = Number(window.localStorage.getItem(LOCAL_STORAGE_KEY));

        return isMinuteStep(stored) ? stored : defaultMinuteStep;
    });

    // Written when it is chosen rather than on mount, so a default nobody picked
    // never becomes one that outlives changing it here.
    const choose = (next: MinuteStep) => {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, next.toString());
        setStep(next);
    };

    return [step, choose];
};
