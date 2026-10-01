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
import { useReorderLocationsMutation } from "#/mutations/location.ts";
import { useQueryOptionsFactory } from "#/queries";
import { reportReorderFailure } from "#/utils/api.ts";
import { LocationRow } from "./-components/LocationRow.tsx";

const listKey = createSortableListKey("locations");

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const locations = useSuspenseQuery(qof.location.list(editionId)).data;
    const reorderMutation = useReorderLocationsMutation(editionId);

    const handleReorder = useCallback(
        (from: number, to: number) => {
            const ordered = [...locations];
            const [moved] = ordered.splice(from, 1);

            if (!moved) {
                return;
            }

            ordered.splice(to, 0, moved);
            reorderMutation.mutate(
                { locationIds: ordered.map((location) => location.id) },
                {
                    onError: (error) => {
                        reportReorderFailure(error, "locations");
                    },
                },
            );
        },
        [locations, reorderMutation],
    );

    useSortableList({
        listKey,
        items: locations,
        getItemId: (location) => location.id,
        onReorder: handleReorder,
        describeItem: (index) => locations[index]?.name ?? "Location",
    });

    return (
        <>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    Locations
                </Typography>
                <ButtonLink
                    variant="contained"
                    to="/manage/$editionId/locations/create"
                    params={{ editionId }}
                >
                    Add location
                </ButtonLink>
            </Stack>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: 48 }} />
                            <TableCell>Name</TableCell>
                            <TableCell>External key</TableCell>
                            <TableCell sx={{ width: 48 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {locations.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4}>There are no locations.</TableCell>
                            </TableRow>
                        )}
                        {locations.map((location, index) => (
                            <LocationRow
                                key={location.id}
                                editionId={editionId}
                                location={location}
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

export const Route = createFileRoute("/_user/manage/$editionId/locations/")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.location.list(params.editionId));
    },
});
