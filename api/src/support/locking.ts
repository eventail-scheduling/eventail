/**
 * The lock order every write transaction follows, kept so that no two can deadlock.
 *
 *   edition (any mode) -> schedules -> session, slot, track and session type
 *   rows -> the rows hanging off a session, invites among them -> user rows ->
 *   host rows and their session_hosts pivots -> custom fields -> answers ->
 *   pending_upload rows, claimed in key order -> the edition_revision counter
 *   row, always last, taken by bumpEditionRevision after its flush.
 *
 * The edition leads because it is the only row every writer below it shares.
 * A handler that reaches an edition's rows without holding it can be halfway
 * through the tree when a delete of that edition arrives, and the two then
 * meet somewhere in the middle. Where a level is reachable only through the
 * rows below it, an unlocked read finds it first: acceptInviteHandler, the
 * user purge and the user sweeper resolve what to lock that way.
 *
 * Invites follow their session rather than leading it, because the cascade
 * from a deleted session takes them and a cascade cannot be reordered. That
 * settles the direction for every handler that touches both, including
 * acceptance, which reaches the invite by its code and has to read it unlocked
 * first to learn which session to take. Answers and host pivots hang off a
 * session too, but sit later for the same reason: deleting a custom field
 * cascades into its answers, and deleting a user cascades through the host
 * into its pivots.
 *
 * Teams sit outside all of this on a second order of their own:
 *
 *   team (any mode) -> team_invite and team_users rows
 *
 * with the same reasoning as the edition, and the same cascade forcing the
 * same direction. The two orders meet only in the user purge, which takes
 * both kinds of invite before the user rows they belong to.
 *
 * A transaction may skip levels but never lock backward across them. Six
 * edges of the order are implicit, taken by Postgres rather than by any
 * statement in a handler, which makes them easy to violate unknowingly:
 *
 * - An INSERT carrying an edition foreign key takes FOR KEY SHARE on the
 *   edition row at flush time, at the end of the transaction. A handler that
 *   inserts such a row while holding later-level locks calls pinEdition
 *   first, acquiring the same lock at the start instead, where the order
 *   demands it. FOR KEY SHARE is shared, so writers never wait on each other
 *   here; they wait only on the writers that take the edition exclusively,
 *   which they would have done at flush time anyway. acceptInviteHandler
 *   takes FOR UPDATE outright instead: its locking populate upgrades the
 *   edition to it regardless, and an upgrade behind a waiting publish
 *   deadlocks.
 * - ON DELETE SET NULL takes an update lock on every referencing row in the
 *   middle of the DELETE. A handler whose delete cascades that way locks the
 *   referencing rows itself, before the row being deleted and in id order,
 *   so its order agrees with the writers that lock a referencing row first.
 * - ON DELETE CASCADE reaches its referencing rows at the end of the DELETE.
 *   A handler that clears one level and then deletes a row whose cascade
 *   reaches an earlier level holds the later level against the earlier one,
 *   which is backward. It takes the earlier level itself, before the
 *   clearing.
 * - A foreign key written with no ON DELETE clause is NO ACTION, and its
 *   check takes FOR KEY SHARE on every referencing row in the middle of the
 *   parent's DELETE. Deleting a session_type or a location reaches sessions
 *   and slots that way, and deleting a venue reaches locations, at a point no
 *   statement in the handler names. The venue delete holds only the edition
 *   key share, so it takes locations in the opposite order to an update that
 *   repoints one; the two stay apart only because MikroORM writes no venue_id
 *   when the reference is unchanged.
 * - An UPDATE or INSERT setting a session's type or track takes FOR KEY SHARE
 *   on that row at flush, after the session write's share lock on the custom
 *   fields, and after a self-service create's user row and any pending upload
 *   claims, which is backward. It stays safe only while nothing that holds a
 *   track or session type in a mode conflicting with a key share waits on a
 *   custom field, a user row or a pending upload. pinScope takes a key share
 *   for the custom field half. The track and session type deletes, the
 *   promotion to default and an update that sets internal to true take the edition
 *   exclusively first, which keeps them apart from the rest; any other update
 *   holds only its own row and waits on nothing after it but the counter.
 * - A deferred unique constraint is checked at COMMIT, after even the counter
 *   row this order calls last. custom_field.position, location.position and
 *   venue.position are all deferred, and every writer that appends to or
 *   renumbers any of them holds
 *   the edition FOR UPDATE first, so no second writer is ever in flight to
 *   collide with. A shared lock is not enough: two appends under one would read
 *   the same highest position and only find out at COMMIT, where a deferred
 *   violation arrives as a raw constraint error.
 *
 * One more is taken by MikroORM: a find carries its lockMode into its
 * populate, which locks every row it loads, the pivot rows and their targets
 * for a many-to-many collection. Locking a custom field that way locks its
 * tracks and session types, which sit ahead of custom fields: a track delete
 * holds the track, then cascades into the scoping pivots, so a populate that
 * took those pivots and then wants the track would close a cycle with it, were
 * the edition not held first by both. Locking a session locks its host rows,
 * which a profile save writes only after taking the user row, while an invite
 * takes that user row after the session. So a locking find populates only rows
 * it holds already or that hang off it, as the invite acceptance and the
 * location update do, and loads anything else afterwards with em.populate,
 * which takes no lock.
 *
 * MikroORM's flush adds one more. A row a handler changes without locking it is
 * locked only when the change is flushed, which can come after locks the
 * handler takes later in its code. Host rows and answers land late that way: a
 * profile save that sends answers and changes a host attribute writes the host
 * row after its share lock on the custom fields, and a write that claims an
 * upload writes the host row, or an existing answer it changes, after the
 * claim. Each stays safe only while nothing that holds the host row or the
 * answer waits on that custom field in a mode conflicting with a share, or on
 * that pending upload.
 *
 * A create that inserts an edition child while holding no other lock needs no
 * pin: a transaction acquiring a single lock cannot be part of a cycle.
 *
 * Availability hangs off a host or a location rather than the edition, so its
 * foreign key pins that row and never the edition, and an edition write
 * settling it holds nothing that would stop a writer arriving mid-settle.
 * Anything writing availability takes the edition first, which is what the
 * settle already holds, and is why it reads those rows without locking them
 * itself.
 *
 * One residual sits below the order's resolution: two multi-row statements
 * locking overlapping row sets inside one level (a cascade's deletes against
 * a sweep) acquire in their plans' orders. Explicit sweeps order by id; a
 * cascade cannot be ordered, and the collision is tolerated as a loud,
 * retryable failure.
 *
 * Two things underneath all of this can change without a handler changing.
 * Postgres fires a cascade's triggers in the order of their names, which
 * follows the order the constraints were created while the ids in those names
 * keep one width, and that is the order the generated migration happens to
 * write them, which regenerating it can change. Two deletes run against the
 * user purge without deadlocking only because of that order: a session's
 * cascade reaches its invites before its host pivot rows, and a team's reaches
 * its invites before its membership rows. And the unit of work flushes inserts
 * before deletes whatever order the handler wrote them in, except where the
 * two collide on a unique property, which promotes the delete ahead of the
 * insert.
 *
 * Every helper below but takeEdition selects rather than loads. A locking find
 * would hydrate what it locks into the identity map, where a partial entity
 * waits to be mistaken for a whole one, and would read at the call site as
 * though the rows were wanted rather than the locks. takeEdition loads because
 * both are false of it: its callers want the edition, and a whole row read
 * under its own lock is the current one.
 */

