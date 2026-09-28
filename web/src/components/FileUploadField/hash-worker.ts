import { createMD5 } from "hash-wasm";
import { promiseWithResolvers } from "#/utils/promise.js";

type ErrorMessage = {
    type: "error";
    message: string;
};

type ProgressMessage = {
    type: "progress";
    current: number;
    total: number;
};

type CompletionMessage = {
    type: "complete";
    md5Hash: string;
};

export type HashStatusMessage = ErrorMessage | ProgressMessage | CompletionMessage;

const CHUNK_SIZE = 1024 * 1024;
let lastProgressUpdateTime = Number.NEGATIVE_INFINITY;

const sendProgressUpdate = (message: ProgressMessage): void => {
    const now = performance.now();

    if (now - lastProgressUpdateTime < 1000 / 30) {
        return;
    }

    self.postMessage(message);
    lastProgressUpdateTime = now;
};

const calculateMd5Hash = async (file: File): Promise<string> => {
    const { promise, resolve, reject } = promiseWithResolvers<string>();
    const fileReader = new FileReader();
    const hasher = await createMD5();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let currentChunk = 0;

    fileReader.addEventListener("load", () => {
        currentChunk += 1;
        hasher.update(new Uint8Array(fileReader.result as ArrayBuffer));

        if (currentChunk < totalChunks) {
            processNextPart();
            return;
        }

        sendProgressUpdate({
            type: "progress",
            current: file.size,
            total: file.size,
        });

        resolve(hasher.digest("hex"));
    });

    fileReader.addEventListener("error", () => {
        reject("Failed to read file");
    });

    const processNextPart = () => {
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);

        sendProgressUpdate({
            type: "progress",
            current: start,
            total: file.size,
        });

        fileReader.readAsArrayBuffer(file.slice(start, end));
    };

    processNextPart();
    return promise;
};

self.addEventListener("message", async (event: MessageEvent<File>) => {
    const file = event.data;

    try {
        const md5Hash = await calculateMd5Hash(file);

        self.postMessage({
            type: "complete",
            md5Hash: md5Hash,
        } satisfies CompletionMessage);
    } catch {
        self.postMessage({
            type: "error",
            message: "Failed to read file",
        } satisfies ErrorMessage);
    }

    self.close();
});
