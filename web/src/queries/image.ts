import { z } from "zod/mini";

/**
 * An uploaded image as the API describes it.
 *
 * `processing` stays true until a downscaled version has replaced the upload,
 * and for good where the job gives up, so a poller needs a deadline of its own.
 */
export const imageDescriptorSchema = z.object({
    key: z.string(),
    filename: z.string(),
    url: z.string(),
    thumbnailUrl: z.string(),
    processing: z.boolean(),
});

export type ImageDescriptor = z.output<typeof imageDescriptorSchema>;
