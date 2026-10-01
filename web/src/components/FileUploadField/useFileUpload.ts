import { fileOpen } from "browser-fs-access";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";
import { type SignedPost, useCreateSignedPostMutation } from "#/mutations/signed-post.js";
import { hasErrorCode } from "#/utils/api.ts";
import { formatSizeLimit } from "./format-size.js";
import type { HashStatusMessage } from "./hash-worker.js";
import { UploadTrackerContext } from "./useUploadTracker.js";

type IndeterminateProgress = {
    type: "indeterminate";
};

type DeterminateProgress = {
    type: "determinate";
    current: number;
    total: number;
};

export type UploadStatus = {
    filename: string;
    progress: IndeterminateProgress | DeterminateProgress;
};

export type UploadedFile = {
    key: string;
    filename: string;
};

export type PreparedFile = { file: File } | { error: string };

type UseFileUploadOptions = {
    maxFileSize: number;
    /** What the picker offers and what a drop is checked against. */
    mimeTypes: string[];
    /**
     * Turns the picked file into the one to upload, before it is sized or hashed.
     *
     * An image field re-encodes here, so the size limit applies to what actually
     * leaves the browser rather than to what came off the camera. Returning null
     * abandons the attempt without an error, which is what a dismissed cropper
     * is.
     */
    prepareFile?: (file: File, isCurrent: () => boolean) => Promise<PreparedFile | null>;
    /** Carries what was actually uploaded, which a preview has to come from. */
    onUploaded: (file: UploadedFile, uploaded: File) => void;
};

type UseFileUpload = {
    status: UploadStatus | null;
    /** Anything that stopped this field's own upload, to be shown at the field. */
    error: string | null;
    select: () => void;
    /** For a drop, which never passes through the picker's type filter. */
    accept: (file: File) => void;
    cancel: () => void;
    clearError: () => void;
};

/**
 * Runs a file from the picker to an attached descriptor, reporting progress.
 *
 * Holds no opinion about presentation, so an image field and a document field
 * can look nothing alike and still upload identically. Failures surface through
 * `error` rather than a toast, because the field is where a reader looks for
 * what went wrong and a toast is gone by the time they do.
 */
