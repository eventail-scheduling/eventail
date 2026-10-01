import { ListItemText, MenuItem, Stack } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import type { Control, DefaultValues } from "react-hook-form";
import { z } from "zod/mini";
import { type Team, type TeamRole, teamRoleSchema } from "#/queries/team.ts";

export const teamFormSchema = z.object({
    name: z.string().check(z.trim(), z.minLength(1)),
    role: teamRoleSchema,
});

export type TeamFieldValues = z.input<typeof teamFormSchema>;
export type TeamTransformedValues = z.output<typeof teamFormSchema>;

export const createTeamDefaultValues = (team: Team | null): DefaultValues<TeamFieldValues> => {
    if (!team) {
        return { name: "", role: "viewer" };
    }

    return {
        name: team.name,
        role: team.role,
    };
};

type RoleDetail = {
    label: string;
    description: string;
};

const roleDetails: Record<TeamRole, RoleDetail> = {
    admin: {
        label: "Admin",
        description: "Everything a manager does, plus teams, background jobs and erasing users.",
    },
    manager: {
        label: "Manager",
        description:
            "Everything a viewer does, plus configuring and deleting the edition, editing and deciding on any submission, publishing schedules, and reading confidential answers and host contact details.",
    },
    viewer: {
        label: "Viewer",
        description:
            "Reads every session, host and schedule in every edition, including rejected submissions, internal notes and unpublished drafts.",
    },
};

type TeamFormFieldsProps = {
    control: Control<TeamFieldValues, unknown, TeamTransformedValues>;
};

export const TeamFormFields = ({ control }: TeamFormFieldsProps): ReactNode => (
    <Stack spacing={2}>
        <RhfTextField control={control} name="name" label="Name" required />
        <RhfTextField
            control={control}
            name="role"
            label="Role"
            required
            select
            slotProps={{
                select: {
                    renderValue: (value) => roleDetails[value as TeamRole].label,
                    MenuProps: {
                        slotProps: { paper: { style: { width: 0 } } },
                    },
                },
            }}
        >
            {Object.entries(roleDetails).map(([role, detail]) => (
                <MenuItem key={role} value={role}>
                    <ListItemText
                        secondary={detail.description}
                        slotProps={{ secondary: { sx: { whiteSpace: "normal" } } }}
                    >
                        {detail.label}
                    </ListItemText>
                </MenuItem>
            ))}
        </RhfTextField>
    </Stack>
);
