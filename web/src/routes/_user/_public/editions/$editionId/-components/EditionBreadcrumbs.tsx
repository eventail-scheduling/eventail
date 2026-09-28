import { Breadcrumbs, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useMatches, useParams } from "@tanstack/react-router";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { Link } from "#/components/Link/index.js";
import { useQueryOptionsFactory } from "#/queries";
import type { Edition } from "#/queries/edition.ts";

const PROFILE_ROUTE_ID = "/_user/_public/editions/$editionId/profile";
const CREATE_ROUTE_ID = "/_user/_public/editions/$editionId/sessions/create";
const SESSION_EDIT_ROUTE_ID = "/_user/_public/editions/$editionId/sessions/$sessionId/edit";

/**
 * A crumb carries its own rendered link.
 *
 * Each one addresses a different route, and a typed link cannot be built from a
 * path string.
 *
 * An element rather than a node, so the key can be cloned onto it: Breadcrumbs
 * wraps each child in its own `li` and refuses a Fragment.
 */
type Crumb = {
    key: string;
    label: string;
    link: ReactElement | null;
};

type EditionBreadcrumbsProps = {
    edition: Pick<Edition, "id" | "name">;
};

/**
 * The only way out of a speaker page, and the only thing naming the edition.
 *
 * This surface has no drawer and no page links to another.
 */
export const EditionBreadcrumbs = ({ edition }: EditionBreadcrumbsProps): ReactNode => {
    const qof = useQueryOptionsFactory();
    const { sessionId } = useParams({ strict: false });
    const routeId = useMatches({ select: (matches) => matches[matches.length - 1]?.routeId });

    // Every route that names a session has already loaded it, so this reads the
    // cache rather than fetching.
    const session = useQuery({
        ...qof.session.get(edition.id, sessionId ?? ""),
        enabled: sessionId !== undefined,
    });

    const crumbs: Crumb[] = [
        { key: "editions", label: "Editions", link: <Link to="/">Editions</Link> },
        {
            key: "edition",
            label: edition.name,
            link: (
                <Link to="/editions/$editionId/sessions" params={{ editionId: edition.id }}>
                    {edition.name}
                </Link>
            ),
        },
    ];

    if (routeId === PROFILE_ROUTE_ID) {
        crumbs.push({ key: "leaf", label: "Your profile", link: null });
    }

    if (routeId === CREATE_ROUTE_ID) {
        crumbs.push({ key: "leaf", label: "Submit a session", link: null });
    }

    if (sessionId !== undefined && session.data !== undefined) {
        crumbs.push({
            key: "session",
            label: session.data.title,
            link: (
                <Link
                    to="/editions/$editionId/sessions/$sessionId"
                    params={{ editionId: edition.id, sessionId }}
                >
                    {session.data.title}
                </Link>
            ),
        });

        if (routeId === SESSION_EDIT_ROUTE_ID) {
            crumbs.push({ key: "leaf", label: "Edit", link: null });
        }
    }

    // No branch for the session list on purpose: it is the edition's own page,
    // so a "Your sessions" crumb would sit beside a link that already says it.

    return (
        <Breadcrumbs sx={{ mt: 2 }}>
            {crumbs.map((crumb, index) =>
                index === crumbs.length - 1 || crumb.link === null ? (
                    <Typography key={crumb.key} color="text.primary">
                        {crumb.label}
                    </Typography>
                ) : (
                    cloneElement(crumb.link, { key: crumb.key })
                ),
            )}
        </Breadcrumbs>
    );
};
