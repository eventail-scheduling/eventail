import { JsonApiError } from "@jsonapi-serde/server/common";
import { type EntityManager, type Loaded, LockMode, type Ref, ref } from "@mikro-orm/core";
import { CustomField } from "../entity/CustomField.js";
import type { Edition } from "../entity/Edition.js";
import { Host } from "../entity/Host.js";
import { Response } from "../entity/Response.js";
import type { Session } from "../entity/Session.js";
import type { User } from "../entity/User.js";
import {
    type ProfileFieldAttributeName,
    requiresAvailability,
    unfilledProfileFields,
} from "./profile-fields.js";

/**
 * Creates the host record if this user has none for the edition.
 *
 * What comes back may never have been flushed, so a collection method such as
 * `loadCount` fails on it. Querying by it is fine, since the id is assigned
 * client side. Takes a write lock on the user row until commit, which is what
 * the user sweeper waits on, and which keeps two concurrent first calls for one
 * user from both taking the create branch into the (edition, user) unique
 * constraint.
 */
export const resolveHost = async (
    em: EntityManager,
    edition: Ref<Edition>,
    user: User,
): Promise<Host> => {
    await em.lock(user, LockMode.PESSIMISTIC_WRITE);

    const existing = await em.findOne(Host, { edition, user });

    if (existing) {
        return existing;
    }

    const host = new Host({
        displayName: user.displayName,
        emailAddress: user.emailAddress,
        biography: "",
        edition,
        user: ref(user),
    });
    em.persist(host);

    return host;
};

export const hostsSession = (session: Loaded<Session, "hosts">, user: User): boolean =>
    session.hosts.getItems().some((host) => host.user.id === user.id);

type ProfileGaps = {
    fields: ProfileFieldAttributeName[];
    customFieldIds: string[];
    availability: boolean;
};

const findUnansweredCustomFields = async (
    em: EntityManager,
    edition: Edition,
    host: Host,
): Promise<string[]> => {
    const customFields = await em.find(CustomField, { edition, target: "per_host" });

    if (customFields.length === 0) {
        return [];
    }

    const responses = await em.find(Response, { host });
    const valueByCustomFieldId = new Map(
        responses.map((response) => [response.customField.id, response.value]),
    );

    return customFields
        .filter((customField) => {
            // A frozen question can no longer be answered at all, so demanding
            // it would close the edition to this host with nothing they could
            // do about it.
            if (customField.frozen || !customField.required) {
                return false;
            }

            if (!valueByCustomFieldId.has(customField.id)) {
                return true;
            }

            const value = valueByCustomFieldId.get(customField.id);

            // A stored file answer holds the descriptor it was attached as, which
            // the input schema, taking only a fresh upload, never accepts.
            if (customField.options.type === "file") {
                return value === null;
            }

            return !customField.getResponseSchema().safeParse(value).success;
        })
        .map((customField) => customField.id);
};

/**
 * Counts without a query when the host has never been flushed.
 *
 * resolveHost hands back a host that may never have been flushed, and asking
 * the database to count rows against one it has not been told about fails
 * outright. A host built moments ago has drawn nothing, which is what the sync
 * count on its already initialized collection reports.
 */
const countAvailability = async (host: Host): Promise<number> =>
    host.availabilities.isInitialized()
        ? host.availabilities.count()
        : await host.availabilities.loadCount();

/**
 * Judges a host's own record whole, at the one moment anything does.
 *
 * Every write is partial, so a requirement there only forbids emptying a field,
 * and this is where an edition asks whether it was ever filled. Deliberately not
 * on update: a requirement added later would otherwise lock a speaker out of a
 * session they already have.
 */
export const assertHostProfileComplete = async (
    em: EntityManager,
    edition: Edition,
    host: Host,
): Promise<void> => {
    const gaps: ProfileGaps = {
        fields: unfilledProfileFields(edition, host),
        customFieldIds: await findUnansweredCustomFields(em, edition, host),
        availability: requiresAvailability(edition) && (await countAvailability(host)) === 0,
    };

    if (gaps.fields.length === 0 && gaps.customFieldIds.length === 0 && !gaps.availability) {
        return;
    }

    throw new JsonApiError({
        status: "422",
        code: "incomplete_profile",
        title: "Incomplete profile",
        detail: "The profile this edition asks for has not been filled in",
        meta: {
            missingFields: gaps.fields,
            missingCustomFieldIds: gaps.customFieldIds,
            missingAvailability: gaps.availability,
        },
    });
};
