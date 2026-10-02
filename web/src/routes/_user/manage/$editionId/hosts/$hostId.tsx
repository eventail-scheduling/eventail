import { Avatar, Paper, Skeleton, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import { useZonedRangeFormatters } from "#/components/LocaleProvider/index.js";
import { Detail, ResponseValue } from "#/components/ResponseValue/index.js";
import { usePollWhileProcessing } from "#/hooks/usePollWhileProcessing.ts";
import { useQueryOptionsFactory } from "#/queries";
import { fulfillsRole } from "#/utils/role.ts";

const Root = (): ReactNode => {
    const { editionId, hostId } = Route.useParams();
    const pollWhileProcessing = usePollWhileProcessing();
    const qof = useQueryOptionsFactory();
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;
    const { weekdayDateTimeRangeFormatter } = useZonedRangeFormatters(edition.timeZone);
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const isManager = fulfillsRole(currentUser, "manager");
    const host = useSuspenseQuery({
        ...qof.host.get(editionId, hostId, isManager),
        refetchInterval: (query) =>
            pollWhileProcessing(
                query.state.data?.avatar?.processing === true,
                query.state.data?.avatar?.key,
            ),
    }).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;

    const customFieldsById = useMemo(
        () => new Map(customFields.map((customField) => [customField.id, customField])),
        [customFields],
    );

    return (
        <Stack spacing={3}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                {host.avatar?.processing === true ? (
                    <Skeleton variant="circular" width={40} height={40} />
                ) : (
                    <Avatar src={host.avatar?.thumbnailUrl} alt="" />
                )}
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    {host.displayName}
                </Typography>
                <ButtonLink to="/manage/$editionId/hosts" params={{ editionId }}>
                    Back to hosts
                </ButtonLink>
            </Stack>

            <Paper sx={{ p: 3 }}>
                <Stack spacing={2}>
                    {host.emailAddress !== undefined && (
                        <Detail label="Email">{host.emailAddress}</Detail>
                    )}
                    {host.biography !== "" && <Detail label="Biography">{host.biography}</Detail>}
                    {host.responses.map((response) => {
                        const customField = customFieldsById.get(response.customField.id);

                        if (!customField) {
                            return null;
                        }

                        return (
                            <Detail key={response.id} label={customField.title}>
                                <ResponseValue
                                    customField={customField}
                                    editionId={editionId}
                                    responseId={response.id}
                                    value={response.value}
                                />
                            </Detail>
                        );
                    })}
                </Stack>
            </Paper>

            {host.availabilities !== undefined && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                        Availability
                    </Typography>

                    {host.availabilities.length === 0 ? (
                        <Typography variant="body2">
                            This host has not said when they are free.
                        </Typography>
                    ) : (
                        <Stack spacing={0.5}>
                            {host.availabilities.map((availability) => (
                                <Typography key={availability.id} variant="body2">
                                    {weekdayDateTimeRangeFormatter.formatRange(
                                        availability.startsAt,
                                        availability.endsAt,
                                    )}
                                </Typography>
                            ))}
                        </Stack>
                    )}
                </Paper>
            )}
        </Stack>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/hosts/$hostId")({
    component: Root,
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(
                context.qof.host.get(
                    params.editionId,
                    params.hostId,
                    fulfillsRole(context.currentUser, "manager"),
                ),
            ),
            context.queryClient.ensureQueryData(context.qof.customField.list(params.editionId)),
        ]);
    },
});