export const useFileUpload = ({
    maxFileSize,
    mimeTypes,
    prepareFile,
    onUploaded,
}: UseFileUploadOptions): UseFileUpload => {
    const [status, setStatus] = useState<UploadStatus | null>(null);
    const uploadTracker = useContext(UploadTrackerContext);
    const endTracking = useRef<() => void>(undefined);
    const [error, setError] = useState<string | null>(null);
    const hashWorker = useRef<Worker>(undefined);
    const uploadRequest = useRef<XMLHttpRequest>(undefined);
    const createSignedPostMutation = useCreateSignedPostMutation();

    // An attempt that runs its course ends by clearing its status, however it
    // ends, and one superseded ends as the next begins; either way it stops
    // counting against the form's save.
    const updateStatus = useCallback((next: UploadStatus | null) => {
        setStatus(next);

        if (next === null) {
            endTracking.current?.();
            endTracking.current = undefined;
        }
    }, []);

    /**
     * Which attempt is the live one, so an abandoned attempt can stand down.
     *
     * Aborting the request is not enough on its own: between the hash finishing
     * and the upload starting there is a presign in flight, which is held by
     * neither ref, so a cancel in that window would otherwise be ignored and
     * the file would attach after the speaker had said no.
     */
    const attempt = useRef(0);

    const uploadFile = useCallback(
        (file: File, signedPost: SignedPost, run: number) => {
            const formData = new FormData();

            for (const [key, value] of Object.entries(signedPost.fields)) {
                formData.append(key, value);
            }

            formData.append("file", file);

            const request = new XMLHttpRequest();
            request.open("POST", signedPost.url);

            request.upload.addEventListener("progress", (event) => {
                if (attempt.current !== run) {
                    return;
                }

                updateStatus({
                    filename: file.name,
                    progress: {
                        type: "determinate",
                        current: event.loaded,
                        total: event.total,
                    },
                });
            });

            request.addEventListener("error", () => {
                if (attempt.current !== run) {
                    return;
                }

                setError("The file could not be uploaded. Try again.");
                updateStatus(null);
            });

            request.addEventListener("load", () => {
                if (attempt.current !== run) {
                    return;
                }

                if (request.status >= 400) {
                    console.error("The store rejected the upload", request.status);
                    setError("The file could not be uploaded. Try again.");
                    updateStatus(null);
                    return;
                }

                updateStatus(null);
                setError(null);
                onUploaded({ key: signedPost.key, filename: file.name }, file);
            });

            request.send(formData);
            uploadRequest.current = request;
        },
        [onUploaded, updateStatus],
    );

    const cancel = useCallback(() => {
        attempt.current += 1;
        updateStatus(null);
        hashWorker.current?.terminate();
        hashWorker.current = undefined;
        uploadRequest.current?.abort();
        uploadRequest.current = undefined;
    }, [updateStatus]);

    // A field mounted again for the same answer could otherwise start a second
    // upload that this one overwrites on landing.
    useEffect(() => cancel, [cancel]);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    /** Runs the caller's preparation, or gives null once this attempt is over either way. */
    const resolveFile = useCallback(
        async (picked: File, run: number): Promise<File | null> => {
            if (prepareFile === undefined) {
                return picked;
            }

            let prepared: PreparedFile | null;

            try {
                prepared = await prepareFile(picked, () => attempt.current === run);
            } catch (prepareError) {
                console.error(prepareError);

                if (attempt.current !== run) {
                    return null;
                }

                setError("The selected file could not be processed.");
                updateStatus(null);
                return null;
            }

            if (attempt.current !== run) {
                return null;
            }

            if (prepared === null) {
                updateStatus(null);
                return null;
            }

            if ("error" in prepared) {
                setError(prepared.error);
                updateStatus(null);
                return null;
            }

            return prepared.file;
        },
        [prepareFile, updateStatus],
    );

    const acceptFile = useCallback(
        async (picked: File) => {
            setError(null);

            // The picker's filter is a hint, which "All files" defeats, and a
            // drop never passes through it at all.
            if (!mimeTypes.includes(picked.type)) {
                setError("The selected file is not a type this field accepts.");
                return;
            }

            // Claim the attempt before the first await, so a cancel during a
            // long decode is not overwritten by what the decode returns.
            const run = attempt.current + 1;
            attempt.current = run;
            endTracking.current?.();
            endTracking.current = uploadTracker?.begin();

            updateStatus({
                filename: picked.name,
                progress: { type: "indeterminate" },
            });

            const file = await resolveFile(picked, run);

            if (file === null) {
                return;
            }

            // Before hashing rather than after the presign: an oversized file
            // otherwise pays for a full hash and leaves a pending upload row
            // behind for something it was never going to accept.
            if (file.size > maxFileSize) {
                setError(`The selected file must be smaller than ${formatSizeLimit(maxFileSize)}.`);
                updateStatus(null);
                return;
            }

            const worker = new Worker(new URL("./hash-worker.ts", import.meta.url), {
                type: "module",
            });

            // A worker that never loads reports nothing through `message`, and
            // the field would hold its indeterminate bar until the reader gave
            // up. Its own script is the one lazily fetched asset here, so a
            // deploy under an open tab is the way this happens.
            worker.addEventListener("error", () => {
                worker.terminate();

                if (hashWorker.current === worker) {
                    hashWorker.current = undefined;
                }

                if (attempt.current !== run) {
                    return;
                }

                setError("The file could not be read. Try again.");
                updateStatus(null);
            });

            worker.addEventListener("message", (event: MessageEvent<HashStatusMessage>) => {
                const message = event.data;

                if (message.type !== "progress") {
                    worker.terminate();

                    // Only when it is still ours: a later attempt may already
                    // have put its own worker here, and clearing that would
                    // leave a cancel with nothing to terminate.
                    if (hashWorker.current === worker) {
                        hashWorker.current = undefined;
                    }
                }

                if (attempt.current !== run) {
                    return;
                }

                match(message)
                    .with({ type: "progress" }, () => {
                        updateStatus({
                            filename: file.name,
                            progress: { type: "indeterminate" },
                        });
                    })
                    .with({ type: "complete" }, ({ md5Hash }) => {
                        createSignedPostMutation
                            .mutateAsync({ contentType: file.type, md5Hash })
                            .then((signedPost) => {
                                if (attempt.current !== run) {
                                    return;
                                }

                                uploadFile(file, signedPost, run);
                            })
                            .catch((signingError: unknown) => {
                                if (attempt.current !== run) {
                                    return;
                                }

                                // The quota clears when a form saves and
                                // attaches what it holds, or when the pruner
                                // sweeps, so "try again" on its own would send
                                // the reader back into what just refused them.
                                setError(
                                    hasErrorCode(signingError, "pending_upload_quota_reached")
                                        ? "Too many uploads are waiting to be attached. Save what you have in progress, or try again later."
                                        : "The file could not be uploaded. Try again.",
                                );
                                updateStatus(null);
                            });
                    })
                    .with({ type: "error" }, ({ message: reason }) => {
                        setError(reason);
                        updateStatus(null);
                    })
                    .exhaustive();
            });

            worker.postMessage(file);
            hashWorker.current = worker;
        },
        [
            createSignedPostMutation,
            maxFileSize,
            mimeTypes,
            resolveFile,
            uploadFile,
            uploadTracker?.begin,
            updateStatus,
        ],
    );

    const select = useCallback(async () => {
        // The picker stays open for as long as the reader likes, and the field
        // can be gone by the time it resolves.
        const opened = attempt.current;
        let picked: File;

        try {
            picked = await fileOpen({ mimeTypes });
        } catch (pickerError) {
            // Dismissing the picker rejects rather than resolving, on both the
            // File System Access path and the input fallback.
            if (pickerError instanceof DOMException && pickerError.name === "AbortError") {
                return;
            }

            console.error(pickerError);
            setError("The file could not be opened. Try again.");
            return;
        }

        if (attempt.current !== opened) {
            return;
        }

        await acceptFile(picked);
    }, [acceptFile, mimeTypes]);

    const startSelect = useCallback(() => {
        void select();
    }, [select]);

    const accept = useCallback(
        (file: File) => {
            void acceptFile(file);
        },
        [acceptFile],
    );

    return { status, error, select: startSelect, accept, cancel, clearError };
};
