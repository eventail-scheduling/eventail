import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { Job, type JobState, type SendEmailJobPayload } from "../../src/entity/Job.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildSuperAdmin, buildTeamMember } from "../setup/fixtures.js";
import { buildEmailPayload } from "../setup/jobs.js";
import { expectJsonApiError, jsonApi } from "../setup/json-api.js";
import { fetchAccessToken } from "../setup/token.js";

const buildPayload = (subject: string): SendEmailJobPayload =>
    buildEmailPayload("jobs@example.test", subject);

const buildFinalizedJob = (subject: string, state: JobState): Job => {
    const job = new Job({ payload: buildPayload(subject) });
    job.state = state;
    job.attempt = 3;
    job.attemptedAt = Temporal.Now.instant();
    job.finalizedAt = Temporal.Now.instant();

    return job;
};

const descendingIds = (jobs: Job[]): string[] =>
    jobs
        .map((job) => job.id)
        .toSorted()
        .toReversed();

describe("jobs", () => {
    let managerToken: string;
    let adminToken: string;
    let integrationToken: string;
    let superAdminToken: string;

    before(async () => {
        [managerToken, adminToken, integrationToken, superAdminToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("integration"),
            fetchAccessToken("admin"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team: managerTeam } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });
        // The admin team role, held by someone the superadmin predicate does not
        // match. Both gates accept the `admin` identity, so only this one can
        // tell the claim apart from the role.
        const { user: admin, team: adminTeam } = buildTeamMember("testhost", "admin", {
            displayName: "Test Admin",
            emailAddress: "admin-role@example.test",
            teamName: "Admins",
        });
        const superAdmin = buildSuperAdmin();

        await fork.persist([manager, admin, superAdmin, managerTeam, adminTeam]).flush();
    });

    const listJobs = (token: string) => jsonApi.get("/jobs", token);

    it("rejects a manager team member", async () => {
        const response = await listJobs(managerToken);
        assert.equal(response.status, 403);
    });

    it("rejects an admin team member, who cannot fix what a job failed on", async () => {
        const response = await listJobs(adminToken);
        assert.equal(response.status, 403);
    });

    it("rejects an integration token", async () => {
        const response = await listJobs(integrationToken);
        assert.equal(response.status, 403);
    });

    it("lists jobs for the superadmin", async () => {
        const response = await listJobs(superAdminToken);
        assert.equal(response.status, 200);

        const document = (await response.json()) as { data: unknown[] };
        assert.ok(Array.isArray(document.data));
    });

    const retryJob = (jobId: string) =>
        jsonApi.post(`/jobs/${jobId}/retry`, superAdminToken, {
            data: { type: "job_retry" },
        });

    it("retries a discarded job", async () => {
        const discarded = buildFinalizedJob("discarded job", "discarded");
        discarded.lastError = "Error: permanent failure";
        const completed = buildFinalizedJob("completed job", "completed");
        await em.fork().persist([discarded, completed]).flush();

        const response = await retryJob(discarded.id);
        assert.equal(response.status, 200);

        const document = (await response.json()) as {
            data: { id: string; attributes: { state: string; attempt: number } };
        };
        assert.equal(document.data.id, discarded.id);
        assert.equal(document.data.attributes.state, "available");
        assert.equal(document.data.attributes.attempt, 0);

        const stored = await em.fork().findOneOrFail(Job, discarded.id);
        assert.equal(stored.state, "available");
        assert.equal(stored.attempt, 0);
        assert.equal(stored.attemptedAt, null);
        assert.equal(stored.finalizedAt, null);
        assert.equal(stored.lastError, null);

        const rejected = await retryJob(completed.id);
        await expectJsonApiError(rejected, 409, "not_retryable");
    });

    const cancelJob = (jobId: string, token = superAdminToken) =>
        jsonApi.post(`/jobs/${jobId}/cancellation`, token, {
            data: { type: "job_cancellation" },
        });

    it("cancels a job that is still waiting", async () => {
        const waiting = new Job({ payload: buildPayload("waiting job") });
        await em.fork().persist(waiting).flush();

        const response = await cancelJob(waiting.id);
        assert.equal(response.status, 200);

        const document = (await response.json()) as { data: { attributes: { state: string } } };
        assert.equal(document.data.attributes.state, "canceled");

        const stored = await em.fork().findOneOrFail(Job, waiting.id);
        assert.equal(stored.state, "canceled");
        assert.notEqual(stored.finalizedAt, null);
    });

    // Every state, so a finished one added to the list, or a waiting one
    // dropped from it, fails here.
    it("cancels only a job that is waiting to run", async () => {
        const inState = (state: JobState): Job => {
            const job = new Job({ payload: buildPayload(`${state} job`) });
            job.state = state;

            return job;
        };
        const cancelable = (["available", "scheduled", "retryable"] as const).map(inState);
        const settled = (["running", "completed", "discarded", "canceled"] as const).map(inState);
        await em
            .fork()
            .persist([...cancelable, ...settled])
            .flush();

        for (const job of cancelable) {
            assert.equal((await cancelJob(job.id)).status, 200, job.state);
        }

        for (const job of settled) {
            await expectJsonApiError(await cancelJob(job.id), 409, "not_cancelable");
        }
    });

    it("refuses to cancel a job a worker is running", async () => {
        const running = new Job({ payload: buildPayload("running job") });
        running.state = "running";
        running.attemptedAt = Temporal.Now.instant();
        await em.fork().persist(running).flush();

        await expectJsonApiError(await cancelJob(running.id), 409, "not_cancelable");
        assert.equal((await em.fork().findOneOrFail(Job, running.id)).state, "running");
    });

    it("turns the admin team role away from every job route", async () => {
        const job = new Job({ payload: buildPayload("gated job") });
        await em.fork().persist(job).flush();

        const responses = await Promise.all([
            jsonApi.get(`/jobs/${job.id}`, adminToken),
            jsonApi.post(`/jobs/${job.id}/retry`, adminToken, { data: { type: "job_retry" } }),
            cancelJob(job.id, adminToken),
        ]);

        for (const response of responses) {
            assert.equal(response.status, 403);
        }

        assert.equal((await em.fork().findOneOrFail(Job, job.id)).state, "available");
    });

    // The summary names the recipient, so what the list withholds is the rest:
    // the template variables, and the object key an image job carries.
    it("carries the payload on the one job and not in the list", async () => {
        const job = new Job({ payload: buildPayload("payload job") });
        await em.fork().persist(job).flush();

        const shown = await jsonApi.get(`/jobs/${job.id}`, superAdminToken);
        assert.equal(shown.status, 200);

        const detail = (await shown.json()) as {
            data: { attributes: { payload: { recipient: string }; summary: string } };
        };
        assert.equal(detail.data.attributes.payload.recipient, "jobs@example.test");
        assert.equal(detail.data.attributes.summary, "Email to jobs@example.test: payload job");

        const listed = await jsonApi.get("/jobs", superAdminToken);
        const list = (await listed.json()) as {
            data: { id: string; attributes: Record<string, unknown> }[];
        };
        const row = list.data.find((entry) => entry.id === job.id);
        assert.ok(row);
        assert.equal(row.attributes.payload, undefined);
        assert.equal(row.attributes.summary, "Email to jobs@example.test: payload job");
    });

    it("pages through the job list", async () => {
        const scheduledAt = Temporal.Now.instant().add({ hours: 1 });
        const scheduled: Job[] = [];

        for (let index = 0; index < 5; index += 1) {
            scheduled.push(
                new Job({
                    payload: buildPayload(`scheduled job ${index}`),
                    scheduledAt,
                }),
            );
        }

        await em.fork().persist(scheduled).flush();

        const pages: string[][] = [];
        let nextPath: string | null = "/jobs?filter[state]=scheduled&page[size]=2";

        // Bounded so a broken next link fails the assertion instead of looping.
        while (nextPath !== null && pages.length < 4) {
            const response = await jsonApi.get(nextPath, superAdminToken);
            assert.equal(response.status, 200);

            const document = (await response.json()) as {
                data: { id: string }[];
                links: { next: string | null };
            };
            pages.push(document.data.map((resource) => resource.id));

            if (document.links.next === null) {
                nextPath = null;
                continue;
            }

            const nextUri = new URL(document.links.next);
            nextPath = `${nextUri.pathname}${nextUri.search}`;
        }

        const expectedIds = descendingIds(scheduled);
        assert.deepEqual(pages, [
            expectedIds.slice(0, 2),
            expectedIds.slice(2, 4),
            expectedIds.slice(4),
        ]);
    });

    it("filters jobs by state", async () => {
        const discarded = [
            buildFinalizedJob("first discarded job", "discarded"),
            buildFinalizedJob("second discarded job", "discarded"),
        ];
        await em.fork().persist(discarded).flush();

        const response = await jsonApi.get("/jobs?filter[state]=discarded", superAdminToken);
        assert.equal(response.status, 200);

        const document = (await response.json()) as { data: { id: string }[] };
        assert.deepEqual(
            document.data.map((resource) => resource.id),
            descendingIds(discarded),
        );
    });
});
