import { ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { Seeder } from "@mikro-orm/seeder";
import { CustomField } from "../entity/CustomField.js";
import { Edition } from "../entity/Edition.js";
import { Host } from "../entity/Host.js";
import { HostAvailability } from "../entity/HostAvailability.js";
import { Location } from "../entity/Location.js";
import { LocationAvailability } from "../entity/LocationAvailability.js";
import { Response } from "../entity/Response.js";
import { Schedule } from "../entity/Schedule.js";
import { Session } from "../entity/Session.js";
import { SessionType } from "../entity/SessionType.js";
import { Slot } from "../entity/Slot.js";
import { Team } from "../entity/Team.js";
import { Track } from "../entity/Track.js";
import { User } from "../entity/User.js";

/** Fixes an id so a reseed keeps every bookmarked URL working. */
const withId = <TEntity extends { id: string }>(entity: TEntity, id: string): TEntity => {
    (entity as { id: string }).id = id;
    return entity;
};

/** Builds a uuidv7-shaped id, so it sorts the way a generated one would. */
const seedId = (segment: string, index: number): string =>
    `01a00${segment}-0000-7000-8000-${index.toString().padStart(12, "0")}`;

/** Anchors a wall clock time to one of the edition's days, which is how a program reads. */
const wallClockAt = (edition: Edition, dayOffset: number, time: string): Temporal.Instant =>
    edition.startDate
        .add({ days: dayOffset })
        .toZonedDateTime({
            timeZone: edition.timeZone,
            plainTime: Temporal.PlainTime.from(time),
        })
        .toInstant();

type SeededEdition = {
    edition: Edition;
    schedule: Schedule;
};

type SeededPeople = {
    host: User;
    speaker: User;
};

type SeededSessionTypes = {
    talk: SessionType;
    workshop: SessionType;
    breakType: SessionType;
};

type SeededTracks = {
    mainTrack: Track;
    communityTrack: Track;
};

type SeededLocations = {
    mainHall: Location;
    sideRoom: Location;
    workshopRoom: Location;
    lab: Location;
    atriumStage: Location;
    quietRoom: Location;
};

type SeededCustomFields = {
    equipment: CustomField;
    recording: CustomField;
    dietary: CustomField;
    topics: CustomField;
    arrival: CustomField;
};

type SeedContext = {
    edition: Edition;
    schedule: Schedule;
    locations: SeededLocations;
    talk: SessionType;
    workshop: SessionType;
    breakType: SessionType;
    mainTrack: Track;
    communityTrack: Track;
    host: User;
    speaker: User;
    speakerHost: Host;
    sessionHosts: [Host, Host];
};

type SessionValues = {
    title: string;
    sessionType: SessionType;
    track: Track | null;
};

export class DevSeeder extends Seeder {
    public async run(em: EntityManager): Promise<void> {
        const { edition, schedule } = this.createEdition(em);
        this.createNeighboringEditions(em);
        this.createHalfHourEdition(em);
        const { host, speaker } = this.createPeople(em);
        const { talk, workshop, breakType } = this.createSessionTypes(em, edition);
        const { mainTrack, communityTrack } = this.createTracks(em, edition);
        const locations = this.createLocations(em, edition);
        const [organizerHost, speakerHost] = this.createHosts(em, edition, [host, speaker]);
        this.createHostAvailability(em, edition, [organizerHost, speakerHost]);

        const context: SeedContext = {
            edition,
            schedule,
            talk,
            workshop,
            breakType,
            mainTrack,
            communityTrack,
            locations,
            host,
            speaker,
            speakerHost,
            sessionHosts: [organizerHost, speakerHost],
        };

        const customFields = this.createCustomFields(em, context);
        this.createSessions(em, context, customFields);
        this.createProgram(em, context);

        return Promise.resolve();
    }

    private createEdition(em: EntityManager): SeededEdition {
        const edition = withId(
            new Edition({
                name: "Dev Edition",
                startDate: Temporal.Now.plainDateISO().add({ days: 90 }),
                endDate: Temporal.Now.plainDateISO().add({ days: 92 }),
                timeZone: "Europe/Berlin",
                submissionDeadline: Temporal.Now.zonedDateTimeISO().add({ days: 60 }).toInstant(),
                sessionFieldOptions: {
                    title: {},
                    abstract: { requirement: "required" },
                    description: { requirement: "optional" },
                    notes: { requirement: "optional" },
                    track: { requirement: "optional" },
                    duration: { requirement: "optional" },
                    teaserImage: { requirement: "optional" },
                },
                profileFieldOptions: {
                    displayName: {},
                    emailAddress: {},
                    avatar: { requirement: "optional" },
                    // Required so the incomplete_profile refusal is reachable
                    // without editing an edition by hand first. The hosts below
                    // are seeded with one, so only a host created later, by an
                    // invite or a first submission, meets the gate.
                    biography: { requirement: "required" },
                    availability: { requirement: "optional" },
                },
            }),
            seedId("100", 1),
        );

        const schedule = withId(
            new Schedule({ edition: ref(edition), sequence: 1 }),
            seedId("110", 1),
        );

        em.persist([edition, schedule]);

        return { edition, schedule };
    }

    /**
     * Gives the landing page one edition per group.
     *
     * Without them the running and past groupings are not reachable at all.
     */
    private createNeighboringEditions(em: EntityManager): void {
        const today = Temporal.Now.plainDateISO();

        const running = withId(
            new Edition({
                name: "Dev Edition (running)",
                startDate: today.subtract({ days: 1 }),
                endDate: today.add({ days: 1 }),
                timeZone: "Europe/Berlin",
                submissionDeadline: null,
                sessionFieldOptions: {},
            }),
            seedId("100", 2),
        );

        const past = withId(
            new Edition({
                name: "Dev Edition (past)",
                startDate: today.subtract({ days: 275 }),
                endDate: today.subtract({ days: 273 }),
                timeZone: "Europe/Berlin",
                submissionDeadline: Temporal.Now.zonedDateTimeISO()
                    .subtract({ days: 305 })
                    .toInstant(),
                sessionFieldOptions: {},
            }),
            seedId("100", 3),
        );

        em.persist([
            running,
            past,
            withId(new Schedule({ edition: ref(running), sequence: 1 }), seedId("110", 2)),
            withId(new Schedule({ edition: ref(past), sequence: 1 }), seedId("110", 3)),
            withId(SessionType.default(ref(running)), seedId("400", 3)),
            withId(SessionType.default(ref(past)), seedId("400", 4)),
        ]);
    }

    /**
     * Seeds the one edition whose axis is not a whole number of hours.
     *
     * Lord Howe moves its clocks by half an hour rather than a whole one, and
     * 2027-04-04 is one of the days it does, so the middle column carries a row
     * the other two lack and holds only half of it. Nowhere else in the seed
     * exercises such an axis.
     */
    private createHalfHourEdition(em: EntityManager): void {
        const edition = withId(
            new Edition({
                name: "Dev Edition (half hour clocks)",
                startDate: Temporal.PlainDate.from("2027-04-03"),
                endDate: Temporal.PlainDate.from("2027-04-05"),
                timeZone: "Australia/Lord_Howe",
                submissionDeadline: null,
                sessionFieldOptions: {},
            }),
            seedId("100", 4),
        );

        em.persist([
            edition,
            withId(new Schedule({ edition: ref(edition), sequence: 1 }), seedId("110", 4)),
            withId(SessionType.default(ref(edition)), seedId("400", 5)),
            withId(
                new Location({
                    name: "Lagoon Room",
                    externalKey: "lagoon-room",
                    position: 0,
                    edition: ref(edition),
                }),
                seedId("600", 3),
            ),
        ]);
    }

    /**
     * Matches external ids to the mock OIDC subjects in dev/oidc/config.json.
     *
     * Every sign-in then lands on an account that already has its access.
     */
    private createPeople(em: EntityManager): SeededPeople {
        const admin = withId(
            new User({
                externalId: "admin",
                displayName: "Dev Admin",
                emailAddress: "admin@example.test",
            }),
            seedId("200", 1),
        );
        const manager = withId(
            new User({
                externalId: "testuser",
                displayName: "Dev Manager",
                emailAddress: "manager@example.test",
            }),
            seedId("200", 2),
        );
        const host = withId(
            new User({
                externalId: "testhost",
                displayName: "Dev Host",
                emailAddress: "host@example.test",
            }),
            seedId("200", 3),
        );
        const speaker = withId(
            new User({
                externalId: "speaker",
                displayName: "Dev Speaker",
                emailAddress: "speaker@example.test",
            }),
            seedId("200", 4),
        );
        const reviewer = withId(
            new User({
                externalId: "reviewer",
                displayName: "Dev Reviewer",
                emailAddress: "reviewer@example.test",
            }),
            seedId("200", 5),
        );

        const adminTeam = withId(new Team({ name: "Admins", role: "admin" }), seedId("300", 1));
        const organizerTeam = withId(
            new Team({ name: "Organizers", role: "manager" }),
            seedId("300", 2),
        );
        const reviewerTeam = withId(
            new Team({ name: "Reviewers", role: "viewer" }),
            seedId("300", 3),
        );

        adminTeam.users.add(admin);
        organizerTeam.users.add(manager);
        reviewerTeam.users.add(reviewer);

        em.persist([
            admin,
            manager,
            host,
            speaker,
            reviewer,
            adminTeam,
            organizerTeam,
            reviewerTeam,
        ]);

        return { host, speaker };
    }

    private createHosts(em: EntityManager, edition: Edition, users: [User, User]): [Host, Host] {
        const hosts = users.map((user, index) =>
            withId(
                new Host({
                    displayName: user.displayName,
                    emailAddress: user.emailAddress,
                    biography: `${user.displayName} has presented at a handful of these before.`,
                    edition: ref(edition),
                    user: ref(user),
                }),
                seedId("210", index + 1),
            ),
        );
        em.persist(hosts);

        return [hosts[0], hosts[1]];
    }

    /**
     * Gives the two hosts free time the seeded program does not entirely fit into.
     *
     * Every seeded session carries both hosts, so shading where either is
     * unavailable shows nothing unless the two disagree.
     */
    private createHostAvailability(em: EntityManager, edition: Edition, hosts: [Host, Host]): void {
        const [organizer, speaker] = hosts;
        const windows = [
            { host: organizer, day: 0, from: "08:00", to: "18:00" },
            { host: organizer, day: 1, from: "08:00", to: "18:00" },
            { host: organizer, day: 2, from: "08:00", to: "12:00" },

            { host: speaker, day: 0, from: "08:00", to: "18:00" },
            { host: speaker, day: 1, from: "08:00", to: "10:00" },
            { host: speaker, day: 1, from: "13:00", to: "18:00" },
            { host: speaker, day: 2, from: "08:00", to: "18:00" },
        ];

        em.persist(
            windows.map((window, index) =>
                withId(
                    new HostAvailability({
                        startsAt: wallClockAt(edition, window.day, window.from),
                        endsAt: wallClockAt(edition, window.day, window.to),
                        host: ref(window.host),
                    }),
                    seedId("220", index + 1),
                ),
            ),
        );
    }

    private createSessionTypes(em: EntityManager, edition: Edition): SeededSessionTypes {
        const talk = withId(
            new SessionType({
                name: "Talk",
                externalKey: "talk",
                defaultDuration: Temporal.Duration.from({ minutes: 30 }),
                internal: false,
                selectionDefault: true,
                edition: ref(edition),
            }),
            seedId("400", 1),
        );
        const workshop = withId(
            new SessionType({
                name: "Workshop",
                externalKey: "workshop",
                defaultDuration: Temporal.Duration.from({ minutes: 90 }),
                internal: false,
                selectionDefault: false,
                edition: ref(edition),
            }),
            seedId("400", 2),
        );

        const breakType = withId(
            new SessionType({
                name: "Break",
                externalKey: "break",
                defaultDuration: Temporal.Duration.from({ minutes: 30 }),
                internal: true,
                selectionDefault: false,
                edition: ref(edition),
            }),
            seedId("400", 6),
        );

        em.persist([talk, workshop, breakType]);

        return { talk, workshop, breakType };
    }

    private createTracks(em: EntityManager, edition: Edition): SeededTracks {
        const mainTrack = withId(
            new Track({
                name: "Main",
                externalKey: "main",
                description: "The main program",
                color: "#3f51b5",
                internal: false,
                edition: ref(edition),
            }),
            seedId("500", 1),
        );
        const communityTrack = withId(
            new Track({
                name: "Community",
                externalKey: "community",
                description: "Community submissions",
                color: "#009688",
                internal: false,
                edition: ref(edition),
            }),
            seedId("500", 2),
        );

        em.persist([mainTrack, communityTrack]);

        return { mainTrack, communityTrack };
    }

    /**
     * Creates six rooms, two of which keep opening hours.
     *
     * A room with none is open throughout, so without these the grid has no
     * closed time to draw. The two shapes read differently, which is why there
     * are two.
     */
    private createLocations(em: EntityManager, edition: Edition): SeededLocations {
        const mainHall = withId(
            new Location({
                name: "Main Hall",
                externalKey: "main-hall",
                position: 0,
                edition: ref(edition),
            }),
            seedId("600", 1),
        );
        const sideRoom = withId(
            new Location({
                name: "Side Room",
                externalKey: "side-room",
                position: 1,
                edition: ref(edition),
            }),
            seedId("600", 2),
        );

        const extras = [
            { name: "Workshop Room", externalKey: "workshop-room" },
            { name: "Lab", externalKey: "lab" },
            { name: "Atrium Stage", externalKey: "atrium-stage" },
            { name: "Quiet Room", externalKey: "quiet-room" },
        ].map((values, index) =>
            withId(
                new Location({
                    ...values,
                    position: index + 2,
                    edition: ref(edition),
                }),
                seedId("600", index + 4),
            ),
        );

        const [workshopRoom, lab, atriumStage, quietRoom] = extras;
        const availabilities = [
            ...[0, 1, 2].map((day) => ({ location: lab, day, from: "09:00", to: "17:00" })),
            ...[0, 1].map((day) => ({ location: quietRoom, day, from: "09:00", to: "18:00" })),
        ].map((window, index) =>
            withId(
                new LocationAvailability({
                    startsAt: wallClockAt(edition, window.day, window.from),
                    endsAt: wallClockAt(edition, window.day, window.to),
                    location: ref(window.location),
                }),
                seedId("610", index + 1),
            ),
        );

        em.persist([mainHall, sideRoom, ...extras, ...availabilities]);

        return { mainHall, sideRoom, workshopRoom, lab, atriumStage, quietRoom };
    }

    /**
     * Seeds one field per response type.
     *
     * Every branch of the custom field form then has something to render.
     */
    private createCustomFields(em: EntityManager, context: SeedContext): SeededCustomFields {
        const experience = withId(
            new CustomField({
                position: 0,
                title: "Speaker experience",
                helperText: "Roughly how many talks have you given before?",
                externalKey: "speaker-experience",
                target: "per_host",
                requirement: "always_optional",
                options: { type: "number", min: 0 },
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 1),
        );
        const dietary = withId(
            new CustomField({
                position: 1,
                title: "Dietary requirements",
                helperText: "",
                externalKey: "dietary",
                target: "per_host",
                requirement: "always_optional",
                options: {
                    type: "single_choice",
                    items: [
                        { id: seedId("710", 1), label: "No requirements" },
                        { id: seedId("710", 2), label: "Vegetarian" },
                        { id: seedId("710", 3), label: "Vegan" },
                    ],
                },
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(context.edition),
            }),
            seedId("700", 2),
        );
        const arrival = withId(
            new CustomField({
                position: 2,
                title: "Arrival date",
                helperText: "",
                externalKey: "arrival",
                target: "per_host",
                requirement: "always_optional",
                options: { type: "date" },
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(context.edition),
            }),
            seedId("700", 8),
        );
        const pronouns = withId(
            new CustomField({
                position: 3,
                title: "Pronouns",
                helperText: "Shown beside your name in the program",
                externalKey: "pronouns",
                target: "per_host",
                requirement: "always_optional",
                options: { type: "single_line_text", maxLength: 40 },
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 9),
        );

        const equipment = withId(
            new CustomField({
                position: 0,
                title: "Equipment needed",
                helperText: "Anything beyond a projector and a microphone",
                externalKey: "equipment",
                target: "per_proposal",
                requirement: "required_after_deadline",
                options: { type: "multi_line_text", maxLength: 500 },
                deadline: context.edition.submissionDeadline,
                freezeAfter: context.edition.submissionDeadline?.add({ hours: 24 * 14 }) ?? null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 3),
        );
        const recording = withId(
            new CustomField({
                position: 1,
                title: "May we record this session?",
                helperText: "",
                externalKey: "recording",
                target: "per_proposal",
                requirement: "always_required",
                options: { type: "boolean" },
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 4),
        );
        const materials = withId(
            new CustomField({
                position: 2,
                title: "Materials link",
                helperText: "Where attendees can find the workshop material",
                externalKey: "materials",
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "url" },
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 5),
        );
        materials.sessionTypes.add(context.workshop);

        const topics = withId(
            new CustomField({
                position: 3,
                title: "Topics covered",
                helperText: "Pick every topic that applies",
                externalKey: "topics",
                target: "per_proposal",
                requirement: "always_optional",
                options: {
                    type: "multiple_choice",
                    items: [
                        { id: seedId("710", 4), label: "Testing" },
                        { id: seedId("710", 5), label: "Tooling" },
                        { id: seedId("710", 6), label: "Accessibility" },
                    ],
                },
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 6),
        );
        const slides = withId(
            new CustomField({
                position: 4,
                title: "Slides",
                helperText: "A draft is fine; you can replace it later",
                externalKey: "slides",
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "file" },
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(context.edition),
            }),
            seedId("700", 7),
        );

        em.persist([
            experience,
            dietary,
            arrival,
            pronouns,
            equipment,
            recording,
            materials,
            topics,
            slides,
        ]);

        return { equipment, recording, dietary, topics, arrival };
    }

    /**
     * Seeds one session per state that behaves differently.
     */
    private createSessions(
        em: EntityManager,
        context: SeedContext,
        customFields: SeededCustomFields,
    ): void {
        const submitted = withId(
            this.buildSession(context, {
                title: "Submitted talk",
                sessionType: context.talk,
                track: context.mainTrack,
            }),
            seedId("800", 1),
        );

        const accepted = withId(
            this.buildSession(context, {
                title: "Accepted talk",
                sessionType: context.talk,
                track: context.mainTrack,
            }),
            seedId("800", 2),
        );
        accepted.state = "accepted";

        const confirmed = withId(
            this.buildSession(context, {
                title: "Confirmed workshop",
                sessionType: context.workshop,
                track: context.communityTrack,
            }),
            seedId("800", 3),
        );
        confirmed.state = "confirmed";

        const rejected = withId(
            this.buildSession(context, {
                title: "Rejected talk",
                sessionType: context.talk,
                track: null,
            }),
            seedId("800", 4),
        );
        rejected.state = "rejected";

        const startsAt = context.edition.startDate
            .toZonedDateTime({
                timeZone: context.edition.timeZone,
                plainTime: Temporal.PlainTime.from("10:00"),
            })
            .toInstant();
        const slot = withId(
            new Slot({
                startsAt,
                endsAt: startsAt.add(context.workshop.defaultDuration),
                setupTime: Temporal.Duration.from({ minutes: 0 }),
                teardownTime: Temporal.Duration.from({ minutes: 0 }),
                schedule: ref(context.schedule),
                session: ref(confirmed),
                location: ref(context.locations.mainHall),
            }),
            seedId("900", 1),
        );

        em.persist([
            submitted,
            accepted,
            confirmed,
            rejected,
            slot,
            Response.sessionResponse(ref(customFields.recording), ref(submitted), true),
            Response.sessionResponse(
                ref(customFields.equipment),
                ref(submitted),
                "A flipchart, if one is going.",
            ),
            Response.sessionResponse(ref(customFields.recording), ref(confirmed), false),
            Response.sessionResponse(ref(customFields.topics), ref(submitted), [
                seedId("710", 4),
                seedId("710", 6),
            ]),
            Response.hostResponse(
                ref(customFields.dietary),
                ref(context.speakerHost),
                seedId("710", 3),
            ),
            Response.hostResponse(
                ref(customFields.arrival),
                ref(context.speakerHost),
                context.edition.startDate.subtract({ days: 1 }).toString(),
            ),
        ]);
    }

    /**
     * Seeds a program with enough shape to look at, across all three days.
     *
     * Every slot obeys what the API would enforce on a write, margins included,
     * because a schedule seeded past those rules sends anyone testing the grid
     * looking for rendering bugs in states the API refuses to create.
     *
     * Registration is the case worth having: one session placed three times at
     * three lengths, which is what a slot carrying its own duration is for.
     */
    private createProgram(em: EntityManager, context: SeedContext): void {
        const { mainHall, sideRoom, workshopRoom, lab, atriumStage } = context.locations;

        const sessions = (
            [
                { title: "Registration", type: context.breakType, state: "confirmed" },
                { title: "Opening keynote", type: context.talk, state: "confirmed" },
                { title: "Lightning talks", type: context.talk, state: "confirmed" },
                {
                    title: "Hands-on: building a CI pipeline",
                    type: context.workshop,
                    state: "confirmed",
                },
                { title: "Panel: scheduling at scale", type: context.talk, state: "accepted" },
                { title: "Closing remarks", type: context.talk, state: "accepted" },
            ] as const
        ).map((values, index) => {
            const session = withId(
                this.buildSession(context, {
                    title: values.title,
                    sessionType: values.type,
                    track: null,
                }),
                seedId("800", index + 5),
            );
            session.state = values.state;

            return session;
        });

        const [registration, keynote, lightning, handsOn, panel, closing] = sessions;

        // With hosts on it, a speaker's own session list would show breaks they
        // never submitted, since that list is filtered by host.
        registration.hosts.removeAll();

        // The workshop asks for its room either side of itself, which is what
        // makes the shoulders visible and what the panel after it in the Lab
        // has to clear: it starts on the minute the teardown releases the room.
        handsOn.setupTime = Temporal.Duration.from({ minutes: 30 });
        handsOn.teardownTime = Temporal.Duration.from({ minutes: 15 });

        const edition = context.edition;
        const program = [
            { session: registration, location: atriumStage, day: 0, from: "08:00", to: "09:00" },
            { session: registration, location: atriumStage, day: 1, from: "08:30", to: "09:00" },
            { session: registration, location: atriumStage, day: 2, from: "08:45", to: "09:00" },

            { session: keynote, location: mainHall, day: 0, from: "09:00", to: "09:45" },
            { session: lightning, location: sideRoom, day: 0, from: "10:00", to: "10:30" },
            { session: handsOn, location: workshopRoom, day: 0, from: "10:00", to: "11:30" },
            { session: panel, location: mainHall, day: 0, from: "12:00", to: "13:00" },

            { session: handsOn, location: lab, day: 1, from: "10:00", to: "11:30" },
            { session: panel, location: lab, day: 1, from: "11:45", to: "12:45" },
            { session: lightning, location: sideRoom, day: 1, from: "11:00", to: "11:30" },

            { session: closing, location: mainHall, day: 2, from: "15:00", to: "15:30" },
        ];

        const slots = program.map((entry, index) =>
            withId(
                new Slot({
                    startsAt: wallClockAt(edition, entry.day, entry.from),
                    endsAt: wallClockAt(edition, entry.day, entry.to),
                    setupTime: entry.session.setupTime ?? Temporal.Duration.from({ minutes: 0 }),
                    teardownTime:
                        entry.session.teardownTime ?? Temporal.Duration.from({ minutes: 0 }),
                    schedule: ref(context.schedule),
                    session: ref(entry.session),
                    location: ref(entry.location),
                }),
                seedId("900", index + 2),
            ),
        );

        em.persist([...sessions, ...slots]);
    }

    private buildSession(context: SeedContext, values: SessionValues): Session {
        const session = new Session({
            title: values.title,
            abstract: `Abstract for ${values.title.toLowerCase()}.`,
            description: "",
            notes: "",
            duration: values.sessionType.defaultDuration,
            setupTime: null,
            teardownTime: null,
            teaserImage: null,
            edition: ref(context.edition),
            sessionType: ref(values.sessionType),
            track: values.track ? ref(values.track) : null,
        });
        session.hosts.add(context.sessionHosts);

        return session;
    }
}
