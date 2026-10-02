import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

type Classification = {
    bumps: boolean;
    reason: string;
};

/**
 * The revision-bump decision for every write handler, with its reason.
 *
 * The test below scans the route sources and fails when the two drift apart,
 * which is the only thing that catches a route nobody thought about.
 *
 * Keys are the path under `src/route` plus the handler identifier, because
 * `acceptInviteHandler` exists twice under different modules.
 *
 * A wrong classification is not caught here. That is what review is for.
 */
const classifications: Record<string, Classification> = {
    "editions/custom-fields.ts#createCustomFieldHandler": {
        bumps: false,
        reason: "a field created here has no answers yet, so nothing serves it",
    },
    "editions/custom-fields.ts#updateCustomFieldHandler": {
        bumps: true,
        reason: "a visible attribute or the confidential flag changed on the field",
    },
    "editions/custom-fields.ts#deleteCustomFieldHandler": {
        bumps: true,
        reason: "answers cascade with the field, so the document may lose content it served",
    },

    "editions/index.ts#confirmRemindersHandler": {
        bumps: false,
        reason: "queues mail and stamps confirmationRemindedAt, neither of which is served",
    },
    "editions/index.ts#reorderCustomFieldsHandler": {
        bumps: false,
        reason: "moves position only, which is not visible and orders nothing in the document",
    },
    "editions/index.ts#reorderLocationsHandler": {
        bumps: true,
        reason: "position is served to integrations, so the column order they draw changed",
    },
    "editions/index.ts#reorderVenuesHandler": {
        bumps: true,
        reason: "position is served to integrations, so the venue order they draw changed",
    },
    "editions/index.ts#createEditionHandler": {
        bumps: false,
        reason: "a new edition has no publication",
    },
    "editions/index.ts#updateEditionHandler": {
        bumps: true,
        reason: "a visible edition attribute changed",
    },
    "editions/index.ts#deleteEditionHandler": {
        bumps: false,
        reason: "the schedules go with it; a consumer sees 404 on its next poll, per the contract",
    },

    "editions/locations.ts#createLocationHandler": {
        bumps: false,
        reason: "not yet referenced by any slot",
    },
    "editions/locations.ts#updateLocationHandler": {
        bumps: true,
        reason: "the name, external key or venue changed on the location",
    },
    "editions/locations.ts#deleteLocationHandler": {
        bumps: false,
        reason: "slot_location_id_foreign restricts, so a location in a publication cannot be deleted",
    },

    "editions/me/host.ts#updateMeHostHandler": {
        bumps: true,
        reason: "a published name, biography, avatar or non-confidential answer changed",
    },

    "editions/schedules/index.ts#createSlotHandler": {
        bumps: false,
        reason: "writes a draft schedule only",
    },
    "editions/schedules/index.ts#updateSlotHandler": {
        bumps: false,
        reason: "writes a draft schedule only",
    },
    "editions/schedules/index.ts#deleteSlotHandler": {
        bumps: false,
        reason: "writes a draft schedule only",
    },
    "editions/schedules/index.ts#publishScheduleHandler": {
        bumps: true,
        reason: "publication changes what current serves",
    },
    "editions/schedules/index.ts#revertScheduleHandler": {
        bumps: false,
        reason: "refills a draft and leaves the publication it copies untouched",
    },

    "editions/session-types.ts#createSessionTypeHandler": {
        bumps: false,
        reason: "no session references it yet",
    },
    "editions/session-types.ts#updateSessionTypeHandler": {
        bumps: true,
        reason: "a visible attribute changed on the type",
    },
    "editions/session-types.ts#deleteSessionTypeHandler": {
        bumps: false,
        reason: "session_session_type_id_foreign restricts, so a type any session uses cannot be deleted",
    },
    "editions/session-types.ts#promoteSessionTypeToDefaultHandler": {
        bumps: false,
        reason: "moves selectionDefault only, which is not visible to an integration",
    },

    "editions/sessions/index.ts#createSessionHandler": {
        bumps: false,
        reason: "a session is created submitted, so it is in no publication",
    },
    "editions/sessions/index.ts#updateSessionHandler": {
        bumps: true,
        reason: "an attribute, relationship or answer changed on a confirmed session",
    },
    "editions/sessions/index.ts#deleteSessionHandler": {
        bumps: false,
        reason: "refuses anything but a submitted session with no history",
    },
    "editions/sessions/index.ts#createTransitionHandler": {
        bumps: true,
        reason: "the session is confirmed on one side of the change",
    },
    "editions/sessions/index.ts#createHostInviteHandler": {
        bumps: false,
        reason: "an invite is not in the document until it is accepted",
    },
    "editions/sessions/index.ts#deleteHostInviteHandler": {
        bumps: false,
        reason: "an invite is not in the document",
    },
    "editions/sessions/index.ts#removeHostsHandler": {
        bumps: true,
        reason: "a confirmed session loses a host",
    },

    "editions/tracks.ts#createTrackHandler": {
        bumps: false,
        reason: "no session references it yet",
    },
    "editions/tracks.ts#updateTrackHandler": {
        bumps: true,
        reason: "a visible attribute changed on the track",
    },
    "editions/tracks.ts#deleteTrackHandler": {
        bumps: true,
        reason: "the delete detaches sessions via SET NULL and removes a track the document may serve",
    },

    "editions/venues.ts#createVenueHandler": {
        bumps: false,
        reason: "a new venue is referenced by nothing",
    },
    "editions/venues.ts#updateVenueHandler": {
        bumps: true,
        reason: "the name, address or external key changed on the venue",
    },
    "editions/venues.ts#deleteVenueHandler": {
        bumps: false,
        reason: "a venue no location names is in no publication",
    },

    "invites/session-host.ts#acceptInviteHandler": {
        bumps: true,
        reason: "a confirmed session gains a host",
    },
    "invites/team.ts#acceptInviteHandler": {
        bumps: false,
        reason: "team membership is organizer-side",
    },

    "jobs.ts#cancelJobHandler": {
        bumps: false,
        reason: "operational, and touches no document row",
    },
    "jobs.ts#retryJobHandler": {
        bumps: false,
        reason: "operational, and touches no document row",
    },
    "signed-posts.ts#createSignedPostHandler": {
        bumps: false,
        reason: "mints an upload credential and writes a pending upload no document carries",
    },

    "teams.ts#createTeamHandler": { bumps: false, reason: "organizer-side" },
    "teams.ts#updateTeamHandler": { bumps: false, reason: "organizer-side" },
    "teams.ts#deleteTeamHandler": { bumps: false, reason: "organizer-side" },
    "teams.ts#removeUsersHandler": { bumps: false, reason: "organizer-side" },
    "teams.ts#createInviteHandler": { bumps: false, reason: "organizer-side" },
    "teams.ts#deleteInviteHandler": { bumps: false, reason: "organizer-side" },

    "user-purges.ts#createPurgeHandler": {
        bumps: true,
        reason: "the Host cascade removes a host from every edition that served one",
    },
    "user.ts#replaceUserHandler": {
        bumps: false,
        reason: "writes the User row; a Host is a per-edition snapshot that never re-syncs",
    },
};

