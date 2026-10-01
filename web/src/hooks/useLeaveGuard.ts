import { useBlocker } from "@tanstack/react-router";
import { useConfirm } from "material-ui-confirm";
import { useRef } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

type LeaveGuard = {
    /** Stops asking for good, for a page that moves on by itself after a successful save. */
    release: () => void;
};

/**
 * Asks before a navigation, a reload or a closed tab drops a form's unsaved changes.
 *
 * The dirty state comes from the form's last render, so a page that resets the
 * form and navigates in one go calls `release` first. It is read here during
 * render as well, since RHF only tracks `isDirty` for a form subscribed to it.
 */
export const useLeaveGuard = <TFieldValues extends FieldValues, TContext, TTransformedValues>(
    form: UseFormReturn<TFieldValues, TContext, TTransformedValues>,
): LeaveGuard => {
    const confirm = useConfirm();
    const released = useRef(false);
    const hasUnsavedChanges = (): boolean => form.formState.isDirty && !released.current;

    void form.formState.isDirty;

    useBlocker({
        shouldBlockFn: async () => {
            if (!hasUnsavedChanges()) {
                return false;
            }

            const { confirmed } = await confirm({
                title: "Leave without saving?",
                description: "The changes you made on this page have not been saved.",
                confirmationText: "Leave",
                cancellationText: "Stay",
            });

            return !confirmed;
        },
        enableBeforeUnload: hasUnsavedChanges,
    });

    return {
        release: () => {
            released.current = true;
        },
    };
};
