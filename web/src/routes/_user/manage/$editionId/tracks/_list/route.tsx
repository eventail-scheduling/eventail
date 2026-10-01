import {
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryOptionsFactory } from "#/queries";
import { TrackRow } from "../-components/TrackRow.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const tracks = useSuspenseQuery(qof.track.list(editionId)).data;

    return (
        <>
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell>External key</TableCell>
                            <TableCell sx={{ width: 48 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {tracks.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4}>There are no tracks.</TableCell>
                            </TableRow>
                        )}
                        {tracks.map((track) => (
                            <TrackRow key={track.id} editionId={editionId} track={track} />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Outlet />
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/tracks/_list")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.track.list(params.editionId));
    },
});
