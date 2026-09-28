import DownloadIcon from "@mui/icons-material/Download";
import { Button } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback } from "react";
import { useMintResponseFileMutation } from "#/mutations/response-file.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

type ResponseFileLinkProps = {
    editionId: string;
    responseId: string;
    filename: string;
};

/**
 * Fetches the file a response holds, under a signature minted on the click.
 *
 * The API sends a file answer without a url: the answer can be confidential,
 * so the store never serves it directly and every download is authorized when
 * it is asked for.
 */
export const ResponseFileLink = ({
    editionId,
    responseId,
    filename,
}: ResponseFileLinkProps): ReactNode => {
    const mintMutation = useMintResponseFileMutation();

    const handleClick = useCallback(() => {
        // Opened inside the click, since a window opened once the URL is minted
        // is outside the gesture, and Safari blocks it. The page itself cannot
        // navigate: the browser would ask to leave a form with unsaved changes
        // before it learned the response is a download. A browser usually closes
        // the tab once the download starts; Safari is reported to leave it open.
        const tab = window.open("", "_blank");

        if (tab === null) {
            enqueueSnackbar("The download needs a new tab. Allow pop-ups and try again.", {
                variant: "error",
            });
            return;
        }

        tab.opener = null;

        // The promise rather than mutate's callbacks, which stop firing once
        // this link unmounts and would leave the tab blank.
        mintMutation.mutateAsync({ editionId, responseId }).then(
            ({ url }) => {
                if (!tab.closed) {
                    tab.location.href = url;
                }
            },
            (error: unknown) => {
                tab.close();
                defaultMutationErrorHandler(error);
            },
        );
    }, [mintMutation, editionId, responseId]);

    return (
        <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleClick}
            loading={mintMutation.isPending}
            sx={{ ml: -1 }}
        >
            {filename}
        </Button>
    );
};
