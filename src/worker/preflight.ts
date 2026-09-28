import { appConfig } from "../util/app-config.js";
import { assertConcurrencyFitsPool } from "./config-checks.js";

// Runs at import, listed before anything that pulls in the ORM: a config that
// cannot fit must fail before a connection opens or a migration runs.
assertConcurrencyFitsPool(appConfig.worker.runtime.concurrency, appConfig.postgres.poolSize);