// A floor rather than an equality, so adding a route does not fail here as
// well as on the classification assertions. Its job is to catch the scan
// matching nothing after a refactor, which would otherwise pass vacuously.
const MINIMUM_HANDLERS = 40;

/**
 * A GET that writes, which the scan below cannot see.
 *
 * Naming it here does not make the scan find it. What it buys is that the name
 * has to keep existing, so this note cannot quietly outlive the handler it
 * describes, and a reader looking for every write has one place to look.
 */
type WritingGet = {
    reason: string;
};

const writingGets: Record<string, WritingGet> = {
    "editions/me/host.ts#showMeHostHandler": {
        reason: "creates the caller's host from their user record, which no document serves yet",
    },
};

// The scan anchors on the method-router alias and walks each chain, so
// m.get(a).patch(b).delete(c) yields b and c. Any write registration whose
// argument is not a bare handler identifier is a violation: a wrapped or
// inline handler would ship unclassified and unbumped with nothing failing,
// since the classification could not see it. Paren counting is naive: an
// unbalanced paren inside a string would derail the walk. Write links are
// refused unless the argument is a bare identifier, but get and layer
// arguments are not checked, so one carrying such a string would let the rest
// of its chain escape unseen.
type FileScan = {
    handlers: string[];
    violations: string[];
};

