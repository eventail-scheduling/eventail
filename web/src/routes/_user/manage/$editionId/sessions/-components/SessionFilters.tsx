import { Box, Chip, FormControl, InputLabel, MenuItem, OutlinedInput, Select } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { type ReactNode, useCallback } from "react";
import { DebouncedTextField } from "#/components/DebouncedTextField.js";
import { sessionStateLabels } from "#/components/SessionStateChip.tsx";
import { useQueryOptionsFactory } from "#/queries";
import { type SessionState, sessionStates } from "#/queries/session.ts";

const route = getRouteApi("/_user/manage/$editionId/sessions");

const ANY_OPTION = "";

export const SessionFilters = (): ReactNode => {
    const { editionId } = route.useParams();
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const qof = useQueryOptionsFactory();
    const sessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const tracks = useSuspenseQuery(qof.track.list(editionId)).data;
    // Every change lands on a different set of rows, so a cursor into the old
    // one would ask for a page that no longer means anything.
    //
    // Replaces rather than pushes: narrowing a list is not going somewhere, so
    // Back leaves the list instead of walking every filter the reader tried on
    // the way. The controls show what is applied, which undoes one better than
    // a history entry does.
    const applyFilter = useCallback(
        (change: Partial<typeof search>) => {
            void navigate({
                replace: true,
                search: (previous) => ({
                    ...previous,
                    ...change,
                    after: undefined,
                    before: undefined,
                }),
            });
        },
        [navigate],
    );

    return (
        <Box
            sx={{
                display: "grid",
                // Every row fills, at any width. A wrapping flex row leaves the
                // last line short, which reads as a mistake once one control
                // stretches and its neighbor below does not.
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 2,
                mb: 2,
            }}
        >
            <DebouncedTextField
                size="small"
                label="Search titles"
                value={search.search}
                slotProps={{ htmlInput: { maxLength: 200 } }}
                onCommit={(next) => {
                    applyFilter({ search: next });
                }}
            />

            <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="session-state-label">State</InputLabel>
                <Select
                    multiple
                    labelId="session-state-label"
                    input={<OutlinedInput label="State" />}
                    value={[...(search.state ?? [])]}
                    renderValue={(selected) => (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                            {selected.map((state) => (
                                <Chip key={state} size="small" label={sessionStateLabels[state]} />
                            ))}
                        </Box>
                    )}
                    onChange={(event) => {
                        const value = event.target.value;
                        applyFilter({
                            state: (typeof value === "string"
                                ? value.split(",")
                                : value) as SessionState[],
                        });
                    }}
                >
                    {sessionStates.map((state) => (
                        <MenuItem key={state} value={state}>
                            {sessionStateLabels[state]}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="session-type-label">Type</InputLabel>
                <Select
                    labelId="session-type-label"
                    label="Type"
                    value={search.sessionType ?? ANY_OPTION}
                    onChange={(event) => {
                        applyFilter({
                            sessionType:
                                event.target.value === ANY_OPTION ? undefined : event.target.value,
                        });
                    }}
                >
                    <MenuItem value={ANY_OPTION}>Any type</MenuItem>
                    {sessionTypes.map((sessionType) => (
                        <MenuItem key={sessionType.id} value={sessionType.id}>
                            {sessionType.name}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="session-track-label">Track</InputLabel>
                <Select
                    labelId="session-track-label"
                    label="Track"
                    value={search.track ?? ANY_OPTION}
                    onChange={(event) => {
                        applyFilter({
                            track:
                                event.target.value === ANY_OPTION ? undefined : event.target.value,
                        });
                    }}
                >
                    <MenuItem value={ANY_OPTION}>Any track</MenuItem>
                    {tracks.map((track) => (
                        <MenuItem key={track.id} value={track.id}>
                            {track.name}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
        </Box>
    );
};
