import invariant from "tiny-invariant";

// `Promise.withResolvers()` needs the ES2024 lib and Safari 17.4. The tsconfig
// lib is ES2023 and the Vite build target floor is Safari 16.4, so both have
// to move before this can go.
type PromiseWithResolvers<T> = {
    promise: Promise<T>;
    resolve: (result: T) => void;
    reject: (error?: unknown) => void;
};

export const promiseWithResolvers = <T>(): PromiseWithResolvers<T> => {
    let resolve: ((value: T) => void) | undefined;
    let reject: ((reason?: unknown) => void) | undefined;

    const promise = new Promise<T>((internalResolve, internalReject) => {
        resolve = internalResolve;
        reject = internalReject;
    });

    invariant(resolve);
    invariant(reject);

    return { promise, resolve, reject };
};
