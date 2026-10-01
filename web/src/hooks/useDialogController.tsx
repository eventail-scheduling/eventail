import { useCallback, useMemo, useState } from "react";

export type ControlledDialogProps = {
    open: boolean;
    onClose: () => void;
    onTransitionExited: () => void;
};

type DialogController = {
    open: () => void;
    mount: boolean;
    dialogProps: ControlledDialogProps;
};

/**
 * Hangs the exit callback on `onTransitionExited` rather than the transition slot.
 *
 * Several of these dialogs supply that slot themselves and would replace it
 * wholesale. Material UI takes the callback on Modal, and Dialog passes it down
 * with the rest of its unclaimed props.
 */
export const useDialogController = (): DialogController => {
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    const handleOpen = useCallback(() => {
        setMounted(true);
        setOpen(true);
    }, []);

    const onClose = useCallback(() => {
        setOpen(false);
    }, []);

    const onTransitionExited = useCallback(() => {
        setMounted(false);
    }, []);

    return useMemo(
        () => ({
            open: handleOpen,
            mount: mounted,
            dialogProps: { open, onClose, onTransitionExited },
        }),
        [open, handleOpen, onClose, onTransitionExited, mounted],
    );
};
