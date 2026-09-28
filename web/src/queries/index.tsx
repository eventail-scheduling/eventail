import { createContext, type ReactNode, useContext } from "react";
import { createClockQueryOptionsFactory } from "#/queries/clock.ts";
import { createCustomFieldQueryOptionsFactory } from "#/queries/custom-field.js";
import { createEditionQueryOptionsFactory } from "#/queries/edition.ts";
import { createHostQueryOptionsFactory } from "#/queries/host.ts";
import { createInviteQueryOptionsFactory } from "#/queries/invite.ts";
import { createJobQueryOptionsFactory } from "#/queries/job.ts";
import { createLocationQueryOptionsFactory } from "#/queries/location.ts";
import { createScheduleQueryOptionsFactory } from "#/queries/schedule.ts";
import { createSessionQueryOptionsFactory } from "#/queries/session.ts";
import { createSessionHostInviteQueryOptionsFactory } from "#/queries/session-host-invite.ts";
import { createSessionTypeQueryOptionsFactory } from "#/queries/session-type.ts";
import { createTeamQueryOptionsFactory } from "#/queries/team.ts";
import { createTimezoneQueryOptionsFactory } from "#/queries/timezone.js";
import { createTrackQueryOptionsFactory } from "#/queries/track.ts";
import { createUserQueryOptionsFactory } from "#/queries/user.ts";

export const createQueryOptionsFactory = (authFetch: typeof fetch) => ({
    clock: createClockQueryOptionsFactory(authFetch),
    edition: createEditionQueryOptionsFactory(authFetch),
    invite: createInviteQueryOptionsFactory(authFetch),
    job: createJobQueryOptionsFactory(authFetch),
    location: createLocationQueryOptionsFactory(authFetch),
    schedule: createScheduleQueryOptionsFactory(authFetch),
    customField: createCustomFieldQueryOptionsFactory(authFetch),
    host: createHostQueryOptionsFactory(authFetch),
    session: createSessionQueryOptionsFactory(authFetch),
    sessionHostInvite: createSessionHostInviteQueryOptionsFactory(authFetch),
    sessionType: createSessionTypeQueryOptionsFactory(authFetch),
    team: createTeamQueryOptionsFactory(authFetch),
    track: createTrackQueryOptionsFactory(authFetch),
    timezone: createTimezoneQueryOptionsFactory(authFetch),
    user: createUserQueryOptionsFactory(authFetch),
});

export type QueryOptionsFactory = ReturnType<typeof createQueryOptionsFactory>;

const QueryOptionsFactoryContext = createContext<QueryOptionsFactory | null>(null);

type QueryOptionsFactoryProviderProps = {
    children: ReactNode;
    factory: QueryOptionsFactory;
};

export const QueryOptionsFactoryProvider = ({
    children,
    factory,
}: QueryOptionsFactoryProviderProps): ReactNode => (
    <QueryOptionsFactoryContext.Provider value={factory}>
        {children}
    </QueryOptionsFactoryContext.Provider>
);

export const useQueryOptionsFactory = (): QueryOptionsFactory => {
    const factory = useContext(QueryOptionsFactoryContext);

    if (!factory) {
        throw new Error("useQueryOptionsFactory used outside QueryOptionsFactoryProvider");
    }

    return factory;
};
