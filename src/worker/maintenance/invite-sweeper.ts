import { SessionHostInvite } from "../../entity/SessionHostInvite.js";
import { TeamInvite } from "../../entity/TeamInvite.js";
import { inviteExpiryThreshold } from "../../support/invites.js";
import { appConfig } from "../../util/app-config.js";
import { IntervalTask } from "../loop.js";
import { abortableFork } from "./util.js";

const config = appConfig.worker.inviteSweeper;

export class InviteSweeper extends IntervalTask {
    public constructor() {
        super({ interval: config.interval, failureMessage: "Failed to sweep expired invites" });
    }

    public async runOnce(signal?: AbortSignal): Promise<void> {
        const threshold = inviteExpiryThreshold();
        const fork = abortableFork(signal);

        await fork.nativeDelete(TeamInvite, { createdAt: { $lt: threshold } });
        await fork.nativeDelete(SessionHostInvite, { createdAt: { $lt: threshold } });
    }
}
