import { Host } from "../../entity/Host.js";
import { avatarConstraints } from "../../support/profile-fields.js";
import type { JobConsumer } from "../processor.js";
import { deriveStoredImage } from "./derive-image.js";

/**
 * Not the 64 an avatar may be at its smallest.
 *
 * That renders at 32 css pixels on a doubled display, under the size the
 * smallest avatar is drawn at.
 */
const thumbnailBox = { width: 128, height: 128 };

const fullSizeBox = {
    width: avatarConstraints.maxWidth,
    height: avatarConstraints.maxHeight,
};

export const processAvatarJobConsumer: JobConsumer<"process_avatar"> = async (payload) =>
    deriveStoredImage({
        entity: Host,
        id: payload.hostId,
        key: payload.key,
        read: (host) => host.avatar,
        write: (host, descriptor) => {
            host.avatar = descriptor;
        },
        editionOf: (host) => host.edition,
        boxes: () => ({ fullSize: fullSizeBox, thumbnail: thumbnailBox }),
        bumps: () => true,
        label: "avatar",
    });
