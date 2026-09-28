import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Stack,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { RhfRadioGroup } from "mui-rhf-integration";
import { RhfDatePicker } from "mui-rhf-integration/date-picker";
import { TemporalPlainDateProvider } from "mui-temporal-pickers";
import { type ReactNode, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { isAfter, isBefore } from "temporal-extra";
import { match } from "ts-pattern";
import { z } from "zod/mini";
import { useLocale } from "#/components/LocaleProvider";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";
import type { StartDateQuestion } from "#/queries/edition.js";
import { formResolver, plainDateSchema } from "#/utils/zod.js";

const choices = ["moved", "stays", "other"] as const;

type Choice = (typeof choices)[number];

const createSchema = (
    earliest: Temporal.PlainDate,
    latest: Temporal.PlainDate,
    dateFormatter: Intl.DateTimeFormat,
) =>
    z
        .object({
            choice: z.nullable(z.enum(choices)),
            startDateBecomes: z.nullable(plainDateSchema),
        })
        .check((context) => {
            if (context.value.choice === null) {
                context.issues.push({
                    code: "custom",
                    message: "Required",
                    path: ["choice"],
                    input: context.value.choice,
                });

                return;
            }

            if (context.value.choice !== "other") {
                return;
            }

            const picked = context.value.startDateBecomes;

            if (picked === null) {
                context.issues.push({
                    code: "custom",
                    message: "Required",
                    path: ["startDateBecomes"],
                    input: picked,
                });

                return;
            }

            if (isBefore(picked, earliest) || isAfter(picked, latest)) {
                context.issues.push({
                    code: "custom",
                    message: `Pick a day between ${dateFormatter.format(earliest)} and ${dateFormatter.format(latest)}`,
                    path: ["startDateBecomes"],
                    input: picked,
                });
            }
        });

type Schema = ReturnType<typeof createSchema>;
type FieldValues = z.input<Schema>;
type TransformedValues = z.output<Schema>;

const shiftSentence = (days: number, zoneChanges: boolean): string => {
    if (days === 0) {
        return zoneChanges
            ? "Nothing moves to another day, but every time is read in the new timezone."
            : "Nothing scheduled moves.";
    }

    const magnitude = Math.abs(days);
    const distance = `${magnitude} ${magnitude === 1 ? "day" : "days"} ${days > 0 ? "later" : "earlier"}`;

    return zoneChanges
        ? `Everything scheduled moves ${distance}, read in the new timezone.`
        : `Everything scheduled moves ${distance}.`;
};

type OptionLabelProps = {
    title: string;
    detail: string;
};

const OptionLabel = ({ title, detail }: OptionLabelProps): ReactNode => (
    <Box sx={{ py: 0.5 }}>
        <Typography variant="body1">{title}</Typography>
        <Typography variant="body2" color="text.secondary">
            {detail}
        </Typography>
    </Box>
);

type StartDateDialogProps = {
    question: StartDateQuestion;
    nextStartDate: Temporal.PlainDate;
    zoneChanges: boolean;
    /** What is being asked about, since the question alone does not say. */
    lead: string;
    /**
     * What answering will do, which is the part that cannot be shared.
     *
     * An edition move carries availability with it and a reversion leaves it
     * alone, so the question is identical and the consequences are not.
     */
    consequences: ReactNode;
    confirmLabel: string;
    pending: boolean;
    onConfirm: (startDateBecomes: Temporal.PlainDate) => void;
    dialogProps: ControlledDialogProps;
};

/**
 * Asks what the organizer meant, because the two date deltas do not say.
 *
 * Both ends forward by a day is a convention that moved, and equally one that
 * dropped a setup day and gained a teardown day. The answer decides what
 * survives, so it has to be given rather than fallen into: nothing is
 * preselected, the button stays dead until something is, and the paper is
 * deliberately not a form, since Enter in the date field would otherwise commit
 * as a reflex to accepting the field.
 *
 * Cleared on every open rather than on every rebuild, so that asking twice
 * starts from nothing both times. The unmount alone would not manage it: a
 * second question arriving inside the closing transition reverses it, and the
 * form never exits to be rebuilt.
 */
export const StartDateDialog = ({
    question,
    nextStartDate,
    zoneChanges,
    lead,
    consequences,
    confirmLabel,
    pending,
    onConfirm,
    dialogProps,
}: StartDateDialogProps): ReactNode => {
    const { dateFormatter } = useLocale();
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const { previousStartDate, earliest, latest } = question;
    const schema = useMemo(
        () => createSchema(earliest, latest, dateFormatter),
        [earliest, latest, dateFormatter],
    );

    const form = useForm<FieldValues, unknown, TransformedValues>({
        resolver: formResolver(schema),
        defaultValues: { choice: null, startDateBecomes: null },
    });

    useEffect(() => {
        if (dialogProps.open) {
            form.reset();
        }
    }, [form, dialogProps.open]);

    const choice = form.watch("choice");
    const picked = form.watch("startDateBecomes");

    const daysTo = (date: Temporal.PlainDate): number => previousStartDate.until(date).days;

    const options = () => {
        const available = [];

        if (!previousStartDate.equals(nextStartDate)) {
            available.push({
                value: "moved" satisfies Choice,
                label: (
                    <OptionLabel
                        title="The whole edition moved"
                        detail={`Its first day, ${dateFormatter.format(previousStartDate)}, becomes ${dateFormatter.format(nextStartDate)}. ${shiftSentence(daysTo(nextStartDate), zoneChanges)}`}
                    />
                ),
            });
        }

        if (!(isBefore(previousStartDate, earliest) || isAfter(previousStartDate, latest))) {
            available.push({
                value: "stays" satisfies Choice,
                label: (
                    <OptionLabel
                        title="The days stay where they are"
                        detail={`The first day keeps its date, ${dateFormatter.format(previousStartDate)}. ${shiftSentence(0, zoneChanges)}`}
                    />
                ),
            });
        }

        available.push({
            value: "other" satisfies Choice,
            label: <OptionLabel title="Something else" detail="Pick the day it becomes." />,
        });

        return available;
    };

    const handleSubmit = (values: TransformedValues) => {
        const startDateBecomes = match(values.choice)
            .with("moved", () => nextStartDate)
            .with("stays", () => previousStartDate)
            .with("other", () => values.startDateBecomes)
            .with(null, () => null)
            .exhaustive();

        if (startDateBecomes === null) {
            return;
        }

        onConfirm(startDateBecomes);
    };

    return (
        <Dialog
            {...dialogProps}
            onClose={(_event, reason) => {
                if (reason === "backdropClick") {
                    return;
                }

                dialogProps.onClose();
            }}
            maxWidth="sm"
            fullWidth
            fullScreen={fullScreen}
        >
            <DialogTitle>Where does the first day land?</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <DialogContentText variant="body2">{lead}</DialogContentText>

                    {consequences}

                    <RhfRadioGroup
                        control={form.control}
                        name="choice"
                        label="Which of these did you mean?"
                        options={options()}
                    />

                    {choice === "other" && (
                        <TemporalPlainDateProvider>
                            <RhfDatePicker
                                control={form.control}
                                name="startDateBecomes"
                                label="The first day becomes"
                                minDate={earliest}
                                maxDate={latest}
                                referenceDate={nextStartDate}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                        helperText:
                                            picked === null
                                                ? `Any day between ${dateFormatter.format(earliest)} and ${dateFormatter.format(latest)}.`
                                                : shiftSentence(daysTo(picked), zoneChanges),
                                    },
                                }}
                            />
                        </TemporalPlainDateProvider>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={dialogProps.onClose} disabled={pending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="warning"
                    disabled={choice === null}
                    loading={pending}
                    onClick={form.handleSubmit(handleSubmit)}
                >
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
