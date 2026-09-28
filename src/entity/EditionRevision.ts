import { t } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/es";

/**
 * The change counter behind the schedule document's ETag, one row per edition.
 *
 * Written by every handler whose change an integration could observe.
 *
 * It is its own table because both natural homes fail, differently: a counter
 * on the schedule requires resolving which schedule, which is an unlocked read
 * that silently bumps the superseded row when it races a publish, and a
 * counter on the edition joins a lock cycle with publish's FOR UPDATE on that
 * row.
 *
 * editionId is a scalar rather than a ManyToOne, and there is deliberately no
 * foreign key: the bump's INSERT arm would fire the RI check and take FOR KEY
 * SHARE on the edition row, recreating the cycle the separate table avoids,
 * and a cascade would place this row in the edition delete chain at a position
 * Postgres picks. Edition delete removes the row explicitly instead; a row
 * recreated by a write racing that delete is tolerated, since edition ids are
 * never reused and the counter is only read behind an edition resolve.
 */
@Entity()
export class EditionRevision {
    @PrimaryKey({ type: t.uuid })
    public readonly editionId: string;

    @Property({ type: t.integer })
    public revision: number;

    public constructor(values: { editionId: string; revision: number }) {
        this.editionId = values.editionId;
        this.revision = values.revision;
    }
}
