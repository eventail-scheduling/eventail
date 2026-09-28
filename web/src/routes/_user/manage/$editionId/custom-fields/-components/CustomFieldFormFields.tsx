import { Alert, Box, FormControlLabel, MenuItem, Stack, Typography } from "@mui/material";
import { RhfAutocomplete, RhfSwitch, RhfTextField } from "mui-rhf-integration";
import { RhfDateTimePicker } from "mui-rhf-integration/date-picker";
import { TemporalZonedDateTimeProvider } from "mui-temporal-pickers";
import type { ReactNode } from "react";
import { type Control, useWatch } from "react-hook-form";
import { match } from "ts-pattern";
import { RhfNumberField } from "#/components/NumberField/index.js";
import type { SessionType } from "#/queries/session-type.ts";
import type { Track } from "#/queries/track.ts";
import { ChoiceItemsField } from "./ChoiceItemsField.tsx";
import type { CustomFieldInputValues, CustomFieldTransformedValues } from "./schema.ts";

const optionTypeLabels: Record<CustomFieldInputValues["optionType"], string> = {
    boolean: "Checkbox",
    single_line_text: "Single line text",
    multi_line_text: "Multi line text",
    single_choice: "Single choice",
    multiple_choice: "Multiple choice",
    number: "Number",
    file: "File upload",
    date: "Date",
    url: "URL",
};

const requirementLabels: Record<CustomFieldInputValues["requirement"], string> = {
    always_optional: "Optional",
    always_required: "Required",
    required_after_deadline: "Required after a deadline",
};

type CustomFieldFormFieldsProps = {
    control: Control<CustomFieldInputValues, unknown, CustomFieldTransformedValues>;
    sessionTypes: SessionType[];
    tracks: Track[];
    timeZone: string;
    /** The API rejects a changed target or option type on an existing custom field. */
    isExisting: boolean;
};

export const CustomFieldFormFields = ({
    control,
    sessionTypes,
    tracks,
    timeZone,
    isExisting,
}: CustomFieldFormFieldsProps): ReactNode => {
    const optionType = useWatch({ control, name: "optionType" });
    const target = useWatch({ control, name: "target" });
    const requirement = useWatch({ control, name: "requirement" });
    const targetHelperText =
        target === "per_host"
            ? "Answered once by each person, not for each session"
            : "Answered separately for each session";

    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(0, 22rem)" },
                columnGap: 5,
                rowGap: 4,
                alignItems: "start",
            }}
        >
            <Stack spacing={2}>
                <Typography variant="subtitle2">What you are asking</Typography>

                <RhfTextField control={control} name="title" label="Title" required fullWidth />
                <RhfTextField
                    control={control}
                    name="helperText"
                    label="Helper text"
                    helperText="Shown beneath the field to explain what you are asking for"
                    multiline
                    minRows={2}
                    fullWidth
                />

                <RhfTextField
                    control={control}
                    name="optionType"
                    label="Response type"
                    select
                    required
                    fullWidth
                    disabled={isExisting}
                    helperText={
                        isExisting ? "Cannot change once the custom field exists" : undefined
                    }
                >
                    {Object.entries(optionTypeLabels).map(([value, label]) => (
                        <MenuItem key={value} value={value}>
                            {label}
                        </MenuItem>
                    ))}
                </RhfTextField>

                {match(optionType)
                    .with("single_line_text", "multi_line_text", () => (
                        <Stack direction="row" spacing={2}>
                            <RhfNumberField
                                control={control}
                                name="minLength"
                                label="Minimum length"
                                min={1}
                                fullWidth
                            />
                            <RhfNumberField
                                control={control}
                                name="maxLength"
                                label="Maximum length"
                                min={1}
                                fullWidth
                            />
                        </Stack>
                    ))
                    .with("number", () => (
                        <Stack direction="row" spacing={2}>
                            <RhfNumberField
                                control={control}
                                name="min"
                                label="Minimum"
                                min={0}
                                fullWidth
                            />
                            <RhfNumberField
                                control={control}
                                name="max"
                                label="Maximum"
                                min={0}
                                fullWidth
                            />
                        </Stack>
                    ))
                    .with("single_choice", "multiple_choice", () => (
                        <ChoiceItemsField control={control} />
                    ))
                    .with("boolean", "file", "date", "url", () => null)
                    .exhaustive()}
            </Stack>

            <Stack spacing={4}>
                <Stack spacing={2}>
                    <Typography variant="subtitle2">When it must be answered</Typography>

                    <RhfTextField
                        control={control}
                        name="target"
                        label="Asked"
                        select
                        required
                        fullWidth
                        disabled={isExisting}
                        helperText={
                            isExisting
                                ? "Cannot change once the custom field exists"
                                : targetHelperText
                        }
                    >
                        <MenuItem value="per_proposal">Once per proposal</MenuItem>
                        <MenuItem value="per_host">Once per person</MenuItem>
                    </RhfTextField>

                    <RhfTextField
                        control={control}
                        name="requirement"
                        label="Requirement"
                        select
                        required
                        fullWidth
                    >
                        {Object.entries(requirementLabels).map(([value, label]) => (
                            <MenuItem key={value} value={value}>
                                {label}
                            </MenuItem>
                        ))}
                    </RhfTextField>

                    <TemporalZonedDateTimeProvider>
                        <Stack spacing={2}>
                            {requirement === "required_after_deadline" && (
                                <RhfDateTimePicker
                                    control={control}
                                    name="deadline"
                                    label="Deadline"
                                    timezone={timeZone}
                                    slotProps={{
                                        textField: {
                                            fullWidth: true,
                                            required: true,
                                            helperText:
                                                "The custom field becomes required once this passes",
                                        },
                                    }}
                                />
                            )}
                            <RhfDateTimePicker
                                control={control}
                                name="freezeAfter"
                                label="Frozen after"
                                timezone={timeZone}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                        helperText:
                                            "Responses can no longer be changed once this passes",
                                    },
                                }}
                            />
                        </Stack>
                    </TemporalZonedDateTimeProvider>
                </Stack>

                <Stack spacing={2}>
                    <Typography variant="subtitle2">Who it applies to</Typography>

                    {target === "per_host" ? (
                        <Alert severity="info">
                            A custom field asked once per person applies to everyone, so it cannot
                            be limited to session types or tracks.
                        </Alert>
                    ) : (
                        <>
                            <RhfAutocomplete
                                control={control}
                                name="sessionTypes"
                                multiple
                                options={sessionTypes}
                                getOptionLabel={(option) => option.name}
                                isOptionEqualToValue={(option, value) => option.id === value.id}
                                slotProps={{
                                    textField: {
                                        label: "Session types",
                                        helperText: "Leave empty to ask it for every session type",
                                    },
                                }}
                            />
                            <RhfAutocomplete
                                control={control}
                                name="tracks"
                                multiple
                                options={tracks}
                                getOptionLabel={(option) => option.name}
                                isOptionEqualToValue={(option, value) => option.id === value.id}
                                slotProps={{
                                    textField: {
                                        label: "Tracks",
                                        helperText:
                                            "Leave empty to ask it for every track. Choosing tracks also excludes sessions that have none.",
                                    },
                                }}
                            />
                        </>
                    )}

                    <FormControlLabel
                        control={<RhfSwitch control={control} name="confidential" />}
                        label="Only managers and the session's hosts may see the responses"
                    />

                    <RhfTextField
                        control={control}
                        name="externalKey"
                        label="External key"
                        helperText="Identifies this custom field to systems importing the data"
                        fullWidth
                    />
                </Stack>
            </Stack>
        </Box>
    );
};
