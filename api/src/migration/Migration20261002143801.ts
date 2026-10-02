import { Migration } from "@mikro-orm/migrations";
import { v7 as uuidv7 } from "uuid";

type EditionRow = {
    edition_id: string;
};

export class Migration20261002143801 extends Migration {
    public async up(): Promise<void> {
        await this.execute(`
            CREATE TABLE "venue" (
                "id" uuid NOT NULL,
                "name" text NOT NULL,
                "address" text NULL,
                "external_key" text NULL,
                "position" int NOT NULL,
                "edition_id" uuid NOT NULL,
                PRIMARY KEY ("id")
            );
        `);
        await this.execute(
            `CREATE INDEX "venue_edition_id_id_index" ON "venue" ("edition_id", "id");`,
        );
        await this.execute(`
            ALTER TABLE "venue"
            ADD CONSTRAINT "venue_edition_id_position_unique" UNIQUE ("edition_id", "position")
            DEFERRABLE INITIALLY DEFERRED;
        `);
        await this.execute(`
            ALTER TABLE "venue"
            ADD CONSTRAINT "venue_edition_id_external_key_unique" UNIQUE ("edition_id", "external_key");
        `);
        await this.execute(`
            ALTER TABLE "venue"
            ADD CONSTRAINT "venue_edition_id_foreign" FOREIGN key ("edition_id") REFERENCES "edition" ("id") ON DELETE CASCADE;
        `);

        await this.execute(`ALTER TABLE "location" ADD "venue_id" uuid NULL;`);

        const editions = (await this.execute(
            `SELECT DISTINCT "edition_id" FROM "location";`,
        )) as EditionRow[];

        for (const { edition_id } of editions) {
            const venueId = uuidv7();

            await this.execute(
                `INSERT INTO "venue" ("id", "name", "address", "external_key", "position", "edition_id")
                 VALUES (?, 'Main venue', NULL, NULL, 0, ?);`,
                [venueId, edition_id],
            );
            await this.execute(`UPDATE "location" SET "venue_id" = ? WHERE "edition_id" = ?;`, [
                venueId,
                edition_id,
            ]);
        }

        await this.execute(`ALTER TABLE "location" ALTER COLUMN "venue_id" SET NOT NULL;`);

        await this.execute(
            `ALTER TABLE "location" ADD CONSTRAINT "location_venue_id_foreign" FOREIGN KEY ("venue_id") REFERENCES "venue" ("id");`,
        );
    }
}
