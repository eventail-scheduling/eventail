import type { _Object } from "@aws-sdk/client-s3";
import type { EntityManager } from "@mikro-orm/postgresql";
import { isBefore } from "temporal-extra";
import { appConfig } from "../../util/app-config.js";
import { logger } from "../../util/logger.js";
import { s3Client } from "../../util/s3.js";
import { instantAgo } from "../../util/time.js";
import { IntervalTask } from "../loop.js";
import { abortableFork } from "./util.js";

const config = appConfig.worker.filePruner;

// A stored file is referenced by a session teaser image, a host avatar or a
// file response, each holding a descriptor object with a key. The response
// query matches by shape instead of joining the custom field type;
// over-matching can only protect an object, never delete one. The completeness
// test in test/worker/maintenance/file-pruner-registry.test.ts holds this
// statement to the FileDescriptor-typed entity properties.
export const referencedKeysStatement = `
    SELECT "teaser_image"->>'key' AS "key" FROM "session"
    WHERE "teaser_image" IS NOT NULL
    UNION
    SELECT "teaser_image"->>'thumbnailKey' AS "key" FROM "session"
    WHERE "teaser_image" IS NOT NULL
    UNION
    SELECT "avatar"->>'key' AS "key" FROM "host"
    WHERE "avatar" IS NOT NULL
    UNION
    SELECT "avatar"->>'thumbnailKey' AS "key" FROM "host"
    WHERE "avatar" IS NOT NULL
    UNION
    SELECT "value"->>'key' AS "key" FROM "response"
    WHERE jsonb_typeof("value") = 'object' AND "value" ? 'key'
`;

type FilePrunerOptions = {
    minimumAge?: Temporal.Duration;
};

type CandidateRow = {
    key: string;
    marked_at_epoch: number;
};

export class FilePruner extends IntervalTask {
    private readonly minimumAge: Temporal.Duration;

    public constructor(options: FilePrunerOptions = {}) {
        super({ interval: config.interval, failureMessage: "Failed to prune orphaned files" });
        this.minimumAge = options.minimumAge ?? config.minimumAge;
    }

    public async runOnce(signal?: AbortSignal): Promise<void> {
        const fork = abortableFork(signal);
        const referencedKeys = await this.loadReferencedKeys(fork);
        const cutoff = instantAgo(this.minimumAge);
        const { expiredTempKeys, orphanedKeys } = await this.scanBucket(referencedKeys, cutoff);

        const candidateRows: CandidateRow[] = await fork.execute(
            `SELECT "key", extract(epoch FROM "marked_at")::float8 AS "marked_at_epoch"
             FROM "file_deletion_candidate"`,
        );
        const { dueKeys, staleRowKeys, newlyOrphanedKeys } = classifyCandidates(
            candidateRows,
            orphanedKeys,
            cutoff,
        );

        const failedKeys = await this.deleteObjectKeys([...expiredTempKeys, ...dueKeys]);
        const deletedDueKeys = dueKeys.filter((key) => !failedKeys.has(key));

        for (const keys of chunk([...deletedDueKeys, ...staleRowKeys], 1000)) {
            await fork.execute(
                `DELETE FROM "file_deletion_candidate" WHERE "key" IN (${placeholders(keys)})`,
                keys,
            );
        }

        // Swept by their own age rather than alongside the objects this run
        // deleted: a lifecycle rule or an operator can remove a temporary
        // object without us ever seeing it, which would strand the row.
        await fork.execute(`DELETE FROM "pending_upload" WHERE "created_at" < ?`, [
            cutoff.toString(),
        ]);

        const markedAt = Temporal.Now.instant().toString();

        for (const keys of chunk(newlyOrphanedKeys, 1000)) {
            await fork.execute(
                `
                    INSERT INTO "file_deletion_candidate" ("key", "marked_at")
                    VALUES ${keys.map(() => "(?, ?)").join(", ")}
                    ON CONFLICT DO NOTHING
                `,
                keys.flatMap((key) => [key, markedAt]),
            );
        }

        if (expiredTempKeys.length > 0 || deletedDueKeys.length > 0) {
            logger.info("Pruned orphaned files", {
                tempCount: expiredTempKeys.filter((key) => !failedKeys.has(key)).length,
                orphanCount: deletedDueKeys.length,
            });
        }
    }