import { type EntityManager, LockMode } from "@mikro-orm/postgresql";
import { Edition } from "../entity/Edition.js";
import type { Team } from "../entity/Team.js";
import { assertExists } from "../util/helpers.js";

type TakeEditionOptions = {
    /**
     * Exclusive rather than shared, where a writer reads its rule before writing.
     *
     * An append under a deferred unique reads the highest position, and a publish
     * reads whether a final publication exists. Two of either under a shared lock
     * would both pass their check.
     */
    mode?: LockMode.PESSIMISTIC_READ | LockMode.PESSIMISTIC_WRITE;
    /** Reloads rather than trusting a copy read before this lock was taken. */
    refresh?: boolean;
};

/** Takes the edition lock leading the order, and hands the row back. */
export const takeEdition = async (
    em: EntityManager,
    editionId: string,
    { mode = LockMode.PESSIMISTIC_READ, refresh = false }: TakeEditionOptions = {},
): Promise<Edition> => {
    const edition = await em.findOne(Edition, editionId, { lockMode: mode, refresh });
    assertExists(edition, "Edition", editionId);

    return edition;
};

export const pinEdition = async (em: EntityManager, edition: Edition): Promise<void> => {
    await em.execute('select 1 from "edition" where "id" = ? for key share', [edition.id]);
};

