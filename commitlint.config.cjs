module.exports = {
    extends: ["@commitlint/config-conventional"],
    rules: {
        "scope-enum": [
            2,
            "always",
            [
                "auth",
                "custom-fields",
                "editions",
                "invites",
                "jobs",
                "locations",
                "openapi",
                "schedules",
                "session-types",
                "sessions",
                "teams",
                "tracks",
                "ui",
                "users",
                // Dependabot emits these two when commit-message.include is
                // set to "scope".
                "deps",
                "deps-dev",
            ],
        ],
    },
};
