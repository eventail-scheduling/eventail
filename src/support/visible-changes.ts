/**
 * Serializes a value stably, so two fingerprints compare on content alone.
 *
 * A fingerprint of the fields an integration can see, taken before a patch and
 * again after it, lets a handler bump the revision only when the document it
 * serves would actually differ.
 *
 * A stored JSONB value and a freshly parsed payload can carry the same entries
 * in a different key order, which a plain `JSON.stringify` would read as a
 * change every time, so keys are sorted here. Sorting means walking objects by
 * hand, and a Temporal value has no own enumerable properties, so that walk
 * would serialize it as `{}` and every date would compare equal; the `toJSON`
 * branch is what stops that, and removing it makes edition date edits silently
 * stop bumping.
 */
const canonicalJson = (value: unknown): string => {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }

    if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
        return JSON.stringify(value) ?? "null";
    }

    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);

    return `{${entries.join(",")}}`;
};

export const visibleFingerprint = (values: readonly unknown[]): string => canonicalJson(values);