/** Takes the same key share edge on the team order, where a team stands in for the edition. */
export const pinTeam = async (em: EntityManager, team: Team): Promise<void> => {
    await em.execute('select 1 from "team" where "id" = ? for key share', [team.id]);
};

export const lockEditions = async (em: EntityManager, editionIds: string[]): Promise<void> => {
    if (editionIds.length === 0) {
        return;
    }

    await em.execute('select 1 from "edition" where "id" in (?) order by "id" asc for update', [
        editionIds,
    ]);
};

/**
 * Pins the session types and tracks a custom field update is about to scope it to.
 *
 * Takes up front the key shares the update's scoping inserts would otherwise
 * take at flush, after its lock on the custom field, where the order puts
 * session types and tracks first. Only a key share: a session write holds its
 * share lock on the custom fields before its foreign key takes a key share on
 * its type or track at flush, so any lock here that conflicts with that, held
 * while this write waits on the custom field, closes a cycle with it.
 */
export const pinScope = async (
    em: EntityManager,
    edition: Edition,
    sessionTypeIds: string[],
    trackIds: string[],
): Promise<void> => {
    if (sessionTypeIds.length > 0) {
        await em.execute(
            'select 1 from "session_type" where "edition_id" = ? and "id" in (?)' +
                ' order by "id" asc for key share',
            [edition.id, sessionTypeIds],
        );
    }

    if (trackIds.length > 0) {
        await em.execute(
            'select 1 from "track" where "edition_id" = ? and "id" in (?)' +
                ' order by "id" asc for key share',
            [edition.id, trackIds],
        );
    }
};

export const lockEditionSchedules = async (em: EntityManager, edition: Edition): Promise<void> => {
    await em.execute(
        'select 1 from "schedule" where "edition_id" = ? order by "id" asc for update',
        [edition.id],
    );
};

/**
 * The users a transaction is about to delete, and for a purge the address too.
 *
 * The address reaches invites to it, which reference no user.
 */
export type UserDeletionScope = {
    userIds: readonly string[];
    emailAddress: string | null;
};

export type UserDeletionTargets = {
    transitionIds: string[];
    sessionInviteIds: string[];
    teamInviteIds: string[];
};

/**
 * Reads the editions deleting these users reaches, without locking them.
 *
 * Their host rows, and the sessions holding a transition they made or an
 * invite they sent or, for a purge, sent to the address. The read cannot be
 * locked: the editions are only known through those rows, and locking on the
 * way to them would take the rows ahead of the edition.
 */
export const readUserDeletionEditionIds = async (
    em: EntityManager,
    { userIds, emailAddress }: UserDeletionScope,
): Promise<Set<string>> => {
    const parts: string[] = [];
    const bindings: unknown[] = [];

    if (userIds.length > 0) {
        parts.push(
            'select "edition_id" from "host" where "user_id" in (?)',
            'select "session"."edition_id" from "session_transition"' +
                ' inner join "session" on "session"."id" = "session_transition"."session_id"' +
                ' where "session_transition"."actor_id" in (?)',
            'select "session"."edition_id" from "session_host_invite"' +
                ' inner join "session" on "session"."id" = "session_host_invite"."session_id"' +
                ' where "session_host_invite"."created_by_id" in (?)',
        );
        bindings.push(userIds, userIds, userIds);
    }

    if (emailAddress !== null) {
        parts.push(
            'select "session"."edition_id" from "session_host_invite"' +
                ' inner join "session" on "session"."id" = "session_host_invite"."session_id"' +
                ' where "session_host_invite"."email_address" = ?',
        );
        bindings.push(emailAddress);
    }

    if (parts.length === 0) {
        return new Set();
    }

    const rows = await em.execute<{ edition_id: string }[]>(parts.join(" union "), bindings);

    return new Set(rows.map((row) => row.edition_id));
};

