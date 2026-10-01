import { createContext, useMemo, useState } from "react";

export type UploadTracker = {
    /** Counts an upload as running until the returned function is called, once or more. */
    begin: () => () => void;
};

/** The form a file field reports its running uploads to; absent outside such a form. */
export const UploadTrackerContext = createContext<UploadTracker | undefined>(undefined);

type UseUploadTracker = {
    uploadTracker: UploadTracker;
    uploading: boolean;
};

/**
 * Tracks the uploads running in a form, so its save can wait for them.
 *
 * A save sent while an upload runs would carry the field's old value, and the
 * upload landing mid-save would be wiped by the reset that follows it. An
 * upload is counted from the moment a file is picked until it lands, fails or
 * is canceled.
 */
export const useUploadTracker = (): UseUploadTracker => {
    const [running, setRunning] = useState(0);
    const uploadTracker = useMemo<UploadTracker>(
        () => ({
            begin: () => {
                let ended = false;
                setRunning((count) => count + 1);

                return () => {
                    if (!ended) {
                        ended = true;
                        setRunning((count) => count - 1);
                    }
                };
            },
        }),
        [],
    );

    return { uploadTracker, uploading: running > 0 };
};