    // A per-key delete failure must keep its candidate row: clearing it would
    // restart the grace period from zero on every retry.
    private async deleteObjectKeys(keys: string[]): Promise<Set<string>> {
        const failedKeys = new Set<string>();

        for (const batch of chunk(keys, 1000)) {
            const result = await s3Client.deleteObjects({
                Bucket: appConfig.s3.bucketName,
                Delete: { Objects: batch.map((key) => ({ Key: key })) },
            });

            for (const error of result.Errors ?? []) {
                if (error.Key !== undefined) {
                    failedKeys.add(error.Key);
                }
            }
        }

        return failedKeys;
    }

    // Temp uploads never gain a reference in place, so their upload age is
    // the whole story. Everything else gets the two-phase treatment.
    private async scanBucket(
        referencedKeys: Set<string>,
        cutoff: Temporal.Instant,
    ): Promise<BucketScan> {
        const expiredTempKeys: string[] = [];
        const orphanedKeys = new Set<string>();
        let continuationToken: string | undefined;

        do {
            const listing = await s3Client.listObjectsV2({
                Bucket: appConfig.s3.bucketName,
                ContinuationToken: continuationToken,
            });

            for (const object of listing.Contents ?? []) {
                collectObject(object, referencedKeys, cutoff, { expiredTempKeys, orphanedKeys });
            }

            continuationToken = listing.NextContinuationToken;
        } while (continuationToken);

        return { expiredTempKeys, orphanedKeys };
    }

    private async loadReferencedKeys(fork: EntityManager): Promise<Set<string>> {
        const rows = await fork.execute<{ key: string }[]>(referencedKeysStatement);

        return new Set(rows.map((row) => row.key));
    }
}

type BucketScan = {
    expiredTempKeys: string[];
    orphanedKeys: Set<string>;
};

const collectObject = (
    object: Pick<_Object, "Key" | "LastModified">,
    referencedKeys: Set<string>,
    cutoff: Temporal.Instant,
    scan: BucketScan,
): void => {
    if (!(object.Key && object.LastModified)) {
        return;
    }

    if (!object.Key.startsWith("temp/")) {
        if (!referencedKeys.has(object.Key)) {
            scan.orphanedKeys.add(object.Key);
        }

        return;
    }

    const lastModified = object.LastModified.toTemporalInstant();

    if (isBefore(lastModified, cutoff)) {
        scan.expiredTempKeys.push(object.Key);
    }
};

type CandidateClassification = {
    dueKeys: string[];
    staleRowKeys: string[];
    newlyOrphanedKeys: string[];
};

const classifyCandidates = (
    candidateRows: CandidateRow[],
    orphanedKeys: Set<string>,
    cutoff: Temporal.Instant,
): CandidateClassification => {
    const dueKeys: string[] = [];
    const staleRowKeys: string[] = [];
    const markedKeys = new Set<string>();

    for (const row of candidateRows) {
        if (!orphanedKeys.has(row.key)) {
            // Referenced again, or the object is already gone.
            staleRowKeys.push(row.key);
            continue;
        }

        markedKeys.add(row.key);

        const markedAt = Temporal.Instant.fromEpochMilliseconds(
            Math.round(row.marked_at_epoch * 1000),
        );

        if (isBefore(markedAt, cutoff)) {
            dueKeys.push(row.key);
        }
    }

    const newlyOrphanedKeys = [...orphanedKeys].filter((key) => !markedKeys.has(key));

    return { dueKeys, staleRowKeys, newlyOrphanedKeys };
};

const placeholders = (values: unknown[]): string => values.map(() => "?").join(", ");

const chunk = <T>(items: T[], size: number): T[][] => {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
};
