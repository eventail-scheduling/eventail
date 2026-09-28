import type { ReactNode } from "react";
import {
    type Control,
    type FieldPathByValue,
    type FieldValues,
    type RegisterOptions,
    useController,
} from "react-hook-form";
import { NumberField, type NumberFieldProps } from "./NumberField.js";

type Value = number | null | undefined;

type RhfNumberFieldProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, Value> = FieldPathByValue<TFieldValues, Value>,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = Omit<NumberFieldProps, "value" | "onValueChange" | "onBlur" | "error" | "name" | "inputRef"> & {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    name: TName;
    rules?: Omit<
        RegisterOptions<NoInfer<TFieldValues>, NoInfer<TName>>,
        "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
    >;
};

export const RhfNumberField = <
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, Value> = FieldPathByValue<TFieldValues, Value>,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    name,
    rules,
    helperText,
    ...numberFieldProps
}: RhfNumberFieldProps<TFieldValues, TName, TContext, TTransformedValues>): ReactNode => {
    const { field, fieldState } = useController({ control, name, rules });

    return (
        <NumberField
            {...numberFieldProps}
            name={field.name}
            inputRef={field.ref}
            value={field.value ?? null}
            onValueChange={(value) => {
                field.onChange(value);
            }}
            onBlur={field.onBlur}
            error={Boolean(fieldState.error)}
            helperText={fieldState.error?.message ?? helperText}
        />
    );
};
