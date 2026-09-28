import { Session } from "../../entity/Session.js";
import { resolveTeaserImageConstraints } from "../../support/session-fields.js";
import type { JobConsumer } from "../processor.js";
import { deriveStoredImage } from "./derive-image.js";

const thumbnailBox = { width: 640, height: 640 };

export const processTeaserImageJobConsumer: JobConsumer<"process_teaser_image"> = async (payload) =>
    deriveStoredImage({
        entity: Session,
        id: payload.sessionId,
        key: payload.key,
        read: (session) => session.teaserImage,
        write: (session, descriptor) => {
            session.teaserImage = descriptor;
        },
        editionOf: (session) => session.edition,
        boxes: (edition) => {
            const constraints = resolveTeaserImageConstraints(edition);

            return {
                fullSize: { width: constraints.maxWidth, height: constraints.maxHeight },
                thumbnail: thumbnailBox,
            };
        },
        bumps: (session) => session.state === "confirmed",
        label: "teaser image",
    });
