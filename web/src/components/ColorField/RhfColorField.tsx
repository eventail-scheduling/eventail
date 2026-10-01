import type { ReactNode } from "react";
import {
    type Control,
    type FieldPathByValue,
    type FieldValues,
    type RegisterOptions,
    useController,
} from "react-hook-form";
import { ColorField, type ColorFieldProps } from "./ColorField.js";

type Value = string | null | undefined;

type RhfColorFieldProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, Value> = FieldPathByValue<TFieldValues, Value>,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = Omit<ColorFieldProps, "value" | "onValueChange" | "onBlur" | "error" | "name" | "inputRef"> & {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    name: TName;
    rules?: Omit<
        RegisterOptions<NoInfer<TFieldValues>, NoInfer<TName>>,
        "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
    >;
};

export const RhfColorField = <
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, Value> = FieldPathByValue<TFieldValues, Value>,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    name,
    rules,
    helperText,
    ...colorFieldProps
}: RhfColorFieldProps<TFieldValues, TName, TContext, TTransformedValues>): ReactNode => {
    const { field, fieldState } = useController({ control, name, rules });

    return (
        <ColorField
            {...colorFieldProps}
            name={field.name}
            inputRef={field.ref}
            value={field.value ?? ""}
            onValueChange={(value) => {
                field.onChange(value);
            }}
            onBlur={field.onBlur}
            error={Boolean(fieldState.error)}
            helperText={fieldState.error?.message ?? helperText}
        />
    );
};
