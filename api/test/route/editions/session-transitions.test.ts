import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { Edition } from "../../../src/entity/Edition.js";
import { Job } from "../../../src/entity/Job.js";
import { Location } from "../../../src/entity/Location.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildTeamMember,
    findOrBuildHost,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("session-transitions", () => {
    let managerToken: string;
    let hostToken: string;
    let strangerToken: string;
    let editionId: string;
    let sessionId: string;
    let sessionTypeId: string;

    before(async () => {
        [managerToken, hostToken, strangerToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });

        const edition = buildEdition({ name: "Lifecycle Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Lifecycle Session" });
        session.hosts.add(buildHost(edition, host));

        await fork.persist([manager, host, stranger, team, edition, sessionType, session]).flush();

        editionId = edition.id;
        sessionId = session.id;
        sessionTypeId = sessionType.id;
    });

    const transitionSession = (
        token: string,
        targetSessionId: string,
        state: string,
        note?: string,
    ) =>
        jsonApi.post(`/editions/${editionId}/sessions/${targetSessionId}/transitions`, token, {
            data: {
                type: "session_transition",
                attributes: { state, ...(note === undefined ? {} : { note }) },
            },
        });

    const transition = (token: string, state: string, note?: string) =>
        transitionSession(token, sessionId, state, note);

    it("walks a session through accept and confirm", async () => {
        const hostAccept = await transition(hostToken, "accepted");
        await expectJsonApiError(hostAccept, 403, "forbidden");

        const accept = await transition(managerToken, "accepted", "Please cut it to 30 minutes.");
        assert.equal(accept.status, 201);

        const acceptedMails = await em
            .fork()
            .find(Job, { state: "available" })
            .then((jobs) =>
                jobs.filter(
                    (job) =>
                        job.payload.type === "send_email" &&
                        job.payload.template === "session-accepted",
                ),
            );
        assert.equal(acceptedMails.length, 1);
        assert.equal(
            acceptedMails[0].payload.type === "send_email" && acceptedMails[0].payload.recipient,
            "host@example.test",
        );
        // An acceptance can carry a note too, and it is the speaker who reads
        // it, so dropping it loses the message rather than an internal record.
        assert.equal(
            acceptedMails[0].payload.type === "send_email" &&
                acceptedMails[0].payload.variables.note,
            "Please cut it to 30 minutes.",
        );

        const confirm = await transition(hostToken, "confirmed");
        assert.equal(confirm.status, 201);

        const illegal = await transition(managerToken, "submitted");
        await expectJsonApiError(illegal, 409, "illegal_transition");

        const history = await jsonApi.get(
            `/editions/${editionId}/sessions/${sessionId}/transitions`,
            hostToken,
        );
        assert.equal(history.status, 200);
        const document = (await history.json()) as {
            data: { attributes: { fromState: string; toState: string } }[];
            included?: { type: string; attributes: Record<string, unknown> }[];
        };
        assert.deepEqual(
            document.data.map((resource) => resource.attributes.toState),
            ["accepted", "confirmed"],
        );

        // This is the host reading their own session, and the actors are the
        // organizers who moved it. A user resource carries an email address
        // unless the handler narrows the fieldset, and nothing else on this
        // path would stop it reaching them.
        const actors = (document.included ?? []).filter((resource) => resource.type === "user");
        assert.ok(actors.length > 0, "Expected the actors to be included");

        for (const actor of actors) {
            assert.deepEqual(Object.keys(actor.attributes), ["displayName"]);
        }
    });

    // The same ceiling the web's note field counts to.
    it("refuses a note longer than 2000 characters", async () => {
        const response = await transition(managerToken, "accepted", "x".repeat(2001));

        await expectJsonApiError(response, 422, "too_big");
    });

    it("rejects transitions from users not involved with the session", async () => {
        // Its own precondition: the assertion below needs a target the session
        // actually permits, or it degenerates into the illegal-target case.
        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, sessionId);
        session.state = "accepted";
        await fork.persist(session).flush();

        const legalTarget = await transition(strangerToken, "confirmed");
        await expectJsonApiError(legalTarget, 403, "forbidden");

        // The involvement check has to run first: a 409 would leak that the
        // session is not in a state allowing this transition.
        const illegalTarget = await transition(strangerToken, "rejected");
        await expectJsonApiError(illegalTarget, 403, "forbidden");
    });

    it("reinstates a canceled session to accepted", async () => {
        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, sessionId);
        session.state = "accepted";
        await fork.persist(session).flush();

        const confirm = await transition(hostToken, "confirmed");
        assert.equal(confirm.status, 201);

        const cancel = await transition(hostToken, "canceled");
        assert.equal(cancel.status, 201);

        const hostReinstate = await transition(hostToken, "accepted");
        await expectJsonApiError(hostReinstate, 403, "forbidden");

        const reinstate = await transition(managerToken, "accepted");
        assert.equal(reinstate.status, 201);

        const detail = await jsonApi.get(
            `/editions/${editionId}/sessions/${sessionId}`,
            managerToken,
        );
        assert.equal(detail.status, 200);
        const document = (await detail.json()) as { data: { attributes: { state: string } } };
        assert.equal(document.data.attributes.state, "accepted");
    });

    // A confirmed session was accepted already, so returning it there is no
    // news; bringing a canceled one back is, and says so.
    it("mails an acceptance for a reinstatement but not for a reopened confirmation", async () => {
        const acceptanceMails = async () =>
            (await em.fork().find(Job, { state: "available" })).filter(
                (job) =>
                    job.payload.type === "send_email" &&
                    job.payload.template === "session-accepted",
            ).length;
        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, sessionId);
        session.state = "confirmed";
        await fork.flush();

        assert.equal((await transition(managerToken, "accepted")).status, 201);
        assert.equal(await acceptanceMails(), 0);

        assert.equal((await transition(hostToken, "canceled")).status, 201);
        assert.equal((await transition(managerToken, "accepted")).status, 201);
        assert.equal(await acceptanceMails(), 1);
    });

    const buildHostedSession = async (title: string): Promise<string> => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sessionType = await fork.findOneOrFail(SessionType, sessionTypeId);
        const host = await fork.findOneOrFail(User, { externalId: "testhost" });
        const session = buildSession(edition, sessionType, { title });
        session.hosts.add(await findOrBuildHost(fork, edition, host));
        await fork.persist(session).flush();

        return session.id;
    };

    it("keeps a published slot when its session cancels", async () => {
        const hostedSessionId = await buildHostedSession("Slotted Session");
        assert.equal(
            (await transitionSession(managerToken, hostedSessionId, "accepted")).status,
            201,
        );
        assert.equal(
            (await transitionSession(hostToken, hostedSessionId, "confirmed")).status,
            201,
        );

        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const session = await fork.findOneOrFail(Session, hostedSessionId);
        const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
        schedule.publish(edition, Temporal.Now.instant());
        const location = new Location({
            position: 0,
            name: "Cancellation Room",
            externalKey: null,
            edition: ref(edition),
        });
        const slot = new Slot({
            startsAt: Temporal.Instant.from("2027-11-02T15:00:00Z"),
            endsAt: Temporal.Instant.from("2027-11-02T16:00:00Z"),
            setupTime: Temporal.Duration.from({ minutes: 0 }),
            teardownTime: Temporal.Duration.from({ minutes: 0 }),
            schedule: ref(schedule),
            session: ref(session),
            location: ref(location),
        });
        await fork.persist([schedule, location, slot]).flush();

        assert.equal((await transitionSession(hostToken, hostedSessionId, "canceled")).status, 201);

        assert.equal(await em.fork().count(Slot, { id: slot.id }), 1);
    });
});
