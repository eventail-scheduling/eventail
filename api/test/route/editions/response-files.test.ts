import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Location } from "../../../src/entity/Location.js";
import { Response } from "../../../src/entity/Response.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { s3Client } from "../../../src/util/s3.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildTeamMember,
    buildVenue,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type SignedGetDocument = {
    data: {
        id: string;
        type: string;
        attributes: { url: string; expiresIn: number };
    };
};

const buildFileField = (
    edition: ReturnType<typeof buildEdition>,
    target: "per_proposal" | "per_host",
    confidential: boolean,
    position: number,
): CustomField =>
    new CustomField({
        position,
        externalKey: null,
        target,
        requirement: "always_optional",
        options: { type: "file" },
        title: `File ${position.toString()}`,
        helperText: "",
        confidential,
        deadline: null,
        freezeAfter: null,
        edition: ref(edition),
    });

describe("response files", () => {
    let managerToken: string;
    let hostToken: string;
    let strangerToken: string;
    let viewerToken: string;
    let integrationToken: string;

    let editionId: string;
    let otherEditionId: string;
    let confidentialResponseId: string;
    let hostResponseId: string;
    let publicResponseId: string;
    let textResponseId: string;
    let publishedResponseId: string;
    let publishedConfidentialResponseId: string;
    let publishedHostResponseId: string;
    let unpublishedHostResponseId: string;
    let unslottedResponseId: string;
    let publicKey: string;

    before(async () => {
        [managerToken, hostToken, strangerToken, viewerToken, integrationToken] = await Promise.all(
            [
                fetchAccessToken("testuser"),
                fetchAccessToken("testhost"),
                fetchAccessToken("stranger"),
                fetchAccessToken("speaker"),
                fetchAccessToken("integration"),
            ],
        );
    });

    beforeEach(async () => {
        const fork = em.fork();
        const manager = buildTeamMember("testuser", "manager");
        const viewer = buildTeamMember("speaker", "viewer");
        const hostUser = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const stranger = new User({
            externalId: "stranger",
            displayName: "Stranger",
            emailAddress: "stranger@example.test",
        });

        const edition = buildEdition({ name: "Files Edition" });
        const otherEdition = buildEdition({ name: "Other Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Filed Session" });
        const host = buildHost(edition, hostUser);
        session.hosts.add(host);

        // The integration's clamp is the current publication, so the fixture
        // carries all three states a session can be in relative to it: slotted
        // in it, confirmed but unslotted, and never accepted at all.
        const publishedSession = buildSession(edition, sessionType, { title: "Published" });
        publishedSession.state = "confirmed";
        publishedSession.hosts.add(host);

        const unslottedSession = buildSession(edition, sessionType, { title: "Unslotted" });
        unslottedSession.state = "confirmed";

        const outsiderUser = new User({
            externalId: "outsider",
            displayName: "Outsider",
            emailAddress: "outsider@example.test",
        });
        const outsiderHost = buildHost(edition, outsiderUser);

        const venue = buildVenue(edition);
        const location = new Location({
            position: 0,
            name: "Main Hall",
            externalKey: null,
            edition: ref(edition),
            venue: ref(venue),
        });
        const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
        schedule.publish(edition, Temporal.Now.instant());
        const slot = new Slot({
            startsAt: Temporal.Instant.from("2027-10-01T09:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T10:00:00Z"),
            setupTime: Temporal.Duration.from({ minutes: 0 }),
            teardownTime: Temporal.Duration.from({ minutes: 0 }),
            schedule: ref(schedule),
            session: ref(publishedSession),
            location: ref(location),
        });

        const confidentialField = buildFileField(edition, "per_proposal", true, 0);
        const hostField = buildFileField(edition, "per_host", true, 1);
        const publicField = buildFileField(edition, "per_proposal", false, 2);
        const textField = new CustomField({
            position: 3,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Notes",
            helperText: "",
            confidential: false,
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });

        publicKey = `${edition.id}/sessions/${session.id}/responses/${randomUUID()}.pdf`;
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: publicKey,
            Body: "public pdf bytes",
            ContentType: "application/pdf",
        });

        const confidentialResponse = Response.sessionResponse(
            ref(confidentialField),
            ref(session),
            {
                key: `${edition.id}/sessions/${session.id}/responses/${randomUUID()}.pdf`,
                filename: "secret.pdf",
            },
        );
        const hostResponse = Response.hostResponse(ref(hostField), ref(host), {
            key: `${edition.id}/hosts/${host.id}/responses/${randomUUID()}.pdf`,
            filename: "rider.pdf",
        });
        const publicResponse = Response.sessionResponse(ref(publicField), ref(session), {
            key: publicKey,
            filename: "slides.pdf",
        });
        const textResponse = Response.sessionResponse(ref(textField), ref(session), "hello");

        const publicHostField = buildFileField(edition, "per_host", false, 4);
        const fileValue = (name: string) => ({
            key: `${edition.id}/responses/${randomUUID()}.pdf`,
            filename: name,
        });

        const publishedResponse = Response.sessionResponse(
            ref(publicField),
            ref(publishedSession),
            fileValue("published.pdf"),
        );
        const publishedConfidentialResponse = Response.sessionResponse(
            ref(confidentialField),
            ref(publishedSession),
            fileValue("published-secret.pdf"),
        );
        const unslottedResponse = Response.sessionResponse(
            ref(publicField),
            ref(unslottedSession),
            fileValue("unslotted.pdf"),
        );
        const publishedHostResponse = Response.hostResponse(
            ref(publicHostField),
            ref(host),
            fileValue("bio.pdf"),
        );
        const unpublishedHostResponse = Response.hostResponse(
            ref(publicHostField),
            ref(outsiderHost),
            fileValue("outsider-bio.pdf"),
        );

        await fork
            .persist([
                manager.user,
                manager.team,
                viewer.user,
                viewer.team,
                hostUser,
                stranger,
                edition,
                otherEdition,
                sessionType,
                session,
                host,
                confidentialField,
                hostField,
                publicField,
                textField,
                confidentialResponse,
                hostResponse,
                publicResponse,
                textResponse,
                publishedSession,
                unslottedSession,
                outsiderUser,
                outsiderHost,
                location,
                schedule,
                slot,
                publicHostField,
                publishedResponse,
                publishedConfidentialResponse,
                unslottedResponse,
                publishedHostResponse,
                unpublishedHostResponse,
            ])
            .flush();

        editionId = edition.id;
        otherEditionId = otherEdition.id;
        confidentialResponseId = confidentialResponse.id;
        hostResponseId = hostResponse.id;
        publicResponseId = publicResponse.id;
        textResponseId = textResponse.id;
        publishedResponseId = publishedResponse.id;
        publishedConfidentialResponseId = publishedConfidentialResponse.id;
        publishedHostResponseId = publishedHostResponse.id;
        unpublishedHostResponseId = unpublishedHostResponse.id;
        unslottedResponseId = unslottedResponse.id;
    });

    const mint = (token: string, targetEditionId: string, responseId: string) =>
        jsonApi.get(`/editions/${targetEditionId}/responses/${responseId}/file`, token);

    const expectSignedGet = async (
        token: string,
        responseId: string,
    ): Promise<SignedGetDocument> => {
        const response = await mint(token, editionId, responseId);
        assert.equal(response.status, 200);

        const document = (await response.json()) as SignedGetDocument;
        assert.equal(document.data.type, "signed_get");
        assert.equal(document.data.id, responseId);
        assert.match(document.data.attributes.url, /^http/);

        return document;
    };

    it("mints confidential responses for a manager", async () => {
        await expectSignedGet(managerToken, confidentialResponseId);
        await expectSignedGet(managerToken, hostResponseId);
    });

    it("mints a host's own responses, confidential included", async () => {
        await expectSignedGet(hostToken, hostResponseId);
        await expectSignedGet(hostToken, confidentialResponseId);
    });

    it("denies a plain user responses of sessions it does not host", async () => {
        await expectJsonApiError(
            await mint(strangerToken, editionId, publicResponseId),
            404,
            "file_not_found",
        );
        await expectJsonApiError(
            await mint(strangerToken, editionId, hostResponseId),
            404,
            "file_not_found",
        );
    });

    it("mints non-confidential responses for a viewer, but not confidential ones", async () => {
        await expectSignedGet(viewerToken, publicResponseId);
        await expectJsonApiError(
            await mint(viewerToken, editionId, confidentialResponseId),
            404,
            "file_not_found",
        );
    });

    it("mints a URL that fetches the stored bytes", async () => {
        const document = await expectSignedGet(managerToken, publicResponseId);

        const fetched = await fetch(document.data.attributes.url);
        assert.equal(fetched.status, 200);
        assert.equal(await fetched.text(), "public pdf bytes");
        assert.match(fetched.headers.get("content-disposition") ?? "", /filename="?slides\.pdf"?/);
    });

    it("answers 404 for a response that holds no file", async () => {
        await expectJsonApiError(
            await mint(managerToken, editionId, textResponseId),
            404,
            "file_not_found",
        );
    });

    it("mints a published non-confidential answer for the integration", async () => {
        await expectSignedGet(integrationToken, publishedResponseId);
    });

    it("denies the integration answers outside the current publication", async () => {
        // Both are non-confidential, and the first hangs off a submitted session
        // while the second hangs off a confirmed one that was never slotted, so
        // the publication scope is the only thing that can be refusing them.
        await expectJsonApiError(
            await mint(integrationToken, editionId, publicResponseId),
            404,
            "file_not_found",
        );
        await expectJsonApiError(
            await mint(integrationToken, editionId, unslottedResponseId),
            404,
            "file_not_found",
        );
    });

    it("denies the integration a confidential answer on a published session", async () => {
        await expectJsonApiError(
            await mint(integrationToken, editionId, publishedConfidentialResponseId),
            404,
            "file_not_found",
        );
    });

    it("mints a host answer only for a host of a published session", async () => {
        await expectSignedGet(integrationToken, publishedHostResponseId);
        await expectJsonApiError(
            await mint(integrationToken, editionId, unpublishedHostResponseId),
            404,
            "file_not_found",
        );
    });

    it("answers 404 across editions", async () => {
        await expectJsonApiError(
            await mint(managerToken, otherEditionId, publicResponseId),
            404,
            "file_not_found",
        );
    });
});
