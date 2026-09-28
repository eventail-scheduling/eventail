import AddIcon from "@mui/icons-material/Add";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import SettingsIcon from "@mui/icons-material/Settings";
import { Box, Chip, IconButton, Paper, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
    profileBuiltInFieldNames,
    sessionBuiltInFieldNames,
} from "#/components/SessionFormFields/index.js";
import {
    createSortableListKey,
    DropIndicator,
    useSortableItem,
    useSortableList,
} from "#/components/SortableList/index.js";
import { useDialogController } from "#/hooks/useDialogController.tsx";
import { type FieldOptionsScope, useUpdateFieldOptionsMutation } from "#/mutations/edition.js";
import type { BuiltInFieldOptions, SessionFieldSpec } from "#/queries/edition.js";
import { defaultMutationErrorHandler } from "#/utils/api.js";
import { BuiltInFieldDialog } from "./BuiltInFieldDialog.tsx";

const sessionFieldsKey = createSortableListKey("sessionFields");

type SessionFieldSpecMap = Record<string, SessionFieldSpec>;

type AskedField = {
    name: string;
    label: string;
    requirement: "required" | "optional";
    forceRequired: boolean;
};

type FieldCardProps = {
    field: AskedField;
    index: number;
    onConfigure: (name: string) => void;
    onRemove: (name: string) => void;
};

const FieldCard = ({ field, index, onConfigure, onRemove }: FieldCardProps): ReactNode => {
    const { rowRef, handleRef, dragging, closestEdge } = useSortableItem({
        listKey: sessionFieldsKey,
        itemId: field.name,
        index,
    });
    const removable = !field.forceRequired;

    return (
        <Box ref={rowRef} sx={{ position: "relative", py: 0.5, opacity: dragging ? 0.4 : 1 }}>
            <Paper variant="outlined" sx={{ display: "flex", alignItems: "center", pr: 1 }}>
                <IconButton aria-hidden ref={handleRef} tabIndex={-1} sx={{ cursor: "grab" }}>
                    <DragIndicatorIcon />
                </IconButton>

                <Typography sx={{ mr: "auto" }}>{field.label}</Typography>

                <Chip
                    size="small"
                    label={field.requirement === "required" ? "Required" : "Optional"}
                    color={field.requirement === "required" ? "primary" : "default"}
                />

                <IconButton
                    aria-label={`Configure ${field.label}`}
                    onClick={() => {
                        onConfigure(field.name);
                    }}
                >
                    <SettingsIcon />
                </IconButton>

                <IconButton
                    aria-label={`Stop asking for ${field.label}`}
                    disabled={!removable}
                    onClick={() => {
                        onRemove(field.name);
                    }}
                >
                    <RemoveCircleIcon />
                </IconButton>
            </Paper>

            <DropIndicator edge={closestEdge} />
        </Box>
    );
};

type BuiltInFieldListProps = {
    editionId: string;
    scope: FieldOptionsScope;
    fieldOptions: BuiltInFieldOptions;
    specs: SessionFieldSpecMap;
};

