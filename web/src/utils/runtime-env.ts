type RuntimeEnvKey = keyof Window["RUNTIME_ENV"];

/**
 * What the container has to be told before the app can do anything.
 *
 * `envsubst` writes an empty string for a variable it was never given, so an
 * unset one reaches the page as `""` and nothing downstream can tell it from a
 * deliberate blank. The API refuses to boot on a missing value; this is the
 * client's equivalent, and it names what is missing rather than failing later
 * at whatever first reads it.
 *
 * Scopes and audience are absent from this list on purpose: an installation
 * whose provider wants neither is a real one.
 */
const requiredKeys: RuntimeEnvKey[] = ["API_URL", "OIDC_CLIENT_ID", "OIDC_AUTHORITY"];

const urlKeys: RuntimeEnvKey[] = ["API_URL", "OIDC_AUTHORITY"];

/** Lists what the deployment has to fix, in the operator's own vocabulary. */
export const runtimeEnvProblems = (): string[] => {
    const env = window.RUNTIME_ENV as Partial<Window["RUNTIME_ENV"]> | undefined;

    if (!env) {
        return ["runtime-env.js was not served"];
    }

    const problems = requiredKeys
        .filter((key) => (env[key] ?? "") === "")
        .map((key) => `${key} is not set`);

    for (const key of urlKeys) {
        const value = env[key];

        if (value === undefined || value === "") {
            continue;
        }

        // Parsed rather than probed: `URL.canParse` arrived in Safari 17 and
        // the build targets 16.4, so the check meant to save this page from
        // blanking would be what blanks it.
        try {
            new URL(value);
        } catch {
            problems.push(`${key} is not a URL`);
        }
    }

    return problems;
};