const selectUserDeletionTargets = async (
    em: EntityManager,
    { userIds, emailAddress }: UserDeletionScope,
    lockClause: "" | " for update",
): Promise<UserDeletionTargets> => {
    const teamInvites =
        emailAddress === null
            ? []
            : await em.execute<{ id: string }[]>(
                  `select "id" from "team_invite" where "email_address" = ? order by "id" asc${lockClause}`,
                  [emailAddress],
              );
    const transitions =
        userIds.length === 0
            ? []
            : await em.execute<{ id: string }[]>(
                  `select "id" from "session_transition" where "actor_id" in (?) order by "id" asc${lockClause}`,
                  [userIds],
              );
    const inviteConditions: string[] = [];
    const inviteBindings: unknown[] = [];

    if (emailAddress !== null) {
        inviteConditions.push('"email_address" = ?');
        inviteBindings.push(emailAddress);
    }

    if (userIds.length > 0) {
        inviteConditions.push('"created_by_id" in (?)');
        inviteBindings.push(userIds);
    }

    const sessionInvites =
        inviteConditions.length === 0
            ? []
            : await em.execute<{ id: string }[]>(
                  `select "id" from "session_host_invite" where ${inviteConditions.join(" or ")} order by "id" asc${lockClause}`,
                  inviteBindings,
              );

    return {
        transitionIds: transitions.map((row) => row.id),
        sessionInviteIds: sessionInvites.map((row) => row.id),
        teamInviteIds: teamInvites.map((row) => row.id),
    };
};

/**
 * Locks the rows a user delete would set null on, and a purge's address invites.
 *
 * Deleting a user sets null on the transitions they made and the session
 * invites they sent, which would lock those rows mid-DELETE, after the user
 * row and so backward. A purge also takes the team and session invites to its
 * address here, which it deletes itself. The caller locks the editions
 * `readUserDeletionEditionIds` found first, so an edition delete cascading
 * into these rows queues on the edition instead, and locks the users after.
 * The scope is as read before any of that, so the caller has to check, once it
 * holds the users, that what it locked still covers what they reach.
 */
export const lockUserDeletionTargets = async (
    em: EntityManager,
    scope: UserDeletionScope,
): Promise<UserDeletionTargets> => selectUserDeletionTargets(em, scope, " for update");

const coversIds = (locked: readonly string[], read: readonly string[]): boolean =>
    read.every((id) => locked.includes(id));

/**
 * Says whether what was locked before the users still covers the scope's reach.
 *
 * Takes the scope as held, once the users are locked. Nothing new can
 * reference them from then on, so without an address a true answer stays
 * true; an invite to an address can still arrive after it.
 */
export const coversUserDeletionReach = async (
    em: EntityManager,
    scope: UserDeletionScope,
    lockedEditionIds: ReadonlySet<string>,
    lockedTargets: UserDeletionTargets,
): Promise<boolean> => {
    const reachedEditionIds = await readUserDeletionEditionIds(em, scope);

    if (!coversIds([...lockedEditionIds], [...reachedEditionIds])) {
        return false;
    }

    const read = await selectUserDeletionTargets(em, scope, "");

    return (
        coversIds(lockedTargets.transitionIds, read.transitionIds) &&
        coversIds(lockedTargets.sessionInviteIds, read.sessionInviteIds) &&
        coversIds(lockedTargets.teamInviteIds, read.teamInviteIds)
    );
};

export const lockTrackSessions = async (
    em: EntityManager,
    editionId: string,
    trackId: string,
): Promise<void> => {
    await em.execute(
        'select 1 from "session" where "edition_id" = ? and "track_id" = ?' +
            ' order by "id" asc for update',
        [editionId, trackId],
    );
};