export const BuiltInFieldList = ({
    editionId,
    scope,
    fieldOptions,
    specs,
}: BuiltInFieldListProps): ReactNode => {
    // The speaker's forms' own order, which breaks the ties between fields no
    // organizer has moved yet; the specs arrive in another.
    const fields = useMemo(
        (): string[] =>
            (scope === "profile" ? profileBuiltInFieldNames : sessionBuiltInFieldNames).filter(
                (name) => specs[name] !== undefined,
            ),
        [scope, specs],
    );
    const updateFieldOptionsMutation = useUpdateFieldOptionsMutation(editionId, scope);

    /**
     * Holds what was last sent, written synchronously.
     *
     * `onMutate` awaits `cancelQueries` before it writes the optimistic value,
     * so the cache is still stale for anything that runs in the same task. Two
     * clicks in one batch then build on each other instead of both starting from
     * the old options.
     */
    const sentOptions = useRef<BuiltInFieldOptions | null>(null);
    const lastSeenOptions = useRef(fieldOptions);

    if (lastSeenOptions.current !== fieldOptions) {
        lastSeenOptions.current = fieldOptions;
        sentOptions.current = null;
    }

    const currentOptions = useCallback(
        (): BuiltInFieldOptions => sentOptions.current ?? fieldOptions,
        [fieldOptions],
    );

    const labelOf = useCallback(
        (name: string): string => fieldOptions[name]?.label ?? specs[name]?.label ?? name,
        [fieldOptions, specs],
    );

    const askedFields = useMemo(
        (): AskedField[] =>
            fields
                .filter(
                    (name) =>
                        specs[name]?.forceRequired === true || fieldOptions[name] !== undefined,
                )
                .map((name) => {
                    const options = fieldOptions[name];

                    return {
                        name,
                        label: labelOf(name),
                        requirement: options?.requirement ?? "required",
                        forceRequired: specs[name]?.forceRequired === true,
                        position: options?.position ?? 0,
                    };
                })
                .sort((left, right) => left.position - right.position),
        [fields, fieldOptions, labelOf, specs],
    );

    const notAskedFields = useMemo(
        () =>
            fields.filter(
                (name) => specs[name]?.forceRequired !== true && fieldOptions[name] === undefined,
            ),
        [fields, fieldOptions, specs],
    );

    const persist = useCallback(
        (options: BuiltInFieldOptions) => {
            sentOptions.current = options;
            updateFieldOptionsMutation.mutate(
                { fieldOptions: options },
                { onError: defaultMutationErrorHandler },
            );
        },
        [updateFieldOptionsMutation],
    );

    const handleReorder = useCallback(
        (from: number, to: number) => {
            const ordered = askedFields.map(({ name }) => name);
            const [moved] = ordered.splice(from, 1);

            if (!moved) {
                return;
            }

            ordered.splice(to, 0, moved);

            const repositioned: Record<string, unknown> = { ...currentOptions() };

            ordered.forEach((name, position) => {
                const options = repositioned[name];
                repositioned[name] = options ? { ...options, position } : { position };
            });

            persist(repositioned as BuiltInFieldOptions);
        },
        [askedFields, currentOptions, persist],
    );

    useSortableList({
        listKey: sessionFieldsKey,
        items: askedFields,
        getItemId: (field) => field.name,
        onReorder: handleReorder,
        describeItem: (index) => askedFields[index]?.label ?? "Field",
    });

    const handleAdd = useCallback(
        (name: string) => {
            const options = currentOptions();
            const highest = Object.values(options).reduce(
                (top, field) => Math.max(top, field?.position ?? 0),
                -1,
            );
            const added =
                specs[name]?.forceRequired === true
                    ? { position: highest + 1 }
                    : { requirement: "optional" as const, position: highest + 1 };

            persist({ ...options, [name]: added });
        },
        [currentOptions, persist, specs],
    );

    const configureDialog = useDialogController();
    const [configuring, setConfiguring] = useState<string | null>(null);

    const handleConfigure = useCallback(
        (name: string) => {
            setConfiguring(name);
            configureDialog.open();
        },
        [configureDialog],
    );

    const handleRemove = useCallback(
        (name: string) => {
            const { [name]: removed, ...remaining } = currentOptions();
            persist(remaining);
        },
        [currentOptions, persist],
    );

    return (
        <Stack spacing={3}>
            <Box>
                {askedFields.length === 0 && (
                    <Typography color="text.secondary">
                        This step asks for nothing, so speakers never see it.
                    </Typography>
                )}
                {askedFields.map((field, index) => (
                    <FieldCard
                        key={field.name}
                        field={field}
                        index={index}
                        onConfigure={handleConfigure}
                        onRemove={handleRemove}
                    />
                ))}
            </Box>

            {notAskedFields.length > 0 && (
                <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        Not asked for
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                        {notAskedFields.map((name) => (
                            <Chip
                                key={name}
                                icon={<AddIcon />}
                                label={labelOf(name)}
                                onClick={() => {
                                    handleAdd(name);
                                }}
                            />
                        ))}
                    </Stack>
                </Box>
            )}

            {configureDialog.mount && configuring && specs[configuring] && (
                <BuiltInFieldDialog
                    dialogProps={configureDialog.dialogProps}
                    editionId={editionId}
                    scope={scope}
                    fieldName={configuring}
                    spec={specs[configuring]}
                    fieldOptions={fieldOptions}
                />
            )}
        </Stack>
    );
};
