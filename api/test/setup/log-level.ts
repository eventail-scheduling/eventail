// config/development.toml logs at debug, and tests provoke warn and error lines on
// purpose; LOG_LEVEL=debug pnpm test brings all of it back.
process.env.LOG_LEVEL ??= "fatal";
