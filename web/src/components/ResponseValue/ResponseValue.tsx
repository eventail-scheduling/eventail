import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { match, P } from "ts-pattern";
import { fileUploadSchema } from "#/components/FileUploadField/index.js";
import type { CustomField } from "#/queries/custom-field.ts";
import { ResponseFileLink } from "./ResponseFileLink.js";

type ResponseValueProps = {
    customField: CustomField;
    editionId: string;
    responseId: string;
    value: unknown;
};

export const notGiven = (
    <Typography component="span" sx={{ color: "text.disabled" }}>
        Not given
    </Typography>
);

const readAnswer = ({ customField, editionId, responseId, value }: ResponseValueProps): ReactNode =>
    match(customField.options)
        .with({ type: "boolean" }, () => (value === true ? "Yes" : "No"))
        .with({ type: "single_choice" }, (options) => {
            const item = options.items.find((candidate) => candidate.id === value);

            return item?.label ?? null;
        })
        .with({ type: "multiple_choice" }, (options) => {
            const chosen = Array.isArray(value) ? value : [];

            return options.items
                .filter((item) => chosen.includes(item.id))
                .map((item) => item.label)
                .join(", ");
        })
        .with({ type: "file" }, () => {
            const file = fileUploadSchema.safeParse(value).data;

            if (file === undefined) {
                return null;
            }

            return (
                <ResponseFileLink
                    editionId={editionId}
                    responseId={responseId}
                    filename={file.filename}
                />
            );
        })
        .with(
            { type: P.union("url", "date", "single_line_text", "multi_line_text", "number") },
            () => (value === null || value === undefined ? null : String(value)),
        )
        .exhaustive();

/** Reads an answer back in the shape its field asked for it, or says it was not given. */
export const ResponseValue = (props: ResponseValueProps): ReactNode => {
    const shown = readAnswer(props);

    return shown === null || shown === "" ? notGiven : shown;
};

type DetailProps = {
    label: string;
    children: ReactNode;
};

export const Detail = ({ label, children }: DetailProps): ReactNode => (
    <Box>
        <Typography variant="subtitle2" color="text.secondary">
            {label}
        </Typography>
        <Typography component="div" sx={{ whiteSpace: "pre-wrap" }}>
            {children}
        </Typography>
    </Box>
);
