import { Stack } from "@mui/material";
import { type ReactNode, useMemo } from "react";
import { BuiltInField } from "#/components/BuiltInField/index.js";
import { ImagePreview } from "#/components/ImagePreview.js";
import { Detail, notGiven } from "#/components/ResponseValue/index.js";
import {
    applicableCustomFields,
    type SessionBuiltInFieldName,
} from "#/components/SessionFormFields/index.js";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition, SessionFieldSpec } from "#/queries/edition.ts";
import type { Session } from "#/queries/session.ts";
import { formatDurationLabel } from "#/utils/duration.ts";
import { SessionAnswers } from "./SessionAnswers.tsx";

const orNotGiven = (value: string): ReactNode => (value === "" ? notGiven : value);

type SessionDetailsProps = {
    session: Session;
    edition: Edition;
    specs: Record<string, SessionFieldSpec>;
    /** The form's list, so both show the same fields in the same order. */
    fieldNames: string[];
    customFields: CustomField[];
};

/** A session as someone who may not change it reads it. */
export const SessionDetails = ({
    session,
    edition,
    specs,
    fieldNames,
    customFields,
}: SessionDetailsProps): ReactNode => {
    // Frozen fields included, since an answer already given is still worth
    // reading to someone who could not have answered it anyway. Confidential
    // ones go unless the reader hosts the session: the API withholds those
    // answers from everyone else below manager, and an answer left out would
    // read as one never given.
    const proposalCustomFields = useMemo(
        () =>
            applicableCustomFields(customFields, {
                sessionTypeId: session.sessionType.id,
                trackId: session.track?.id,
                includeFrozen: true,
            }).filter((customField) => !customField.confidential || session.$meta.hosting),
        [customFields, session],
    );

    const values: Record<SessionBuiltInFieldName, ReactNode> = {
        title: orNotGiven(session.title),
        sessionType: session.sessionType.name,
        track: session.track?.name ?? notGiven,
        abstract: orNotGiven(session.abstract),
        description: orNotGiven(session.description),
        notes: orNotGiven(session.notes),
        duration: session.duration === null ? notGiven : formatDurationLabel(session.duration),
        setupTime: session.setupTime === null ? notGiven : formatDurationLabel(session.setupTime),
        teardownTime:
            session.teardownTime === null ? notGiven : formatDurationLabel(session.teardownTime),
        teaserImage:
            session.teaserImage === null ? notGiven : <ImagePreview image={session.teaserImage} />,
    };

    return (
        <Stack spacing={2}>
            {fieldNames.map((name) => (
                <BuiltInField
                    key={name}
                    name={name}
                    fieldOptions={edition.sessionFieldOptions}
                    specs={specs}
                    render={({ label }) => (
                        <Detail label={label}>{values[name as SessionBuiltInFieldName]}</Detail>
                    )}
                />
            ))}

            {proposalCustomFields.length > 0 && (
                <SessionAnswers
                    editionId={edition.id}
                    customFields={proposalCustomFields}
                    responses={session.responses}
                />
            )}
        </Stack>
    );
};
