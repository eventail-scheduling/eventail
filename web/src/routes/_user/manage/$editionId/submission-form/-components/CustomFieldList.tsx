import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { Box, Chip, IconButton, Paper, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback } from "react";
import { Link } from "#/components/Link/index.js";
import {
    createSortableListKey,
    DropIndicator,
    type SortableListKey,
    useSortableItem,
    useSortableList,
} from "#/components/SortableList/index.js";
import { useReorderCustomFieldsMutation } from "#/mutations/custom-field.js";
import type { CustomField } from "#/queries/custom-field.js";
import { reportReorderFailure } from "#/utils/api.ts";

type Group = {
    target: CustomField["target"];
    listKey: SortableListKey;
    heading: string;
    caption: string;
};

/**
 * A target is immutable once stored, so each group drags against its own key.
 *
 * Sharing one key would let a row be dropped into the other group, where the
 * server would silently renumber it back.
 */
const groups: Group[] = [
    {
        target: "per_proposal",
        listKey: createSortableListKey("perProposalCustomFields"),
        heading: "About this session",
        caption: "Answered for every session a speaker submits.",
    },
    {
        target: "per_host",
        listKey: createSortableListKey("perHostCustomFields"),
        heading: "About you",
        caption: "Answered once for the whole event, not per session.",
    },
];

type CustomFieldCardProps = {
    editionId: string;
    customField: CustomField;
    listKey: SortableListKey;
    index: number;
};

const CustomFieldCard = ({
    editionId,
    customField,
    listKey,
    index,
}: CustomFieldCardProps): ReactNode => {
    const { rowRef, handleRef, dragging, closestEdge } = useSortableItem({
        listKey,
        itemId: customField.id,
        index,
    });

    return (
        <Box ref={rowRef} sx={{ position: "relative", py: 0.5, opacity: dragging ? 0.4 : 1 }}>
            <Paper variant="outlined" sx={{ display: "flex", alignItems: "center", pr: 1 }}>
                <IconButton aria-hidden ref={handleRef} tabIndex={-1} sx={{ cursor: "grab" }}>
                    <DragIndicatorIcon />
                </IconButton>

                <Box sx={{ mr: "auto" }}>
                    <Link
                        to="/manage/$editionId/custom-fields/edit/$customFieldId"
                        params={{ editionId, customFieldId: customField.id }}
                    >
                        {customField.title}
                    </Link>
                </Box>

                {customField.confidential && <Chip size="small" label="Confidential" />}
            </Paper>

            <DropIndicator edge={closestEdge} />
        </Box>
    );
};

type CustomFieldGroupProps = {
    editionId: string;
    group: Group;
    customFields: CustomField[];
    onReorder: (target: CustomField["target"], customFieldIds: string[]) => void;
};

const CustomFieldGroup = ({
    editionId,
    group,
    customFields,
    onReorder,
}: CustomFieldGroupProps): ReactNode => {
    const handleReorder = useCallback(
        (from: number, to: number) => {
            const ordered = customFields.map(({ id }) => id);
            const [moved] = ordered.splice(from, 1);

            if (!moved) {
                return;
            }

            ordered.splice(to, 0, moved);
            onReorder(group.target, ordered);
        },
        [customFields, group.target, onReorder],
    );

    useSortableList({
        listKey: group.listKey,
        items: customFields,
        getItemId: (customField) => customField.id,
        onReorder: handleReorder,
        describeItem: (index) => customFields[index]?.title ?? "Custom field",
    });

    return (
        <Box>
            <Typography variant="subtitle2">{group.heading}</Typography>
            <Typography variant="caption" color="text.secondary">
                {group.caption}
            </Typography>

            <Box sx={{ mt: 1 }}>
                {customFields.length === 0 && (
                    <Typography color="text.secondary">Nothing is asked here yet.</Typography>
                )}
                {customFields.map((customField, index) => (
                    <CustomFieldCard
                        key={customField.id}
                        editionId={editionId}
                        customField={customField}
                        listKey={group.listKey}
                        index={index}
                    />
                ))}
            </Box>
        </Box>
    );
};

type CustomFieldListProps = {
    editionId: string;
    customFields: CustomField[];
};

export const CustomFieldList = ({ editionId, customFields }: CustomFieldListProps): ReactNode => {
    const reorderMutation = useReorderCustomFieldsMutation(editionId);

    const handleReorder = useCallback(
        (target: CustomField["target"], customFieldIds: string[]) => {
            const fullOrder = groups.flatMap((group) =>
                group.target === target
                    ? customFieldIds
                    : customFields
                          .filter((customField) => customField.target === group.target)
                          .map(({ id }) => id),
            );

            reorderMutation.mutate(
                { customFieldIds: fullOrder },
                {
                    onError: (error) => {
                        reportReorderFailure(error, "custom fields");
                    },
                },
            );
        },
        [customFields, reorderMutation],
    );

    return (
        <Stack spacing={4}>
            {groups.map((group) => (
                <CustomFieldGroup
                    key={group.target}
                    editionId={editionId}
                    group={group}
                    customFields={customFields.filter(
                        (customField) => customField.target === group.target,
                    )}
                    onReorder={handleReorder}
                />
            ))}
        </Stack>
    );
};
