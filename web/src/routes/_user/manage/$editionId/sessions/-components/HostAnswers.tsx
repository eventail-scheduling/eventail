import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Accordion, AccordionDetails, AccordionSummary, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Detail, ResponseValue } from "#/components/ResponseValue/index.js";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Session } from "#/queries/session.ts";

type HostAnswersProps = {
    editionId: string;
    hosts: Session["hosts"];
    customFieldsById: Map<string, CustomField>;
};

/**
 * What each host answered about themselves.
 *
 * These belong to the host's edition profile, not the session, so no manager
 * form can change them.
 */
export const HostAnswers = ({
    editionId,
    hosts,
    customFieldsById,
}: HostAnswersProps): ReactNode => {
    const answered = hosts.filter((host) => host.responses.length > 0);

    if (answered.length === 0) {
        return null;
    }

    return (
        <Stack spacing={1}>
            {answered.map((host) => (
                <Accordion key={host.id} disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{host.displayName}</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <Stack spacing={2}>
                            {host.responses.map((response) => {
                                const customField = customFieldsById.get(response.customField.id);

                                if (!customField) {
                                    return null;
                                }

                                return (
                                    <Detail key={response.id} label={customField.title}>
                                        <ResponseValue
                                            customField={customField}
                                            editionId={editionId}
                                            responseId={response.id}
                                            value={response.value}
                                        />
                                    </Detail>
                                );
                            })}
                        </Stack>
                    </AccordionDetails>
                </Accordion>
            ))}
        </Stack>
    );
};
