import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Container,
    Divider,
    Grid,
    Typography,
} from "@mui/material";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useConfirm } from "material-ui-confirm";
import { RhfAutocomplete, RhfTextField } from "mui-rhf-integration";
import { RhfDatePicker, RhfDateTimePicker } from "mui-rhf-integration/date-picker";
import { TemporalPlainDateProvider, TemporalZonedDateTimeProvider } from "mui-temporal-pickers";
import { closeSnackbar, enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { isAfter } from "temporal-extra";
import { z } from "zod/mini";
import { SettleReportDialog } from "#/components/SettleReportDialog.js";
import { useDialogController } from "#/hooks/useDialogController.js";
import { useUpdateEditionMutation } from "#/mutations/edition.js";
import {
    type Edition,
    isEditionChanged,
    type StartDateQuestion,
    startDateQuestion,
} from "#/queries/edition.js";
import { useQueryOptionsFactory } from "#/queries/index.js";
import { anythingWasRemoved, type SettleReport } from "#/queries/settle.js";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { requireManager } from "#/utils/route-guards.ts";
import { formResolver, plainDateSchema, zonedDateTimeSchema } from "#/utils/zod.js";
import { EditionIdField } from "./-components/EditionIdField.js";
import { MoveEditionDialog } from "./-components/MoveEditionDialog.js";

const schema = z
    .object({
        name: z.string().check(z.trim(), z.minLength(1)),
        startDate: plainDateSchema,
        endDate: plainDateSchema,
        timeZone: z.string(),
        submissionDeadline: z.nullable(zonedDateTimeSchema),
        version: z.int(),
    })
    .check((context) => {
        if (isAfter(context.value.startDate, context.value.endDate)) {
            context.issues.push({
                code: "custom",
                message: "Must be before or equal to end date",
                path: ["startDate"],
                input: context.value.startDate,
            });
        }
    });

type FieldValues = z.input<typeof schema>;
type TransformedValues = z.output<typeof schema>;

const mapEdition = (edition: Edition): FieldValues => {
    const submissionDeadline =
        edition.submissionDeadline?.toZonedDateTimeISO(edition.timeZone) ?? null;

    return { ...edition, submissionDeadline, version: edition.$meta.version };
};

type Asked = {
    question: StartDateQuestion;
    values: TransformedValues;
};

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const queryClient = useQueryClient();
    const timezones = useSuspenseQuery(qof.timezone.list()).data;
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;
    const updateEditionMutation = useUpdateEditionMutation(editionId);
    const confirm = useConfirm();
    const moveDialog = useDialogController();
    const reportDialog = useDialogController();
    const [asked, setAsked] = useState<Asked | null>(null);
    const [report, setReport] = useState<SettleReport | null>(null);
    const form = useForm<FieldValues, unknown, TransformedValues>({
        resolver: formResolver(schema),
        defaultValues: mapEdition(edition),
    });

    const values = form.watch();
    // react-hook-form compares a Temporal value by reference, so a date picked
    // back to what it was would still read as dirty; compare by value instead.
    const daysMove =
        values.startDate?.equals(edition.startDate) !== true ||
        values.endDate?.equals(edition.endDate) !== true;
    const zoneChanges = values.timeZone !== edition.timeZone;

    const reloadFromServer = useCallback(async () => {
        const fresh = await queryClient.fetchQuery(qof.edition.get(editionId));
        form.reset(mapEdition(fresh.edition));
    }, [editionId, form, qof, queryClient]);

    const submit = useCallback(
        (values: TransformedValues, startDateBecomes: Temporal.PlainDate | undefined) => {
            updateEditionMutation.mutate(
                { ...values, startDateBecomes },
                {
                    onSuccess: ({ settled, version }) => {
                        form.setValue("version", version);
                        moveDialog.dialogProps.onClose();

                        if (settled && anythingWasRemoved(settled)) {
                            setReport(settled);
                            reportDialog.open();
                            return;
                        }

                        enqueueSnackbar("Settings have been updated", { variant: "success" });
                    },
                    onError: (error) => {
                        if (isEditionChanged(error)) {
                            moveDialog.dialogProps.onClose();
                            setAsked(null);
                            enqueueSnackbar(
                                "Someone else changed this edition while you had it open",
                                {
                                    variant: "error",
                                    persist: true,
                                    action: (key) => (
                                        <Button
                                            color="inherit"
                                            size="small"
                                            onClick={() => {
                                                closeSnackbar(key);
                                                void reloadFromServer();
                                            }}
                                        >
                                            Discard mine and reload
                                        </Button>
                                    ),
                                },
                            );
                            return;
                        }

                        const question = startDateQuestion(error);

                        if (!question) {
                            defaultMutationErrorHandler(error);
                            return;
                        }

                        setAsked({ question, values });
                        moveDialog.open();
                    },
                },
            );
        },
        [form, moveDialog, reloadFromServer, reportDialog, updateEditionMutation],
    );

    const handleSubmit = useCallback(
        async (values: TransformedValues) => {
            // A change of zone alone moves no days, so the server never stops
            // to ask, yet a clock change inside the new zone can still take
            // slots and shorten availability.
            if (zoneChanges && !daysMove) {
                const { confirmed } = await confirm({
                    title: "Change the timezone?",
                    description:
                        "Everything scheduled keeps the local time it was entered at, now read" +
                        " in the new timezone, so each session happens at a different moment." +
                        " A slot is deleted if a daylight saving change would stretch or" +
                        " shorten it, if it no longer fits inside the edition's days, or if" +
                        " such a change leaves it overlapping another slot in the same room." +
                        " Availability is cut back to what still fits, or removed when none of" +
                        " it does. Published schedules keep the times they were published with," +
                        " and nothing deleted comes back if you change the timezone again.",
                    confirmationText: "Change timezone",
                    confirmationButtonProps: { color: "warning" },
                });

                if (!confirmed) {
                    return;
                }
            }

            submit(values, undefined);
        },
        [confirm, daysMove, submit, zoneChanges],
    );

    const startDate = form.watch("startDate");
    const endDate = form.watch("endDate");
    const timeZone = form.watch("timeZone");

    return (
        <Container maxWidth="md">
            <Box component="form" noValidate onSubmit={form.handleSubmit(handleSubmit)}>
                <Typography variant="h5" sx={{ mb: 4 }}>
                    Change settings
                </Typography>
                <Grid container spacing={2}>
                    <Grid size={12}>
                        <RhfTextField
                            control={form.control}
                            name="name"
                            label="Name"
                            required
                            fullWidth
                        />
                    </Grid>

                    <TemporalPlainDateProvider>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RhfDatePicker
                                control={form.control}
                                name="startDate"
                                label="Start date"
                                slotProps={{ textField: { required: true, fullWidth: true } }}
                                maxDate={endDate}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <RhfDatePicker
                                control={form.control}
                                name="endDate"
                                label="End date"
                                slotProps={{ textField: { required: true, fullWidth: true } }}
                                minDate={startDate}
                            />
                        </Grid>
                    </TemporalPlainDateProvider>

                    <Grid size={12}>
                        <RhfAutocomplete
                            control={form.control}
                            name="timeZone"
                            slotProps={{
                                textField: {
                                    label: "Timezone",
                                    required: true,
                                },
                            }}
                            options={timezones}
                            isOptionEqualToValue={(option, value) => option.id === value.id}
                            getOptionLabel={(option) => option.id}
                            optionToValue={(option) => option.id}
                            valueToOption={(value) => ({ id: value as string })}
                            freeSolo={false}
                            disableClearable
                        />
                    </Grid>

                    {(daysMove || zoneChanges) && (
                        <Grid size={12}>
                            <Alert severity="warning">
                                <AlertTitle>
                                    {daysMove
                                        ? "This moves what is already scheduled"
                                        : "This changes when everything scheduled happens"}
                                </AlertTitle>
                                <Typography variant="body2" sx={{ mb: 0.5 }}>
                                    Every slot in the draft schedule, and all availability given for
                                    this edition, keeps the local time it was entered at
                                    {daysMove
                                        ? " and moves with the dates."
                                        : ", now read in the new timezone."}
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 0.5 }}>
                                    Whatever no longer fits afterwards is deleted, and nothing
                                    deleted comes back if you change your mind.
                                    {daysMove &&
                                        " If anything is scheduled, or any availability has been given, you will be asked where the first day lands before any of it moves."}
                                </Typography>
                                <Typography variant="body2">
                                    Published schedules keep the times they were published with, and
                                    the submission deadline does not move.
                                </Typography>
                            </Alert>
                        </Grid>
                    )}

                    <Grid size={12}>
                        <TemporalZonedDateTimeProvider>
                            <RhfDateTimePicker
                                control={form.control}
                                name="submissionDeadline"
                                label="Submission deadline"
                                timezone={timeZone}
                                disabled={timeZone === ""}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                    },
                                }}
                            />
                        </TemporalZonedDateTimeProvider>
                    </Grid>
                </Grid>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                        type="submit"
                        variant="contained"
                        loading={form.formState.isSubmitting || updateEditionMutation.isPending}
                    >
                        Update
                    </Button>
                </Box>
            </Box>

            <Divider sx={{ my: 4 }} />

            <EditionIdField editionId={editionId} />

            {moveDialog.mount && asked && (
                <MoveEditionDialog
                    question={asked.question}
                    nextStartDate={asked.values.startDate}
                    zoneChanges={asked.values.timeZone !== edition.timeZone}
                    pending={updateEditionMutation.isPending}
                    onConfirm={(startDateBecomes) => {
                        submit(asked.values, startDateBecomes);
                    }}
                    dialogProps={moveDialog.dialogProps}
                />
            )}

            {reportDialog.mount && report && (
                <SettleReportDialog
                    report={report}
                    lead="The change removed these, or cut them short. Reversing it will not bring them back."
                    dialogProps={reportDialog.dialogProps}
                />
            )}
        </Container>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/settings")({
    beforeLoad: requireManager,
    component: Root,
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(context.qof.timezone.list());
    },
});
