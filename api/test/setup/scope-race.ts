import assert from "node:assert/strict";
import { ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { TestResponse } from "@taxum/testing";
import { CustomField } from "../../src/entity/CustomField.js";
import { Edition } from "../../src/entity/Edition.js";
import { SessionType } from "../../src/entity/SessionType.js";
import { Track } from "../../src/entity/Track.js";
import type { ScopeDimension } from "../../src/support/custom-field-scope.js";
import { em } from "../../src/util/mikro-orm.js";
import { expectJsonApiError, jsonApi, send } from "./json-api.js";
import { releaseAfterLockWait, waitForLockWaiters } from "./locks.js";

const routeSegments: Record<ScopeDimension, string> = {
    sessionTypes: "session-types",
    tracks: "tracks",
};

type ScopeEmptyingRace = {
    editionId: string;
    managerToken: string;
    dimension: ScopeDimension;
    /** The two rows the field is scoped to, deleted in this order. */
    ids: [string, string];
    /** The lock that parks the first delete, taken in a transaction held until the second waits. */
    park: (em: EntityManager, customFieldId: string) => Promise<unknown>;
};

/**
 * Races deletes of the two rows a custom field is scoped to, and expects the second refused.
 *
 * Each delete refuses to remove the only row of its dimension a field names,
 * since an empty scope widens the field (see `customFieldsScopedSolelyTo`), but
 * reads the scoping without a lock, so two deletes of a field's two rows each
 * see the other still there. `park` has to hold the first between its check
 * and its commit, which is where the second would otherwise run its check.
 */
export const raceScopeEmptyingDeletes = async ({
    editionId,
    managerToken,
    dimension,
    ids: [firstId, secondId],
    park,
}: ScopeEmptyingRace): Promise<void> => {
    const fork = em.fork();
    const edition = await fork.findOneOrFail(Edition, editionId);
    const scoped = new CustomField({
        position: 0,
        externalKey: null,
        target: "per_proposal",
        requirement: "always_optional",
        options: { type: "single_line_text" },
        title: "Scoped to both",
        helperText: "",
        deadline: null,
        freezeAfter: null,
        edition: ref(edition),
    });

    if (dimension === "sessionTypes") {
        scoped.sessionTypes.add(
            fork.getReference(SessionType, firstId),
            fork.getReference(SessionType, secondId),
        );
    } else {
        scoped.tracks.add(fork.getReference(Track, firstId), fork.getReference(Track, secondId));
    }

    await fork.persist(scoped).flush();

    const taken = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const holding = em.fork().transactional(async (em) => {
        await park(em, scoped.id);
        taken.resolve();
        await held.promise;
    });

    await taken.promise;

    const deleteRow = (id: string): Promise<TestResponse> =>
        send(
            jsonApi.delete(
                `/editions/${editionId}/${routeSegments[dimension]}/${id}`,
                managerToken,
            ),
        );
    const first = deleteRow(firstId);
    let second: Promise<TestResponse> | undefined;
    const waitError = await releaseAfterLockWait(
        em.fork(),
        () => {
            held.resolve();
        },
        {
            whileHeld: async () => {
                second = deleteRow(secondId);
                await waitForLockWaiters(em.fork(), { count: 2 });
            },
        },
    );

    await holding;
    const firstResponse = await first;
    const secondResponse = await second;

    if (waitError !== null) {
        throw waitError;
    }

    assert.equal(firstResponse.status, 204);
    assert.ok(secondResponse);
    await expectJsonApiError(secondResponse, 409, "scope_in_use");
    const stored = await em.fork().findOneOrFail(CustomField, scoped.id, { populate: [dimension] });
    assert.deepEqual(
        stored[dimension].getItems().map((row) => row.id),
        [secondId],
    );
};
