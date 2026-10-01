import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { Box, Button, FormHelperText, IconButton, Stack, Typography } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import type { ReactNode } from "react";
import { type Control, useFieldArray, useFormState } from "react-hook-form";
import {
    createSortableListKey,
    DropIndicator,
    useSortableItem,
    useSortableList,
} from "#/components/SortableList/index.js";
import {
    type CustomFieldInputValues,
    type CustomFieldTransformedValues,
    createChoiceItem,
} from "./schema.ts";

type ChoiceItemsControl = Control<CustomFieldInputValues, unknown, CustomFieldTransformedValues>;

const choiceItemsKey = createSortableListKey("choiceItems");

type ChoiceItemRowProps = {
    control: ChoiceItemsControl;
    fieldId: string;
    index: number;
    count: number;
    onMove: (from: number, to: number) => void;
    onRemove: (index: number) => void;
};

const ChoiceItemRow = ({
    control,
    fieldId,
    index,
    count,
    onMove,
    onRemove,
}: ChoiceItemRowProps): ReactNode => {
    const { rowRef, handleRef, dragging, closestEdge } = useSortableItem({
        listKey: choiceItemsKey,
        itemId: fieldId,
        index,
    });

    return (
        <Stack
            ref={rowRef}
            direction="row"
            spacing={1}
            sx={{
                alignItems: "flex-start",
                position: "relative",
                opacity: dragging ? 0.4 : 1,
                py: 0.75,
            }}
        >
            <IconButton aria-hidden ref={handleRef} tabIndex={-1} sx={{ cursor: "grab" }}>
                <DragIndicatorIcon />
            </IconButton>
            <RhfTextField
                control={control}
                name={`items.${index}.label`}
                size="small"
                fullWidth
                required
                slotProps={{ htmlInput: { "aria-label": `Option ${index + 1}` } }}
            />
            <IconButton
                aria-label={`Move option ${index + 1} up`}
                disabled={index === 0}
                onClick={() => {
                    onMove(index, index - 1);
                }}
            >
                <ArrowUpwardIcon />
            </IconButton>
            <IconButton
                aria-label={`Move option ${index + 1} down`}
                disabled={index === count - 1}
                onClick={() => {
                    onMove(index, index + 1);
                }}
            >
                <ArrowDownwardIcon />
            </IconButton>
            <IconButton
                aria-label={`Remove option ${index + 1}`}
                disabled={count === 1}
                onClick={() => {
                    onRemove(index);
                }}
            >
                <DeleteIcon />
            </IconButton>

            <DropIndicator edge={closestEdge} />
        </Stack>
    );
};

type ChoiceItemsFieldProps = {
    control: ChoiceItemsControl;
};

export const ChoiceItemsField = ({ control }: ChoiceItemsFieldProps): ReactNode => {
    const { fields, append, remove, move } = useFieldArray({
        control,
        name: "items",
        keyName: "fieldId",
    });
    const { errors } = useFormState({ control, name: "items" });
    const itemsError = errors.items?.root?.message ?? errors.items?.message;

    useSortableList({
        listKey: choiceItemsKey,
        items: fields,
        getItemId: (field) => field.fieldId,
        onReorder: move,
        describeItem: (index) => `Option ${index + 1}`,
    });

    return (
        <Stack spacing={1}>
            <Typography variant="subtitle2">Options</Typography>

            <Box>
                {fields.map((field, index) => (
                    <ChoiceItemRow
                        key={field.fieldId}
                        control={control}
                        fieldId={field.fieldId}
                        index={index}
                        count={fields.length}
                        onMove={move}
                        onRemove={remove}
                    />
                ))}
            </Box>

            {itemsError && <FormHelperText error>{itemsError}</FormHelperText>}

            <div>
                <Button
                    startIcon={<AddIcon />}
                    onClick={() => {
                        append(createChoiceItem());
                    }}
                >
                    Add option
                </Button>
            </div>
        </Stack>
    );
};
