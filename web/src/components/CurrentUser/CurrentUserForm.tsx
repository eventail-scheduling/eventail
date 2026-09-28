import { Stack } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import { type FormEventHandler, type ReactNode, type RefObject, useEffect, useMemo } from "react";
import { type DefaultValues, useForm } from "react-hook-form";
import { z } from "zod/mini";
import type { User, UserEditableFields } from "#/queries/user.ts";
import { formResolver } from "#/utils/zod.js";

export type CurrentUserFieldValues = {
    displayName?: string | undefined;
    emailAddress?: string | undefined;
};

export type CurrentUserTransformedValues = CurrentUserFieldValues;

export type CurrentUserSchema = z.ZodMiniType<CurrentUserTransformedValues, CurrentUserFieldValues>;

const createSchema = (editableFields: UserEditableFields): CurrentUserSchema => {
    return z.object({
        displayName: editableFields.includes("displayName")
            ? z.string().check(z.trim(), z.minLength(1))
            : z.optional(z.undefined()),
        emailAddress: editableFields.includes("emailAddress")
            ? z.string().check(z.trim(), z.minLength(1), z.email())
            : z.optional(z.undefined()),
    });
};

const createDefaultValues = (
    editableFields: UserEditableFields,
    user: User | null,
): DefaultValues<CurrentUserFieldValues> => {
    if (!user) {
        return {};
    }

    const defaultValues: DefaultValues<CurrentUserFieldValues> = {};

    if (editableFields.includes("displayName")) {
        defaultValues.displayName = user.displayName;
    }

    if (editableFields.includes("emailAddress")) {
        defaultValues.emailAddress = user.emailAddress;
    }

    return defaultValues;
};

type CurrentUserFormProps = {
    user: User | null;
    editableFields: UserEditableFields;
    onSubmit: (data: CurrentUserTransformedValues) => void;
    onSubmitRef: RefObject<FormEventHandler | undefined>;
};

export const CurrentUserForm = ({
    user,
    editableFields,
    onSubmit,
    onSubmitRef,
}: CurrentUserFormProps): ReactNode => {
    const schema = useMemo(() => createSchema(editableFields), [editableFields]);
    const defaultValues = useMemo(
        () => createDefaultValues(editableFields, user),
        [user, editableFields],
    );
    const form = useForm<CurrentUserFieldValues, unknown, CurrentUserTransformedValues>({
        resolver: formResolver(schema),
        defaultValues,
    });

    useEffect(() => {
        onSubmitRef.current = form.handleSubmit(onSubmit);
    }, [form.handleSubmit, onSubmit, onSubmitRef]);

    return (
        <Stack spacing={2}>
            {editableFields.includes("displayName") && (
                <RhfTextField
                    control={form.control}
                    name="displayName"
                    label="Display name"
                    required
                />
            )}
            {editableFields.includes("emailAddress") && (
                <RhfTextField
                    control={form.control}
                    name="emailAddress"
                    label="Email address"
                    inputMode="email"
                    required
                />
            )}
        </Stack>
    );
};
