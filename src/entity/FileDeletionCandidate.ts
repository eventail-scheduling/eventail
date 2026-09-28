import { t } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";

/**
 * An unreferenced stored object the pruner has seen once but not yet deleted.
 *
 * Object age cannot provide the deletion grace: a file that was referenced for a
 * year is deleted seconds after losing its reference if age since upload is the
 * measure, pulling it out from under consumers still holding a document that
 * links it. The row records when the pruner first found the object orphaned;
 * deletion waits until that is a full grace period ago, and a key that turns out
 * referenced again simply loses its row.
 */
@Entity()
export class FileDeletionCandidate {
    @PrimaryKey({ type: t.text })
    public readonly key: string;

    @Property({ type: InstantType })
    public readonly markedAt: Temporal.Instant;

    public constructor(values: { key: string; markedAt: Temporal.Instant }) {
        this.key = values.key;
        this.markedAt = values.markedAt;
    }
}
