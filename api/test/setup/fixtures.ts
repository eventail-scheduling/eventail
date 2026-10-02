import type { EntityManager } from "@mikro-orm/core";
import { ref } from "@mikro-orm/core";
import { Edition } from "../../src/entity/Edition.js";
import { Host } from "../../src/entity/Host.js";
import { Location } from "../../src/entity/Location.js";
import { Schedule } from "../../src/entity/Schedule.js";
import { Session, type SessionState } from "../../src/entity/Session.js";
import { SessionType } from "../../src/entity/SessionType.js";
import { Team, type TeamRole } from "../../src/entity/Team.js";
import { User } from "../../src/entity/User.js";
import { Venue } from "../../src/entity/Venue.js";

type EditionValues = ConstructorParameters<typeof Edition>[0];
type VenueValues = ConstructorParameters<typeof Venue>[0];

export const editionVersion = async (em: EntityManager, editionId: string): Promise<number> =>
    (await em.fork().findOneOrFail(Edition, editionId)).version;

export const buildEdition = (overrides: Partial<EditionValues> = {}): Edition =>
    new Edition({
        name: "Test Edition",
        startDate: Temporal.PlainDate.from("2027-10-01"),
        endDate: Temporal.PlainDate.from("2027-10-03"),
        timeZone: "Europe/Berlin",
        submissionDeadline: null,
        ...overrides,
    });

type EditionDates = {
    startDate: string;
    endDate: string;
};

type FallBackWeek = EditionDates & {
    movedTo: EditionDates;
};

/**
 * Edition dates across the night the clocks go back in Europe/Berlin, and a week to move them to.
 *
 * 02:00 comes around twice on 2027-10-31, so two instants an hour apart can
 * share a wall-clock time there. The later week has only one 02:00, and moving
 * the edition onto it lands both in the same hour.
 */
export const fallBackWeek: FallBackWeek = {
    startDate: "2027-10-30",
    endDate: "2027-11-01",
    movedTo: { startDate: "2027-11-06", endDate: "2027-11-08" },
};

type SessionValues = ConstructorParameters<typeof Session>[0];

/**
 * Builds an unsaved session, its uuidv7 id assigned as it is constructed.
 *
 * Construction order therefore fixes id order, and the session list routes
 * serve the newest id first, so the last one built comes first.
 */
export const buildSession = (
    edition: Edition,
    sessionType: SessionType,
    overrides: Partial<SessionValues> = {},
): Session =>
    new Session({
        title: "Test Session",
        abstract: "",
        description: "",
        notes: "",
        duration: null,
        setupTime: null,
        teardownTime: null,
        teaserImage: null,
        edition: ref(edition),
        sessionType: ref(sessionType),
        track: null,
        ...overrides,
    });

type HostValues = ConstructorParameters<typeof Host>[0];

export const buildHost = (
    edition: Edition,
    user: User,
    overrides: Partial<Omit<HostValues, "edition" | "user">> = {},
): Host =>
    new Host({
        displayName: user.displayName,
        emailAddress: user.emailAddress,
        biography: "",
        edition: ref(edition),
        user: ref(user),
        ...overrides,
    });

/**
 * Reaches the host row without the user lock resolveHost() takes.
 *
 * A plain fork cannot lock outside a transaction, so tests that only need the
 * row use this instead.
 */
export const findOrBuildHost = async (
    em: EntityManager,
    edition: Edition,
    user: User,
): Promise<Host> => {
    const existing = await em.findOne(Host, { edition, user });

    if (existing) {
        return existing;
    }

    const host = buildHost(edition, user);
    em.persist(host);

    return host;
};

type SuperAdminOverrides = Partial<Pick<User, "displayName" | "emailAddress">>;

/**
 * Builds the user row for the mock `admin` subject, whose token carries the superadmin claim.
 *
 * The claim only lifts the role check once a row exists for that subject, so a
 * test authenticating as `admin` needs one even when it grants no team.
 */
export const buildSuperAdmin = (overrides: SuperAdminOverrides = {}): User =>
    new User({
        externalId: "admin",
        displayName: overrides.displayName ?? "Super Admin",
        emailAddress: overrides.emailAddress ?? "superadmin@example.test",
    });

type TeamMember = {
    user: User;
    team: Team;
};

type TeamMemberOverrides = Partial<
    Pick<User, "displayName" | "emailAddress"> & { teamName: string }
>;

export const buildTeamMember = (
    externalId: string,
    role: TeamRole,
    overrides: TeamMemberOverrides = {},
): TeamMember => {
    const user = new User({
        externalId,
        displayName: overrides.displayName ?? `Test ${externalId}`,
        emailAddress: overrides.emailAddress ?? `${externalId}@example.test`,
    });
    const team = new Team({ name: overrides.teamName ?? `${role} team`, role });
    team.users.add(user);

    return { user, team };
};

export type ScheduleFixture = {
    editionId: string;
    scheduleId: string;
    sessionId: string;
    locationId: string;
    venueId: string;
};

export type ScheduleFixtureOptions = {
    name: string;
    sessionState?: SessionState;
    startDate?: string;
    endDate?: string;
    timeZone?: string;
};

export const buildVenue = (edition: Edition, overrides: Partial<VenueValues> = {}): Venue =>
    new Venue({
        position: 0,
        name: "Main Venue",
        address: null,
        externalKey: null,
        edition: ref(edition),
        ...overrides,
    });

/**
 * Persists an edition with one session, one location and one unpublished schedule.
 *
 * The session is accepted unless `sessionState` says otherwise.
 */
export const buildScheduleFixture = async (
    em: EntityManager,
    {
        name,
        sessionState = "accepted",
        startDate = "2027-11-01",
        endDate = "2027-11-03",
        timeZone = "Europe/Berlin",
    }: ScheduleFixtureOptions,
): Promise<ScheduleFixture> => {
    const fork = em.fork();
    const edition = buildEdition({
        name,
        startDate: Temporal.PlainDate.from(startDate),
        endDate: Temporal.PlainDate.from(endDate),
        timeZone,
    });
    const sessionType = SessionType.default(ref(edition));
    const session = buildSession(edition, sessionType, { title: `${name} Session` });
    session.state = sessionState;
    const venue = buildVenue(edition);
    const location = new Location({
        position: 0,
        name: "Main Hall",
        externalKey: null,
        edition: ref(edition),
        venue: ref(venue),
    });
    const schedule = new Schedule({ edition: ref(edition), sequence: 1 });

    await fork.persist([edition, sessionType, session, venue, location, schedule]).flush();

    return {
        editionId: edition.id,
        scheduleId: schedule.id,
        sessionId: session.id,
        locationId: location.id,
        venueId: venue.id,
    };
};
