import { type NavigateOptions, useCanGoBack, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useCallback } from "react";

type UseGoBackResult = {
    goBack: () => void;
    goBackProps: NavigateOptions & { onClick: (event: MouseEvent) => void };
};

export const useGoBack = (fallback: NavigateOptions): UseGoBackResult => {
    const canGoBack = useCanGoBack();
    const navigate = useNavigate();

    const goBack = useCallback(() => {
        if (canGoBack) {
            window.history.back();
            return;
        }

        void navigate(fallback);
    }, [canGoBack, navigate, fallback]);

    const handleClick = useCallback(
        (event: MouseEvent) => {
            if (
                event.metaKey ||
                event.altKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.button !== 0
            ) {
                return;
            }

            if (canGoBack) {
                event.preventDefault();
                window.history.back();
            }
        },
        [canGoBack],
    );

    return {
        goBack,
        goBackProps: { ...fallback, onClick: handleClick },
    };
};
