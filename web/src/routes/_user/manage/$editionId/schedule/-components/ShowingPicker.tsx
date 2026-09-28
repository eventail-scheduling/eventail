import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type Choice, ChoiceMenu } from "#/components/ChoiceMenu.js";
import { useLocale } from "#/components/LocaleProvider";
import { useQueryOptionsFactory } from "#/queries";

/** What the working draft is called in the list, and its value in the URL. */
export const DRAFT = "draft";

type ShowingPickerProps = {
    editionId: string;
    /** The publication being read, or `DRAFT` for the editable one. */
    showing: string;
};

/**
 * Chooses between the draft and a publication, newest first.
 *
 * Self contained because both readings put it in their own heading row rather
 * than sharing one from the layout, which is how every other page here is laid
 * out. Renders nothing where there is no publication to choose, since a list
 * offering one thing asks a question with one answer.
 */
export const ShowingPicker = ({ editionId, showing }: ShowingPickerProps): ReactNode => {
    const qof = useQueryOptionsFactory();
    const navigate = useNavigate();
    const { mediumDateTimeFormatter } = useLocale();
    const schedules = useSuspenseQuery(qof.schedule.list(editionId)).data;
    const publications = schedules.filter((schedule) => schedule.publishedAt !== null);

    if (publications.length === 0) {
        return null;
    }

    // In the reader's own zone rather than the edition's: this is when someone
    // pressed publish, not a time inside the event. Two publications can share
    // a day, so the clock is what tells them apart.
    const when = (publishedAt: Temporal.Instant): string =>
        mediumDateTimeFormatter.format(publishedAt);

    const choices: Choice<string>[] = [
        { value: DRAFT, label: "Working draft" },
        ...publications.map((publication) => ({
            value: publication.id,
            label: publication.preliminary ? "Preliminary" : "Final",
            detail: publication.publishedAt === null ? undefined : when(publication.publishedAt),
        })),
    ];

    // Falls back for the control alone: a value none of its choices carry would
    // leave it with nothing to show. Which child is showing is the router's
    // business, and an id that names nothing lands on its not found page.
    const value = choices.some((choice) => choice.value === showing) ? showing : DRAFT;

    return (
        <ChoiceMenu
            icon={<LayersOutlinedIcon />}
            label="Showing"
            value={value}
            choices={choices}
            onChange={(next) => {
                void (next === DRAFT
                    ? navigate({ to: "/manage/$editionId/schedule", params: { editionId } })
                    : navigate({
                          to: "/manage/$editionId/schedule/$scheduleId",
                          params: { editionId, scheduleId: next },
                      }));
            }}
        />
    );
};
