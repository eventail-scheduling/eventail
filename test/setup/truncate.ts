import type { MikroORM } from "@mikro-orm/postgresql";

let statement: string | undefined;

/**
 * Covers every table in the entity metadata, pivot tables included.
 *
 * A pivot table carries its own metadata entry, so the loop needs no special
 * case for it.
 */
const buildStatement = (orm: MikroORM): string => {
    const tables = new Set<string>();

    for (const meta of orm.getMetadata().getAll().values()) {
        if (meta.abstract || meta.virtual || meta.embeddable || meta.expression) {
            continue;
        }

        tables.add(`"${meta.tableName}"`);
    }

    return `truncate ${[...tables].join(", ")} restart identity cascade`;
};

/**
 * Empties every table the ORM knows about.
 *
 * The migration table is untouched because migrations register no entity, and
 * the schema seeds no rows, so a truncated database is a freshly migrated one.
 */
export const truncateAll = async (orm: MikroORM): Promise<void> => {
    statement ??= buildStatement(orm);

    await orm.em.getConnection().execute(statement);
};
