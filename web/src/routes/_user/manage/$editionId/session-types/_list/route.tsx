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
import { SessionTypeRow } from "../-components/SessionTypeRow.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const sessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;

    return (
        <>
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Duration</TableCell>
                            <TableCell>External key</TableCell>
                            <TableCell sx={{ width: 48 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sessionTypes.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4}>There are no session types.</TableCell>
                            </TableRow>
                        )}
                        {sessionTypes.map((sessionType) => (
                            <SessionTypeRow
                                key={sessionType.id}
                                editionId={editionId}
                                sessionType={sessionType}
                            />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Outlet />
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/session-types/_list")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.sessionType.list(params.editionId));
    },
});
