import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { compile } from "@jmespath-community/jmespath";
import { isAfter } from "temporal-extra";
import { User } from "../../src/entity/User.js";
import { userInfoCache } from "../../src/route/user.js";
import { appConfig } from "../../src/util/app-config.js";
import { openIdConfiguration } from "../../src/util/auth.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildTeamMember } from "../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../setup/json-api.js";
import { waitForLockWaiters } from "../setup/locks.js";
import { fetchAccessToken } from "../setup/token.js";

type UserDocument = {
    data: {
        id: string;
        type: string;
        attributes: { displayName: string; emailAddress: string };
        relationships?: { teams: { data: { type: string; id: string }[] } };
    };
    included?: { type: string; id: string; attributes: { name: string } }[];
    meta: { editableFields: string[]; highestRole: string | null; superAdmin: boolean };
};

type UserInfoClaims = {
    displayName: string | number;
    email?: string;
};

const userInfoClaims = new Map<string, UserInfoClaims>();

const readSubject = (authorization: string | undefined): string => {
    assert(authorization);
    const payload = authorization.replace(/^Bearer /, "").split(".")[1];
    assert(payload);

    return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string }).sub;
};

type UserInfoHold = {
    arrived: Promise<void>;
    release: () => void;
};

let heldSubject: string | null = null;
let heldArrival: PromiseWithResolvers<void> | null = null;
let heldRelease: PromiseWithResolvers<void> | null = null;

/**
 * Parks the next userinfo request for a subject.
 *
 * Its handler then sits suspended between authentication and its database
 * transaction.
 */
const holdUserInfo = (subject: string): UserInfoHold => {
    const arrival = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    heldSubject = subject;
    heldArrival = arrival;
    heldRelease = release;

    return {
        arrived: arrival.promise,
        release: () => {
            heldSubject = null;
            release.resolve();
        },
    };
};

// The mock identity provider issues client-credentials tokens without profile
// claims, so its userinfo endpoint cannot serve the display name and email
// address the configured JMESPath lookups demand. Every route here reads them
// through this stand-in instead.
const userInfoServer = createServer((request, response) => {
    const subject = readSubject(request.headers.authorization);
    const claims = userInfoClaims.get(subject);

    const respond = (): void => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(claims ?? {}));
    };

    if (subject !== heldSubject || heldArrival === null || heldRelease === null) {
        respond();
        return;
    }

    heldArrival.resolve();
    void heldRelease.promise.then(respond);
});

