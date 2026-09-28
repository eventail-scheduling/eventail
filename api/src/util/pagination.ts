import type { EntityName, FilterObject, FindByCursorOptions, Loaded } from "@mikro-orm/core";
import { em } from "./mikro-orm.js";
import type { PageParams } from "./zod.js";

/**
 * Takes strings alone, because a cursor comes back through a plain JSON parse.
 *
 * The route's cursor schema reads it with no revival step, so only a value
 * that survives that round trip unchanged belongs here. A uuidv7 primary key
 * is time-ordered by construction, which makes an id-only cursor enough for
 * creation-ordered lists.
 */
export const encodeCursor = (values: Record<string, string>): string =>
    Buffer.from(JSON.stringify(values), "utf8").toString("base64url");

type PaginationLinks = {
    first: string | null;
    prev: string | null;
    next: string | null;
};

type PageItem<TEntity, THint extends string> = Loaded<TEntity, THint, never, never>;

type FindPageOptions<TEntity extends object, THint extends string> = Omit<
    FindByCursorOptions<NoInfer<TEntity>, THint, never, never, false>,
    "after" | "before" | "first" | "last" | "includeCount" | "using"
> & {
    page: PageParams<FilterObject<NoInfer<TEntity>>>;
    createCursor: (item: PageItem<TEntity, THint>) => string;
    /**
     * Whether to count the rows the filter matched, beyond the page served.
     *
     * A second query every time, so it is asked for rather than assumed.
     */
    countMatches?: boolean;
};

type FoundPage<TEntity extends object, THint extends string> = {
    items: PageItem<TEntity, THint>[];
    links: PaginationLinks;
    /** Absent unless it was asked for, rather than zero. */
    total: number | undefined;
};

export const findPage = async <TEntity extends object, THint extends string = never>(
    entityName: EntityName<TEntity>,
    requestUri: URL,
    { page, createCursor, countMatches = false, ...options }: FindPageOptions<TEntity, THint>,
): Promise<FoundPage<TEntity, THint>> => {
    const cursor = await em.findByCursor(entityName, {
        ...options,
        after: page.after,
        before: page.before,
        first: page.before ? undefined : page.size,
        last: page.before ? page.size : undefined,
        includeCount: countMatches,
    });

    const { items } = cursor;

    return {
        items,
        total: countMatches ? cursor.totalCount : undefined,
        links: {
            first: cursor.hasPrevPage ? createHref(requestUri, page.size, null, null) : null,
            prev:
                cursor.hasPrevPage && items.length > 0
                    ? createHref(requestUri, page.size, createCursor(items[0]), null)
                    : null,
            next:
                cursor.hasNextPage && items.length > 0
                    ? createHref(requestUri, page.size, null, createCursor(items[items.length - 1]))
                    : null,
        },
    };
};

const createHref = (
    requestUri: URL,
    size: number,
    before: string | null,
    after: string | null,
): string => {
    const url = new URL(requestUri);
    url.searchParams.set("page[size]", size.toString());

    if (before) {
        url.searchParams.set("page[before]", before);
    } else {
        url.searchParams.delete("page[before]");
    }

    if (after) {
        url.searchParams.set("page[after]", after);
    } else {
        url.searchParams.delete("page[after]");
    }

    return url.toString();
};
