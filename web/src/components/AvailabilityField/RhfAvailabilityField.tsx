import type { ReactNode } from "react";
import {
    type Control,
    type FieldPathByValue,
    type FieldValues,
    type RegisterOptions,
    useController,
} from "react-hook-form";
import type { AvailabilityInterval } from "#/utils/availability.ts";
import { AvailabilityField, type AvailabilityFieldProps } from "./AvailabilityField.js";

type Value = AvailabilityInterval[] | undefined;

type RhfAvailabilityFieldProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, Value> = FieldPathByValue<TFieldValues, Value>,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = Omit<
    AvailabilityFieldProps,
    "value" | "onValueChange" | "onBlur" | "error" | "helperText" | "name"
> & {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    name: TName;
    helperText?: string;
    rules?: Omit<
        RegisterOptions<NoInfer<TFieldValues>, NoInfer<TName>>,
        "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
    >;
};

export const RhfAvailabilityField = <
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, Value> = FieldPathByValue<TFieldValues, Value>,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    name,
    rules,
    helperText,
    ...availabilityFieldProps
}: RhfAvailabilityFieldProps<TFieldValues, TName, TContext, TTransformedValues>): ReactNode => {
    const { field, fieldState } = useController({ control, name, rules });

    return (
        <AvailabilityField
            {...availabilityFieldProps}
            name={field.name}
            value={field.value ?? []}
            onValueChange={(value) => {
                field.onChange(value);
            }}
            onBlur={field.onBlur}
            error={Boolean(fieldState.error)}
            helperText={fieldState.error?.message ?? helperText}
        />
    );
};
