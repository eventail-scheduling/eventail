import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import { JsonApiDocument } from "@jsonapi-serde/server/common";
import { LockMode } from "@mikro-orm/core";
import { extension } from "@taxum/core/extract";
import { createExtractHandler } from "@taxum/core/routing";
import { isBefore } from "temporal-extra";
import { Session } from "../../entity/Session.js";
import { pinEdition } from "../../support/locking.js";
import { queueMail, sessionUrl } from "../../support/mail.js";
import { appConfig } from "../../util/app-config.js";
import { em } from "../../util/mikro-orm.js";
import { instantAgo } from "../../util/time.js";
import { EDITION } from "./resolve-edition-layer.js";

export const confirmRemindersHandler = createExtractHandler(
    jsonApiResource({ type: "confirm_reminder_dispatch" }),
    extension(EDITION, true),
).handler(async (_resource, edition) => {
    const cooldownThreshold = instantAgo(appConfig.email.confirmReminderCooldown);

    const { reminded, skipped } = await em.transactional(async (em) => {
        await pinEdition(em, edition);

        // One locked snapshot for both numbers; counting separately would
        // let the two statements see different states.
        const acceptedSessions = await em.populate(
            await em.find(
                Session,
                { edition, state: "accepted" },
                { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "asc" } },
            ),
            ["hosts"],
        );
        const dueSessions = acceptedSessions.filter(
            (session) =>
                session.confirmationRemindedAt === null ||
                isBefore(session.confirmationRemindedAt, cooldownThreshold),
        );

        const now = Temporal.Now.instant();
        let reminded = 0;

        for (const session of dueSessions) {
            if (session.hosts.length === 0) {
                continue;
            }

            const url = sessionUrl(edition.id, session.id);

            for (const host of session.hosts) {
                await queueMail(em, {
                    template: "session-confirm-reminder",
                    recipient: host.emailAddress,
                    variables: {
                        hostName: host.displayName,
                        sessionTitle: session.title,
                        editionName: edition.name,
                        sessionUrl: url,
                    },
                });
            }

            session.confirmationRemindedAt = now;
            em.persist(session);
            reminded += 1;
        }

        return { reminded, skipped: acceptedSessions.length - reminded };
    });

    return new JsonApiDocument({
        meta: { remindedSessions: reminded, skippedSessions: skipped },
    });
});
