import { Router } from "@taxum/core/routing";
import { meHostRouter } from "./host.js";
import { meSessionsRouter } from "./sessions.js";

export { addOpenapiMeHostPaths } from "./host.js";
export { addOpenapiMeSessionPaths } from "./sessions.js";

export const meRouter = new Router()
    .nest("/host", meHostRouter)
    .nest("/sessions", meSessionsRouter);
