import { MikroORM } from "@mikro-orm/postgresql";
import config from "../mikro-orm.config.js";

export const orm = await MikroORM.init(config);
export const em = orm.em;

await em.transactional(async (em) => {
    await em.execute(`SELECT pg_advisory_xact_lock(hashtext('migrate'))`);
    await orm.migrator.up();
});
