import { JsonApiDocument } from "@jsonapi-serde/server/common";
import { m, type Router } from "@taxum/core/routing";
import { resolveUserLayer } from "../util/auth.js";
import { timeZonesIds } from "../util/time.js";
import { clockRouter } from "./clock.js";
import { editionsRouter } from "./editions/index.js";
import { sessionHostInvitesRouter } from "./invites/session-host.js";
import { teamInvitesRouter } from "./invites/team.js";
import { jobsRouter } from "./jobs.js";
import { signedPostsRouter } from "./signed-posts.js";
import { teamsRouter } from "./teams.js";
import { userRouter } from "./user.js";
import { userPurgesRouter } from "./user-purges.js";

export const registerRoutes = (router: Router): void => {
    router
        .nest("/user", userRouter)
        .nest("/teams", teamsRouter)
        .nest("/jobs", jobsRouter)
        .nest("/signed-posts", signedPostsRouter)
        .nest("/editions", editionsRouter)
        .nest("/session-host-invites", sessionHostInvitesRouter)
        .nest("/team-invites", teamInvitesRouter)
        .nest("/user-purges", userPurgesRouter)
        .layer(resolveUserLayer)
        .nest("/clock", clockRouter)
        .route(
            "/timezones",
            m.get(
                () =>
                    new JsonApiDocument({
                        data: timeZonesIds.map((id) => ({ id, type: "timezone" })),
                    }),
            ),
        );
};
