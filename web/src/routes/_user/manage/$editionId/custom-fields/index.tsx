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
import type { ReactNode } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import { useQueryOptionsFactory } from "#/queries";
import { CustomFieldRow } from "./-components/CustomFieldRow.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;

    return (
        <>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    Custom fields
                </Typography>
                <ButtonLink
                    variant="contained"
                    to="/manage/$editionId/custom-fields/create"
                    params={{ editionId }}
                >
                    Add custom field
                </ButtonLink>
            </Stack>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Title</TableCell>
                            <TableCell>Asked</TableCell>
                            <TableCell>Response type</TableCell>
                            <TableCell>Requirement</TableCell>
                            <TableCell sx={{ width: 48 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {customFields.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5}>There are no custom fields.</TableCell>
                            </TableRow>
                        )}
                        {customFields.map((customField) => (
                            <CustomFieldRow
                                key={customField.id}
                                editionId={editionId}
                                customField={customField}
                            />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/custom-fields/")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.customField.list(params.editionId));
    },
});
