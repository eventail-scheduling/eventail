import type { ReactNode } from "react";
import type {
    BuiltInFieldOption,
    BuiltInFieldOptions,
    ImageConstraints,
    SessionFieldSpec,
} from "#/queries/edition.js";
import { resolveRequirement } from "./requirement.js";

export type BuiltInFieldRenderProps = {
    label: string;
    helperText?: string;
    required: boolean;
    minLength?: number;
    maxLength?: number;
    imageConstraints?: ImageConstraints;
};

/**
 * Mirrors the server's resolution, which decides what an attach will accept.
 *
 * A spec carries either fixed constraints or overridable defaults, never both:
 * the avatar's frame is not the organizer's to move, a teaser image's is.
 */
const resolveImageConstraints = (
    spec: SessionFieldSpec | undefined,
    options: BuiltInFieldOption | undefined,
): ImageConstraints | undefined => {
    if (spec?.imageConstraints !== undefined) {
        return spec.imageConstraints;
    }

    const defaults = spec?.imageDefaults;

    if (defaults === undefined) {
        return undefined;
    }

    return {
        minWidth: options?.minWidth ?? defaults.minWidth,
        minHeight: options?.minHeight ?? defaults.minHeight,
        maxWidth: options?.maxWidth ?? defaults.maxWidth,
        maxHeight: options?.maxHeight ?? defaults.maxHeight,
        aspectRatio: options?.aspectRatio ?? null,
    };
};

type BuiltInFieldProps = {
    name: string;
    fieldOptions: BuiltInFieldOptions;
    specs: Record<string, SessionFieldSpec>;
    render: (props: BuiltInFieldRenderProps) => ReactNode;
};

export const BuiltInField = ({
    name,
    fieldOptions,
    specs,
    render,
}: BuiltInFieldProps): ReactNode => {
    const spec: SessionFieldSpec | undefined = specs[name];
    const options: BuiltInFieldOption | undefined = fieldOptions[name];

    if (options === undefined && spec?.forceRequired !== true) {
        return null;
    }

    return render({
        label: options?.label ?? spec?.label ?? name,
        helperText: options?.helperText ?? spec?.helperText,
        required: spec?.forceRequired === true || resolveRequirement(options) === "required",
        minLength: options?.minLength,
        maxLength: options?.maxLength,
        imageConstraints: resolveImageConstraints(spec, options),
    });
};
