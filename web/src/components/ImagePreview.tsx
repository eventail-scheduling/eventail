import { Box, Link, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ImageDescriptor } from "#/queries/image.ts";

/** The stand-in cannot know the image's shape, so it takes a wide default. */
const skeletonRatio = 9 / 16;

type ImagePreviewProps = {
    image: ImageDescriptor;
    maxWidth?: number;
};

/**
 * An uploaded image, or a stand-in while the smaller version is still being made.
 *
 * `thumbnailUrl` points at the upload itself until the job re-points it, so a
 * thumbnail box drawn from it pulls the full-size image to paint a few hundred
 * pixels.
 */
export const ImagePreview = ({ image, maxWidth = 240 }: ImagePreviewProps): ReactNode => {
    if (image.processing) {
        return (
            <Stack spacing={0.5}>
                <Skeleton
                    variant="rounded"
                    width={maxWidth}
                    height={Math.round(maxWidth * skeletonRatio)}
                />
                {/* The job can exhaust its retries and leave the flag set for
                    good. The image is served throughout, so the way to it
                    stays open. */}
                <Typography variant="body2" color="text.secondary">
                    Preparing a smaller version.{" "}
                    <Link href={image.url} target="_blank" rel="noopener">
                        Open the image
                    </Link>
                </Typography>
            </Stack>
        );
    }

    return (
        // The full size opens in a tab rather than a viewer of our own, which
        // hands zoom, pan and save-as to the one already in the browser.
        <Link href={image.url} target="_blank" rel="noopener" title={`Open ${image.filename}`}>
            <Box
                component="img"
                src={image.thumbnailUrl}
                alt={image.filename}
                sx={{ maxWidth, borderRadius: 1, display: "block" }}
            />
        </Link>
    );
};