const findClosingParen = (source: string, openIndex: number): number => {
    let depth = 0;

    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === "(") {
            depth += 1;
        } else if (source[index] === ")") {
            depth -= 1;

            if (depth === 0) {
                return index;
            }
        }
    }

    return source.length;
};

type ChainLink = {
    method: string;
    openIndex: number;
};

const nextChainLink = (source: string, afterIndex: number): ChainLink | null => {
    let index = afterIndex;

    for (;;) {
        if (index < source.length && /\s/.test(source[index])) {
            index += 1;
        } else if (source.startsWith("//", index)) {
            // A comment between chain links must not end the walk, or the
            // registrations after it silently escape the scan.
            while (index < source.length && source[index] !== "\n") {
                index += 1;
            }
        } else {
            break;
        }
    }

    const chained = /^\.\s*(get|post|patch|put|delete|layer)\s*\(/.exec(
        source.slice(index, index + 16),
    );

    if (chained === null) {
        return null;
    }

    return { method: chained[1], openIndex: index + chained[0].length - 1 };
};

const scanSource = (source: string): FileScan => {
    const handlers: string[] = [];
    const violations: string[] = [];
    const headPattern = /\bm\s*\.\s*(get|post|patch|put|delete)\s*\(/g;
    let head = headPattern.exec(source);

    while (head !== null) {
        let link: ChainLink | null = {
            method: head[1],
            openIndex: head.index + head[0].length - 1,
        };

        while (link !== null) {
            const closeIndex = findClosingParen(source, link.openIndex);
            const argument = source.slice(link.openIndex + 1, closeIndex).trim();

            if (link.method !== "get" && link.method !== "layer") {
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument)) {
                    handlers.push(argument);
                } else {
                    violations.push(`${link.method}(${argument})`);
                }
            }

            link = nextChainLink(source, closeIndex + 1);

            if (link !== null) {
                headPattern.lastIndex = link.openIndex + 1;
            }
        }

        head = headPattern.exec(source);
    }

    return { handlers, violations };
};

const scanWriteHandlers = (): Set<string> => {
    const found = new Set<string>();

    for (const file of globSync("src/**/*.ts")) {
        const source = readFileSync(file, "utf8");
        const module = file.replace(/^src\/route\//, "").replace(/^src\//, "");
        const { handlers, violations } = scanSource(source);

        assert.deepEqual(
            violations,
            [],
            `${file} registers a write route that is not a bare handler identifier`,
        );

        for (const handler of handlers) {
            found.add(`${module}#${handler}`);
        }
    }

    return found;
};

describe("write handler classification", () => {
    it("finds the write routes at all", () => {
        assert.ok(
            scanWriteHandlers().size >= MINIMUM_HANDLERS,
            `scanned ${scanWriteHandlers().size.toString()} write handlers, expected at least ${MINIMUM_HANDLERS.toString()}`,
        );
    });

    it("classifies every write handler in the route sources", () => {
        const unclassified = [...scanWriteHandlers()].filter(
            (handler) => !(handler in classifications),
        );

        assert.deepEqual(
            unclassified,
            [],
            "a write route was added without deciding whether it bumps the schedule revision",
        );
    });

    it("keeps every GET that writes named and present", () => {
        const missing = Object.keys(writingGets).filter((handler) => {
            const [module, name] = handler.split("#");

            return !readFileSync(`src/route/${module}`, "utf8").includes(`const ${name} =`);
        });

        assert.deepEqual(missing, [], "a GET listed as writing was renamed or removed");
    });

    it("keeps no classification for a route that is gone", () => {
        const scanned = scanWriteHandlers();
        const stale = Object.keys(classifications).filter((handler) => !scanned.has(handler));

        assert.deepEqual(stale, [], "a classified write route no longer exists");
    });
});
