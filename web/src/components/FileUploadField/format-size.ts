const units = [
    { suffix: "GB", factor: 1_000_000_000 },
    { suffix: "MB", factor: 1_000_000 },
    { suffix: "kB", factor: 1_000 },
] as const;

/**
 * Rounds a byte limit down to a unit a speaker recognizes.
 *
 * Decimal rather than binary, because "10 MiB" reads as a typo to everyone who
 * is not a programmer, and down rather than nearest, so nothing a hint says is
 * allowed can then be refused.
 */
export const formatSizeLimit = (bytes: number): string => {
    for (const { suffix, factor } of units) {
        if (bytes >= factor) {
            return `${Math.floor(bytes / factor).toString()} ${suffix}`;
        }
    }

    return `${bytes.toString()} bytes`;
};
