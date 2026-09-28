import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fileOpen } from "browser-fs-access";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useFileUpload } from "#/components/FileUploadField/useFileUpload.ts";

vi.mock("browser-fs-access", () => ({ fileOpen: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: vi.fn() }),
}));

type ProvidersProps = {
    children: ReactNode;
};

describe("useFileUpload", () => {
    it("drops a file the picker returns after the field is gone", async () => {
        const { promise: picked, resolve: resolvePick } = Promise.withResolvers<File>();
        vi.mocked(fileOpen).mockReturnValue(picked as ReturnType<typeof fileOpen>);
        const prepareFile = vi.fn(async (file: File) => ({ file }));
        const client = new QueryClient();
        const Providers = ({ children }: ProvidersProps): ReactNode => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        const { result, unmount } = await renderHook(
            () =>
                useFileUpload({
                    maxFileSize: 1024 * 1024,
                    mimeTypes: ["image/png"],
                    prepareFile,
                    onUploaded: vi.fn(),
                }),
            { wrapper: Providers },
        );

        result.current.select();
        await unmount();
        resolvePick(new File(["png"], "avatar.png", { type: "image/png" }));
        await picked;
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(prepareFile).not.toHaveBeenCalled();
    });
});
