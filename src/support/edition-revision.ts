import type { EntityManager } from "@mikro-orm/postgresql";
import type { Edition } from "../entity/Edition.js";
import type { SessionState } from "../entity/Session.js";

/**
 * Reports whether a session in any of these states is one a consumer holds.
 *
 * Confirmed is the only state the published schedule serves an integration, so
 * a change with confirmed on neither side is invisible to one and must not
 * bump. A transition passes both of its ends, since leaving confirmed takes
 * something away that a consumer already has.
 */
export const reachesIntegration = (...states: SessionState[]): boolean =>
    states.includes("confirmed");

/**
 * Marks the edition's published schedule document as changed.
 *
 * Runs inside the caller's transaction, after the caller's own work. The flush
 * is load-bearing rather than tidiness. `em.transactional` runs the callback
 * and only then flushes, so a handler that mutates without flushing would take
 * its row locks *after* this takes the counter row, which closes a cycle
 * against any handler that locks those rows first and bumps second.
 * Flushing here puts every mutated row's lock ahead of the counter row's, and
 * makes the ordering a property of this function rather than a rule each
 * handler has to remember. Nothing may take a lock after this call; the
 * purge's sorted loop over several counters is the one sanctioned exception,
 * argued at findHostEditions.
 *
 * Unconditional on purpose: resolving the current publication to decide
 * whether anyone could observe the change is the unlocked read that loses
 * bumps against a concurrent publish. A bump nobody can observe turns one
 * conditional GET the consumer sends anyway into a full document fetch, which
 * is the cheap direction; a lost bump is silent staleness.
 *
 * An upsert rather than an UPDATE because a missing row would affect zero rows
 * and silently skip the bump, and raw SQL because the increment must be
 * computed in the database or two concurrent bumps both write old + 1 and one
 * is lost.
 */
export const bumpEditionRevision = async (em: EntityManager, edition: Edition): Promise<void> => {
    await em.flush();
    await em.execute(
        'insert into "edition_revision" ("edition_id", "revision") values (?, 1)' +
            ' on conflict ("edition_id") do update set "revision" = "edition_revision"."revision" + 1',
        [edition.id],
    );
};
