import { JsonApiError } from "@jsonapi-serde/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fileOpen } from "browser-fs-access";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { FileUpload } from "#/components/FileUploadField/FileUploadField.tsx";
import { ImageUploadField } from "#/components/FileUploadField/ImageUploadField.tsx";
import { recoverMissingUpload } from "#/components/FileUploadField/missing-upload.ts";
import { decodeImage } from "#/components/FileUploadField/prepare-image.ts";
import type { UploadedFile } from "#/components/FileUploadField/useFileUpload.ts";
import type { ImageConstraints, UploadLimits } from "#/queries/edition.ts";

type LandedUpload = {
    onUploaded: ((file: UploadedFile, uploaded: File) => void) | undefined;
};

const { landed } = vi.hoisted(() => {
    const landed: LandedUpload = { onUploaded: undefined };

    return { landed };
});

vi.mock("browser-fs-access", () => ({ fileOpen: vi.fn() }));

// Delegates to the real hook so the race tests still run the whole pipeline,
// and records onUploaded so a test can land an upload without sending one.
vi.mock("#/components/FileUploadField/useFileUpload.ts", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("#/components/FileUploadField/useFileUpload.ts")>();

    return {
        ...actual,
        useFileUpload: (options: Parameters<typeof actual.useFileUpload>[0]) => {
            landed.onUploaded = options.onUploaded;

            return actual.useFileUpload(options);
        },
    };
});

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: vi.fn() }),
}));

vi.mock("#/components/FileUploadField/prepare-image.ts", async (importOriginal) => ({
    ...(await importOriginal<typeof import("#/components/FileUploadField/prepare-image.ts")>()),
    decodeImage: vi.fn(),
}));

type TeaserValues = {
    teaserImage: FileUpload | null;
};

type DecodedImage = Awaited<ReturnType<typeof decodeImage>>;

const uploadLimits: UploadLimits = {
    maxFileSize: 10 * 1024 * 1024,
    fileContentTypes: [],
    imageContentTypes: ["image/png"],
};

const widescreen: ImageConstraints = {
    minWidth: 640,
    minHeight: 360,
    maxWidth: 3840,
    maxHeight: 2160,
    aspectRatio: { width: 16, height: 9 },
};

const Harness = (): ReactNode => {
    const form = useForm<TeaserValues>({ defaultValues: { teaserImage: null } });

    return (
        <QueryClientProvider client={new QueryClient()}>
            <ImageUploadField
                control={form.control}
                name="teaserImage"
                label="Teaser image"
                uploadLimits={uploadLimits}
                imageConstraints={widescreen}
            />
        </QueryClientProvider>
    );
};

type StoredHarnessProps = {
    stored: FileUpload;
};

const missingReplacement = new JsonApiError("Not found", 404, [
    {
        status: "404",
        code: "missing_file",
        title: "Missing file",
        meta: { key: "temp/replacement.png", attribute: "teaserImage" },
    },
]);

const StoredHarness = ({ stored }: StoredHarnessProps): ReactNode => {
    const form = useForm<TeaserValues>({ defaultValues: { teaserImage: stored } });

    return (
        <QueryClientProvider client={new QueryClient()}>
            <ImageUploadField
                control={form.control}
                name="teaserImage"
                label="Teaser image"
                uploadLimits={uploadLimits}
                imageConstraints={widescreen}
            />
            <button type="button" onClick={() => recoverMissingUpload(form, missingReplacement)}>
                Refuse the save
            </button>
        </QueryClientProvider>
    );
};

const pickedImage = async (): Promise<ImageBitmap> => {
    vi.mocked(fileOpen).mockResolvedValue(
        new File(["png"], "teaser.png", { type: "image/png" }) as Awaited<
            ReturnType<typeof fileOpen>
        >,
    );

    return createImageBitmap(new ImageData(1600, 900));
};

describe("ImageUploadField", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps the cropper closed for a pick canceled during its decode", async () => {
        const bitmap = await pickedImage();
        const close = vi.spyOn(bitmap, "close");
        const { promise: decoded, resolve: resolveDecode } = Promise.withResolvers<DecodedImage>();
        vi.mocked(decodeImage).mockReturnValue(decoded);
        const screen = await render(<Harness />);

        await screen.getByRole("button", { name: /Choose image/ }).click();
        await screen.getByRole("button", { name: "Cancel" }).click();
        resolveDecode({ bitmap });

        await expect.poll(() => close).toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("releases the image when the field goes away with the cropper open", async () => {
        const bitmap = await pickedImage();
        const close = vi.spyOn(bitmap, "close");
        const createObjectUrl = vi.spyOn(URL, "createObjectURL");
        const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
        vi.mocked(decodeImage).mockResolvedValue({ bitmap });
        const screen = await render(<Harness />);

        await screen.getByRole("button", { name: /Choose image/ }).click();
        await expect.element(screen.getByRole("dialog")).toBeVisible();
        const cropSource = createObjectUrl.mock.results[0]?.value;
        await screen.unmount();

        await expect.poll(() => close).toHaveBeenCalled();
        expect(revokeObjectUrl).toHaveBeenCalledWith(cropSource);
    });

    it("shows the stored thumbnail once a refusal puts the field back", async () => {
        const stored: FileUpload = {
            key: "editions/edition-1/sessions/session-1/teaser-image/stored.webp",
            filename: "stored.png",
            thumbnailUrl: "https://cdn.test/stored-thumbnail.webp",
        };
        const screen = await render(<StoredHarness stored={stored} />);

        await expect.element(screen.getByRole("img")).toHaveAttribute("src", stored.thumbnailUrl);
        landed.onUploaded?.(
            { key: "temp/replacement.png", filename: "replacement.png" },
            new File(["png"], "replacement.png", { type: "image/png" }),
        );
        await expect
            .element(screen.getByRole("img"))
            .toHaveAttribute("src", expect.stringMatching(/^blob:/));

        await screen.getByRole("button", { name: "Refuse the save" }).click();

        await expect.element(screen.getByRole("img")).toHaveAttribute("src", stored.thumbnailUrl);
    });
});
