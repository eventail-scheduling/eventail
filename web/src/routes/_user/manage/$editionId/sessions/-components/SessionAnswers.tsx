import { Stack } from "@mui/material";
import type { ReactNode } from "react";
import { Detail, notGiven, ResponseValue } from "#/components/ResponseValue/index.js";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Session } from "#/queries/session.ts";

type SessionAnswersProps = {
    editionId: string;
    customFields: CustomField[];
    responses: Session["responses"];
};

/** Lists what the session answered to each question, read only. */
export const SessionAnswers = ({
    editionId,
    customFields,
    responses,
}: SessionAnswersProps): ReactNode => (
    <Stack spacing={2}>
        {customFields.map((customField) => {
            const response = responses.find((entry) => entry.customField.id === customField.id);

            return (
                <Detail key={customField.id} label={customField.title}>
                    {response === undefined ? (
                        notGiven
                    ) : (
                        <ResponseValue
                            customField={customField}
                            editionId={editionId}
                            responseId={response.id}
                            value={response.value}
                        />
                    )}
                </Detail>
            );
        })}
    </Stack>
);
