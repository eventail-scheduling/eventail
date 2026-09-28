import { m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { RequireAuthorizationLayer } from "../../../util/auth.js";
import {
    addOpenapiScheduleLifecyclePaths,
    publishScheduleHandler,
    revertScheduleHandler,
} from "./lifecycle.js";
import {
    addOpenapiScheduleReadPaths,
    listSchedulesHandler,
    showCurrentScheduleHandler,
    showLatestScheduleHandler,
    showScheduleHandler,
} from "./read.js";
import {
    addOpenapiSlotPaths,
    createSlotHandler,
    deleteSlotHandler,
    updateSlotHandler,
} from "./slots.js";

const requireViewerOrIntegrationLayer = new RequireAuthorizationLayer({
    user: { role: "viewer" },
    integration: true,
});

const requireViewerLayer = new RequireAuthorizationLayer({ user: { role: "viewer" } });

export const schedulesRouter = new Router()
    .route("/:scheduleId/publication", m.post(publishScheduleHandler))
    .route("/:scheduleId/reversion", m.post(revertScheduleHandler))
    .route("/:scheduleId/slots", m.post(createSlotHandler))
    .route("/:scheduleId/slots/:slotId", m.patch(updateSlotHandler).delete(deleteSlotHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "manager" } }))
    .route("/", m.get(listSchedulesHandler).layer(requireViewerLayer))
    .route("/current", m.get(showCurrentScheduleHandler).layer(requireViewerOrIntegrationLayer))
    .route("/latest", m.get(showLatestScheduleHandler).layer(requireViewerLayer))
    .route("/:scheduleId", m.get(showScheduleHandler).layer(requireViewerLayer));

export const addOpenapiSchedulePaths = (builder: OpenApiBuilder): void => {
    addOpenapiScheduleReadPaths(builder);
    addOpenapiScheduleLifecyclePaths(builder);
    addOpenapiSlotPaths(builder);
};
