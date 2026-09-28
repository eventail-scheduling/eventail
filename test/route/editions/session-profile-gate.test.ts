import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { HostAvailability } from "../../../src/entity/HostAvailability.js";
import { Response } from "../../../src/entity/Response.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import type { ProfileFieldOptions } from "../../../src/support/profile-fields.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type CustomFieldValues = ConstructorParameters<typeof CustomField>[0];

type ErrorMeta = {
    missingFields: string[];
    missingCustomFieldIds: string[];
    missingAvailability: boolean;
};

type Setup = {
    profileFieldOptions?: ProfileFieldOptions;
    withoutHost?: boolean;
    biography?: string;
    availabilities?: number;
    customField?: Partial<CustomFieldValues>;
    answer?: unknown;
};

type Submission = {
    editionId: string;
    sessionTypeId: string;
};

describe("session profile gate", () => {
    let managerToken: string;
    let hostToken: string;
    let hostUserId: string;

    before(async () => {
        [managerToken, hostToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });
        // Both filled: the two force-required profile fields are prefilled from
        // here, so an empty one would fail every case at once and say nothing
        // about the field under test.
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });

        await fork.persist([manager, team, host]).flush();

        hostUserId = host.id;
    });

    const build = async (setup: Setup = {}): Promise<Submission> => {
        const fork = em.fork();
        const user = await fork.findOneOrFail(User, hostUserId);
        const edition = buildEdition({
            name: "Gate Edition",
            startDate: Temporal.PlainDate.from("2027-11-01"),
            endDate: Temporal.PlainDate.from("2027-11-03"),
            // Nothing but the two fields no edition can switch off, so a
            // rejected submission is the gate talking and not the schema.
            sessionFieldOptions: {},
            ...(setup.profileFieldOptions === undefined
                ? {}
                : { profileFieldOptions: setup.profileFieldOptions }),
        });
        const sessionType = SessionType.default(ref(edition));
        const host = buildHost(edition, user, { biography: setup.biography ?? "" });

        fork.persist(setup.withoutHost ? [edition, sessionType] : [edition, sessionType, host]);

        for (let index = 0; index < (setup.availabilities ?? 0); index += 1) {
            fork.persist(
                new HostAvailability({
                    startsAt: Temporal.Instant.from("2027-11-01T09:00:00Z"),
                    endsAt: Temporal.Instant.from("2027-11-01T17:00:00Z"),
                    host: ref(host),
                }),
            );
        }

        if (setup.customField) {
            const customField = new CustomField({
                position: 0,
                externalKey: null,
                target: "per_host",
                requirement: "always_required",
                options: { type: "single_line_text" },
                title: "What is your name?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
                ...setup.customField,
            });
            fork.persist(customField);

            if (setup.answer !== undefined) {
                fork.persist(Response.hostResponse(ref(customField), ref(host), setup.answer));
            }
        }

        await fork.flush();

        return { editionId: edition.id, sessionTypeId: sessionType.id };
    };

    const submit = (
        { editionId, sessionTypeId }: Submission,
        token = hostToken,
        selfService = true,
    ) =>
        jsonApi.post(`/editions/${editionId}/sessions`, token, {
            data: {
                type: "session",
                attributes: { title: "A session" },
                relationships: {
                    sessionType: { data: { type: "session_type", id: sessionTypeId } },
                    responses: { data: [] },
                },
                meta: { selfService },
            },
        });

    const refused = async (setup: Setup): Promise<ErrorMeta> => {
        const response = await submit(await build(setup));
        assert.equal(response.status, 422);

        const document = await response.json<{ errors: { code: string; meta: ErrorMeta }[] }>();
        const error = document.errors[0];
        assert.equal(error?.code, "incomplete_profile");

        return error.meta;
    };

    const accepted = async (setup: Setup): Promise<void> => {
        const response = await submit(await build(setup));
        assert.equal(response.status, 201);
    };

    it("turns away a submission with a required profile field left empty", async () => {
        const meta = await refused({
            profileFieldOptions: { biography: { requirement: "required" } },
        });

        assert.deepEqual(meta.missingFields, ["biography"]);
    });

    // An edition write holds the row while it changes what the profile has to
    // hold, and a gate reading the options from before it would let through a
    // submission the committed edition refuses.
    it("judges the profile by what a concurrent edition write leaves", async () => {
        const submission = await build({
            profileFieldOptions: { biography: { requirement: "optional" } },
        });
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, submission.editionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            edition.profileFieldOptions = {
                ...edition.profileFieldOptions,
                biography: { requirement: "required" },
            };
            await em.flush();
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const submitted = send(submit(submission));
        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await holding;

        if (waitError !== null) {
            throw waitError;
        }

        await expectJsonApiError(await submitted, 422, "incomplete_profile");
    });

    it("lets a submission through with an optional profile field left empty", async () => {
        await accepted({ profileFieldOptions: { biography: { requirement: "optional" } } });
    });

    it("turns away a submission with a required question never answered", async () => {
        const response = await submit(await build({ customField: {}, withoutHost: true }));
        await expectJsonApiError(response, 422, "incomplete_profile");
    });

    /**
     * An answer can fall out of step with a question that was never required.
     *
     * A text field given a shorter maximum leaves every longer answer failing
     * its own schema. Turning a submission away over one would call an edition
     * incomplete that asked for nothing.
     */
    it("lets a submission through past an optional question whose answer no longer fits", async () => {
        await accepted({
            customField: {
                requirement: "always_optional",
                options: { type: "single_line_text", maxLength: 5 },
            },
            answer: "far too long for this",
        });
    });

    /**
     * The stored answer was legal when it was written.
     *
     * The question turning required afterwards is what leaves it insufficient.
     * Asking whether a row exists would let this through.
     */
    it("turns away a submission whose stored answer no longer satisfies the question", async () => {
        const meta = await refused({
            customField: {
                requirement: "required_after_deadline",
                deadline: Temporal.Now.instant().subtract({ hours: 1 }),
            },
            answer: "",
        });

        assert.equal(meta.missingCustomFieldIds.length, 1);
    });

    it("lets a submission through with a required file question answered", async () => {
        await accepted({
            customField: { options: { type: "file" } },
            answer: {
                key: "edition-1/hosts/host-1/responses/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.pdf",
                filename: "slides.pdf",
            },
        });
    });

    // Left empty while the question was optional, then held to it once its
    // deadline passed.
    it("turns away a submission with a required file question answered empty", async () => {
        const meta = await refused({
            customField: {
                options: { type: "file" },
                requirement: "required_after_deadline",
                deadline: Temporal.Now.instant().subtract({ hours: 1 }),
            },
            answer: null,
        });

        assert.equal(meta.missingCustomFieldIds.length, 1);
    });

    it("lets a submission through past a frozen question nobody answered", async () => {
        await accepted({
            customField: { freezeAfter: Temporal.Now.instant().subtract({ hours: 1 }) },
        });
    });

    it("turns away a submission with no availability drawn where the edition asks", async () => {
        const meta = await refused({
            profileFieldOptions: { availability: { requirement: "required" } },
        });

        assert.equal(meta.missingAvailability, true);
    });

    it("lets a submission through once availability is drawn", async () => {
        await accepted({
            profileFieldOptions: { availability: { requirement: "required" } },
            availabilities: 1,
        });
    });

    it("lets a submission through with availability asked for but not required", async () => {
        await accepted({
            profileFieldOptions: { availability: { requirement: "optional" } },
        });
    });

    it("turns away a submission with no avatar where the edition requires one", async () => {
        const meta = await refused({
            profileFieldOptions: { avatar: { requirement: "required" } },
        });

        assert.deepEqual(meta.missingFields, ["avatar"]);
    });

    // The gate runs against a host resolveHost has only just built, whose
    // availability hangs off a row the database has not been told about yet.
    it("turns away a first-time speaker who has drawn no availability", async () => {
        const response = await submit(
            await build({
                profileFieldOptions: { availability: { requirement: "required" } },
                withoutHost: true,
            }),
        );
        await expectJsonApiError(response, 422, "incomplete_profile");
    });

    // Nothing is judged because nothing is attached: the profile belongs to the
    // caller, and a manager submitting for someone else is not one.
    it("asks nothing of a manager submitting for someone else", async () => {
        const response = await submit(
            await build({ profileFieldOptions: { biography: { requirement: "required" } } }),
            managerToken,
            false,
        );

        assert.equal(response.status, 201);
    });
});
