import { type InferSerializeMap, SerializeBuilder } from "@jsonapi-serde/server/response";
import { customFieldSerializer } from "./custom-field.js";
import { editionSerializer } from "./edition.js";
import { hostSerializer } from "./host.js";
import { hostAvailabilitySerializer } from "./host-availability.js";
import { jobSerializer } from "./job.js";
import { locationSerializer } from "./location.js";
import { locationAvailabilitySerializer } from "./location-availability.js";
import { responseSerializer } from "./response.js";
import { scheduleSerializer } from "./schedule.js";
import { sessionSerializer } from "./session.js";
import { sessionHostInviteSerializer } from "./session-host-invite.js";
import { sessionHostInvitePreviewSerializer } from "./session-host-invite-preview.js";
import { sessionTransitionSerializer } from "./session-transition.js";
import { sessionTypeSerializer } from "./session-type.js";
import { slotSerializer } from "./slot.js";
import { teamSerializer } from "./team.js";
import { teamInviteSerializer } from "./team-invite.js";
import { teamInvitePreviewSerializer } from "./team-invite-preview.js";
import { trackSerializer } from "./track.js";
import { userSerializer } from "./user.js";
import { venueSerializer } from "./venue.js";

export const serialize = SerializeBuilder.new()
    .add("response", responseSerializer)
    .add("edition", editionSerializer)
    .add("team_invite", teamInviteSerializer)
    .add("host", hostSerializer)
    .add("host_availability", hostAvailabilitySerializer)
    .add("job", jobSerializer)
    .add("location", locationSerializer)
    .add("location_availability", locationAvailabilitySerializer)
    .add("custom_field", customFieldSerializer)
    .add("schedule", scheduleSerializer)
    .add("session", sessionSerializer)
    .add("session_host_invite_preview", sessionHostInvitePreviewSerializer)
    .add("session_host_invite", sessionHostInviteSerializer)
    .add("session_transition", sessionTransitionSerializer)
    .add("session_type", sessionTypeSerializer)
    .add("slot", slotSerializer)
    .add("team", teamSerializer)
    .add("team_invite_preview", teamInvitePreviewSerializer)
    .add("track", trackSerializer)
    .add("user", userSerializer)
    .add("venue", venueSerializer)
    .build();

export type SerializeMap = InferSerializeMap<typeof serialize>;
