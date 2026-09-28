import { JsonApiError } from "@jsonapi-serde/server/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import { isAfter } from "temporal-extra";

// Expressed in hours: this is added to Instants, which reject calendar units.
export const inviteTimeToLive = Temporal.Duration.from({ hours: 14 * 24 });

type ExpirableInvite = {
    createdAt: Temporal.Instant;
    /** Absent on invites that cannot be revoked, which is the same as not revoked. */
    revokedAt?: Temporal.Instant | null;
};

type AcceptableInvite = ExpirableInvite & {
    emailAddress: string;
};

type InviteRecipient = {
    emailAddress: string;
};

type InviteScope = "team" | "session";

export const isInviteExpired = (invite: ExpirableInvite): boolean =>
    isAfter(Temporal.Now.instant(), invite.createdAt.add(inviteTimeToLive));

export const inviteExpiryThreshold = (): Temporal.Instant =>
    Temporal.Now.instant().subtract(inviteTimeToLive);

/**
 * Makes room for a new invite to an address that may already have one.
 *
 * An expired invite is dropped, a pending one blocks the new invite.
 */
export const clearExistingInvite = async (
    em: EntityManager,
    existingInvite: ExpirableInvite | null,
    scope: InviteScope,
): Promise<void> => {
    if (!existingInvite) {
        return;
    }

    if (!isInviteExpired(existingInvite)) {
        throw new JsonApiError({
            status: "409",
            code: "invite_exists",
            title: "Invite exists",
            detail: `This address already has a pending invite for this ${scope}`,
            source: { pointer: "/data/attributes/emailAddress" },
        });
    }

    em.remove(existingInvite);
    await em.flush();
};

/**
 * Validates an invite resolved by its code.
 *
 * The three rejections carry distinct codes so the acceptance page can say which
 * one applies, which does disclose whether a code is real. That is safe only
 * because codes are random UUIDs: nothing can be enumerated without having
 * received the mail.
 */
export const requireAcceptableInvite = <T extends AcceptableInvite>(
    invite: T | null,
    user: InviteRecipient,
): T => {
    if (invite === null || (invite.revokedAt ?? null) !== null) {
        throw new JsonApiError({
            status: "403",
            code: "invalid_code",
            title: "Invalid code",
            detail:
                "This invite link no longer works. It may have expired, been used already, or" +
                " been revoked.",
        });
    }

    if (isInviteExpired(invite)) {
        throw new JsonApiError({
            status: "403",
            code: "invite_expired",
            title: "Invite expired",
            detail: "This invite has expired; ask for a new one",
        });
    }

    if (invite.emailAddress !== user.emailAddress) {
        throw new JsonApiError({
            status: "403",
            code: "invite_email_mismatch",
            title: "Invite email mismatch",
            detail: "This invite was issued to a different email address",
        });
    }

    return invite;
};