describe("user", () => {
    let userToken: string;
    let hostToken: string;
    let strangerToken: string;
    let superAdminToken: string;
    let originalUserInfoEndpoint: string;

    before(async () => {
        [userToken, hostToken, strangerToken, superAdminToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
            fetchAccessToken("admin"),
        ]);

        await new Promise<void>((resolve) => {
            userInfoServer.listen(0, "127.0.0.1", resolve);
        });
        const { port } = userInfoServer.address() as AddressInfo;
        originalUserInfoEndpoint = openIdConfiguration.userinfo_endpoint;
        openIdConfiguration.userinfo_endpoint = `http://127.0.0.1:${port}/userinfo`;
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: host, team } = buildTeamMember("testhost", "manager", {
            displayName: "Stale Host",
            emailAddress: "stale@example.test",
            teamName: "Managers",
        });

        await fork.persist([host, team]).flush();
    });

    after(async () => {
        openIdConfiguration.userinfo_endpoint = originalUserInfoEndpoint;

        await new Promise<void>((resolve, reject) => {
            userInfoServer.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    });

    beforeEach(() => {
        userInfoCache.clear();
        userInfoClaims.clear();
    });

    const showProfile = (token: string) => jsonApi.get("/user", token);

    it("provisions a profile from the identity provider", async () => {
        userInfoClaims.set("testuser", {
            displayName: "Provisioned User",
            email: "provisioned@example.test",
        });

        const response = await showProfile(userToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as UserDocument;
        assert.equal(document.data.type, "user");
        assert.equal(document.data.attributes.displayName, "Provisioned User");
        assert.equal(document.data.attributes.emailAddress, "provisioned@example.test");
        assert.deepEqual(document.meta.editableFields, []);
        assert.equal(document.meta.highestRole, null);

        const user = await em.fork().findOneOrFail(User, { externalId: "testuser" });
        assert.equal(user.id, document.data.id);
        assert.equal(user.emailAddress, "provisioned@example.test");
    });

    // The web matches this code to explain the page every signed-in route
    // shows that person, since each reads the profile first.
    it("refuses a profile whose provider leaves out a configured claim", async () => {
        userInfoClaims.set("testuser", { displayName: "No Address" });

        const response = await showProfile(userToken);

        await expectJsonApiError(response, 403, "missing_profile_claim");
    });

    it("refuses a profile whose claim path throws, rather than erroring", async () => {
        const original = appConfig.userInfo.displayNamePath;
        // Compiles, and throws once the provider sends a number where the
        // expression expects a string: join() takes strings only.
        appConfig.userInfo.displayNamePath = compile("join(' ', [displayName])");
        userInfoClaims.set("testuser", {
            displayName: 42,
            email: "thrown@example.test",
        });

        try {
            const response = await showProfile(userToken);

            await expectJsonApiError(response, 403, "missing_profile_claim");
        } finally {
            appConfig.userInfo.displayNamePath = original;
        }
    });

    // highestRole reads "admin" for the claim as well as for the team role, so
    // this is the only thing that tells an operator surface which one it has.
    it("marks the superadmin claim, which the highest role cannot express", async () => {
        userInfoClaims.set("admin", {
            displayName: "Dev Admin",
            email: "admin@example.test",
        });

        const response = await showProfile(superAdminToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as UserDocument;
        assert.equal(document.meta.superAdmin, true);
        assert.equal(document.meta.highestRole, "admin");
    });

    it("refreshes a stale profile and reports the highest team role", async () => {
        userInfoClaims.set("testhost", {
            displayName: "Fresh Host",
            email: "fresh@example.test",
        });

        const response = await showProfile(hostToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as UserDocument;
        assert.equal(document.data.attributes.displayName, "Fresh Host");
        assert.equal(document.data.attributes.emailAddress, "fresh@example.test");
        assert.equal(document.meta.highestRole, "manager");
        assert.equal(document.meta.superAdmin, false);

        const teamIdentifiers = document.data.relationships?.teams.data;
        assert.ok(teamIdentifiers);
        assert.equal(teamIdentifiers.length, 1);
        assert.deepEqual(
            document.included?.map((resource) => ({
                type: resource.type,
                id: resource.id,
                name: resource.attributes.name,
            })),
            [{ type: "team", id: teamIdentifiers[0].id, name: "Managers" }],
        );

        const user = await em.fork().findOneOrFail(User, { externalId: "testhost" });
        assert.equal(user.displayName, "Fresh Host");
        assert.equal(user.emailAddress, "fresh@example.test");
    });

    it("lets the identity provider override attributes sent on replace", async () => {
        // The priming read makes this the regression net for the PUT cache
        // bypass: a cached PUT would answer with the primed claims instead.
        userInfoClaims.set("testuser", {
            displayName: "Primed User",
            email: "primed@example.test",
        });
        const primingResponse = await showProfile(userToken);
        assert.equal(primingResponse.status, 200);

        userInfoClaims.set("testuser", {
            displayName: "Renamed User",
            email: "renamed@example.test",
        });

        const response = await jsonApi.put("/user", userToken, {
            data: {
                type: "user",
                attributes: {
                    displayName: "Client Chosen",
                    emailAddress: "client@example.test",
                },
            },
        });

        assert.equal(response.status, 200);
        const document = (await response.json()) as UserDocument;
        assert.equal(document.data.attributes.displayName, "Renamed User");
        assert.equal(document.data.attributes.emailAddress, "renamed@example.test");
        assert.deepEqual(document.meta.editableFields, []);

        const user = await em.fork().findOneOrFail(User, { externalId: "testuser" });
        assert.equal(user.displayName, "Renamed User");
        assert.equal(user.emailAddress, "renamed@example.test");
    });

    it("never syncs the row from the cache", async () => {
        userInfoClaims.set("stranger", {
            displayName: "First Claims",
            email: "first@example.test",
        });

        const primingResponse = await showProfile(strangerToken);
        assert.equal(primingResponse.status, 200);

        // Another replica refreshed the row meanwhile; this instance's
        // cached claims must neither be re-fetched nor written back.
        const fork = em.fork();
        await fork.nativeUpdate(
            User,
            { externalId: "stranger" },
            { displayName: "Replica Fresh", emailAddress: "replica@example.test" },
        );
        userInfoClaims.set("stranger", {
            displayName: "Changed Claims",
            email: "changed@example.test",
        });

        const cachedResponse = await showProfile(strangerToken);

        assert.equal(cachedResponse.status, 200);
        const document = (await cachedResponse.json()) as UserDocument;
        assert.equal(document.data.attributes.displayName, "Replica Fresh");
        assert.equal(document.data.attributes.emailAddress, "replica@example.test");
    });

    it("records the last seen timestamp only when the cache misses", async () => {
        userInfoClaims.set("testuser", {
            displayName: "Seen User",
            email: "seen@example.test",
        });

        // Provisioning first, so both reads below land on an existing row.
        assert.equal((await showProfile(userToken)).status, 200);
        userInfoCache.clear();

        const dormant = Temporal.Now.instant().subtract({ hours: 1 });
        await em.fork().nativeUpdate(User, { externalId: "testuser" }, { lastSeenAt: dormant });

        assert.equal((await showProfile(userToken)).status, 200);
        const afterMiss = (await em.fork().findOneOrFail(User, { externalId: "testuser" }))
            .lastSeenAt;
        assert.ok(isAfter(afterMiss, dormant));

        assert.equal((await showProfile(userToken)).status, 200);
        const afterHit = (await em.fork().findOneOrFail(User, { externalId: "testuser" }))
            .lastSeenAt;
        assert.equal(afterHit.epochNanoseconds, afterMiss.epochNanoseconds);
    });

    it("adopts the row a concurrent first login inserted", { timeout: 30_000 }, async () => {
        userInfoClaims.set("stranger", {
            displayName: "Retried Claims",
            email: "retried@example.test",
        });

        const hold = holdUserInfo("stranger");
        const responsePromise = send(showProfile(strangerToken));
        await hold.arrived;

        const fork = em.fork();
        await fork.begin();
        const winner = new User({
            externalId: "stranger",
            displayName: "Concurrent Winner",
            emailAddress: "winner@example.test",
        });

        try {
            fork.persist(winner);
            await fork.flush();

            // The released handler sees no row of its own, inserts, and queues
            // behind the uncommitted one until the commit turns its insert
            // into a unique constraint violation.
            hold.release();
            await waitForLockWaiters(em.fork());
            await fork.commit();
        } finally {
            hold.release();

            if (fork.isInTransaction()) {
                await fork.rollback();
            }
        }

        const response = await responsePromise;

        assert.equal(response.status, 200);
        const document = (await response.json()) as UserDocument;
        assert.equal(document.data.id, winner.id);
        assert.equal(document.data.attributes.displayName, "Retried Claims");
        assert.equal(document.data.attributes.emailAddress, "retried@example.test");

        const users = await em.fork().find(User, { externalId: "stranger" });
        assert.equal(users.length, 1);

        // The retry has to leave the cache warm as well, so the next read
        // neither re-fetches nor syncs the row.
        userInfoClaims.set("stranger", {
            displayName: "Ignored Claims",
            email: "ignored@example.test",
        });

        const cachedResponse = await showProfile(strangerToken);

        assert.equal(cachedResponse.status, 200);
        const cachedDocument = (await cachedResponse.json()) as UserDocument;
        assert.equal(cachedDocument.data.attributes.displayName, "Retried Claims");
        assert.equal(cachedDocument.data.attributes.emailAddress, "retried@example.test");
    });

    it("adopts the concurrent row on replace as well", { timeout: 30_000 }, async () => {
        userInfoClaims.set("stranger", {
            displayName: "Replaced Claims",
            email: "replaced@example.test",
        });

        const hold = holdUserInfo("stranger");
        const responsePromise = send(
            jsonApi.put("/user", strangerToken, {
                data: { type: "user", attributes: {} },
            }),
        );
        await hold.arrived;

        const fork = em.fork();
        await fork.begin();
        const winner = new User({
            externalId: "stranger",
            displayName: "Replace Winner",
            emailAddress: "replace-winner@example.test",
        });

        try {
            fork.persist(winner);
            await fork.flush();

            hold.release();
            await waitForLockWaiters(em.fork());
            await fork.commit();
        } finally {
            hold.release();

            if (fork.isInTransaction()) {
                await fork.rollback();
            }
        }

        const response = await responsePromise;

        assert.equal(response.status, 200);
        const document = (await response.json()) as UserDocument;
        assert.equal(document.data.id, winner.id);

        // A replace writes this request's identity claims over the winner's.
        assert.equal(document.data.attributes.displayName, "Replaced Claims");
        assert.equal(document.data.attributes.emailAddress, "replaced@example.test");
        assert.equal(await em.fork().count(User, { externalId: "stranger" }), 1);
    });
});
