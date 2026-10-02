import {
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useCallback } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import { createSortableListKey, useSortableList } from "#/components/SortableList/index.js";
import { useReorderVenuesMutation } from "#/mutations/venue.ts";
import { useQueryOptionsFactory } from "#/queries";
import { reportReorderFailure } from "#/utils/api.ts";
import { VenueRow } from "./-components/VenueRow.tsx";

const listKey = createSortableListKey("venues");

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const venues = useSuspenseQuery(qof.venue.list(editionId)).data;
    const reorderMutation = useReorderVenuesMutation(editionId);

    const handleReorder = useCallback(
        (from: number, to: number) => {
            const ordered = [...venues];
            const [moved] = ordered.splice(from, 1);

            if (!moved) {
                return;
            }

            ordered.splice(to, 0, moved);
            reorderMutation.mutate(
                { venueIds: ordered.map((venue) => venue.id) },
                {
                    onError: (error) => {
                        reportReorderFailure(error, "venues");
                    },
                },
            );
        },
        [venues, reorderMutation],
    );

    useSortableList({
        listKey,
        items: venues,
        getItemId: (venue) => venue.id,
        onReorder: handleReorder,
        describeItem: (index) => venues[index]?.name ?? "Venue",
    });

    return (
        <>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    Venues
                </Typography>
                <ButtonLink
                    variant="contained"
                    to="/manage/$editionId/venues/create"
                    params={{ editionId }}
                >
                    Add venue
                </ButtonLink>
            </Stack>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: 48 }} />
                            <TableCell>Name</TableCell>
                            <TableCell>Address</TableCell>
                            <TableCell>External key</TableCell>
                            <TableCell sx={{ width: 48 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {venues.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5}>
                                    There are no venues. A location needs one, so add a venue before
                                    adding locations.
                                </TableCell>
                            </TableRow>
                        )}
                        {venues.map((venue, index) => (
                            <VenueRow
                                key={venue.id}
                                editionId={editionId}
                                venue={venue}
                                listKey={listKey}
                                index={index}
                            />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/venues/")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.venue.list(params.editionId));
    },
});
