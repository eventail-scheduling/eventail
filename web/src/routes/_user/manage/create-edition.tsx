import { Box, Button, Container, Grid, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RhfAutocomplete, RhfTextField } from "mui-rhf-integration";
import { RhfDatePicker, RhfDateTimePicker } from "mui-rhf-integration/date-picker";
import { TemporalPlainDateProvider, TemporalZonedDateTimeProvider } from "mui-temporal-pickers";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { isAfter } from "temporal-extra";
import { z } from "zod/mini";
import { ButtonLink } from "#/components/Link/index.js";
import { Scaffold } from "#/components/Scaffold/index.js";
import { useCreateEditionMutation } from "#/mutations/edition.js";
import type { ListEdition } from "#/queries/edition.js";
import { useQueryOptionsFactory } from "#/queries/index.js";
import { defaultMutationErrorHandler } from "#/utils/api.js";
import { requireManagerRole } from "#/utils/route-guards.ts";
import { formResolver, plainDateSchema, zonedDateTimeSchema } from "#/utils/zod.js";

const schema = z
    .object({
        name: z.string().check(z.trim(), z.minLength(1)),
        startDate: plainDateSchema,
        endDate: plainDateSchema,
        timeZone: z.string(),
        submissionDeadline: z.nullable(zonedDateTimeSchema),
        templateEdition: z.nullable(z.custom<ListEdition>()),
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

const Root = (): ReactNode => {
    const qof = useQueryOptionsFactory();
    const timezones = useSuspenseQuery(qof.timezone.list()).data;
    const editions = useSuspenseQuery(qof.edition.list()).data;
    const form = useForm<FieldValues, unknown, TransformedValues>({
        resolver: formResolver(schema),
        defaultValues: {
            submissionDeadline: null,
            templateEdition: null,
        },
    });
    const createEditionMutation = useCreateEditionMutation();
    const navigate = Route.useNavigate();

    useEffect(() => {
        const unsubscribe = form.subscribe({
            formState: {
                values: true,
            },
            callback: ({ values }) => {
                if (
                    values.timeZone &&
                    values.submissionDeadline &&
                    values.submissionDeadline.timeZoneId !== values.timeZone
                ) {
                    form.setValue(
                        "submissionDeadline",
                        values.submissionDeadline.withTimeZone(values.timeZone),
                    );
                }
            },
        });

        return () => unsubscribe();
    }, [form.subscribe, form.setValue]);

    const handleSubmit = useCallback(
        (values: TransformedValues) => {
            createEditionMutation.mutate(values, {
                onSuccess: (edition) => {
                    enqueueSnackbar("Edition has been created", { variant: "success" });
                    navigate({ to: "/manage/$editionId", params: { editionId: edition.id } });
                },
                onError: defaultMutationErrorHandler,
            });
        },
        [createEditionMutation, navigate],
    );

    const startDate = form.watch("startDate") as Temporal.PlainDate | undefined;
    const endDate = form.watch("endDate") as Temporal.PlainDate | undefined;
    const timeZone = form.watch("timeZone") as string | undefined;

    return (
        <Scaffold>
            <Container maxWidth="sm">
                <Box
                    component="form"
                    sx={{ p: 2 }}
                    noValidate
                    onSubmit={form.handleSubmit(handleSubmit)}
                >
                    <Typography variant="h5" sx={{ mb: 4 }}>
                        Create Edition
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

                        <Grid size={12}>
                            <TemporalZonedDateTimeProvider>
                                <RhfDateTimePicker
                                    control={form.control}
                                    name="submissionDeadline"
                                    label="Submission deadline"
                                    timezone={timeZone}
                                    disabled={!timeZone}
                                    slotProps={{
                                        textField: {
                                            helperText: !timeZone
                                                ? "You must select a timezone before you can select a deadline"
                                                : undefined,
                                            fullWidth: true,
                                        },
                                    }}
                                />
                            </TemporalZonedDateTimeProvider>
                        </Grid>

                        {editions.length > 0 && (
                            <Grid size={12}>
                                <RhfAutocomplete
                                    control={form.control}
                                    name="templateEdition"
                                    slotProps={{
                                        textField: {
                                            label: "Copy settings from",
                                        },
                                    }}
                                    options={editions}
                                    isOptionEqualToValue={(option, value) => option.id === value.id}
                                    getOptionLabel={(option) => option.name}
                                    freeSolo={false}
                                />
                            </Grid>
                        )}
                    </Grid>

                    <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end", mt: 4 }}>
                        {editions.length > 0 && <ButtonLink to="/manage">Cancel</ButtonLink>}

                        <Button
                            type="submit"
                            variant="contained"
                            loading={createEditionMutation.isPending}
                        >
                            Create
                        </Button>
                    </Stack>
                </Box>
            </Container>
        </Scaffold>
    );
};

export const Route = createFileRoute("/_user/manage/create-edition")({
    component: Root,
    beforeLoad: requireManagerRole,
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(context.qof.timezone.list());
        await context.queryClient.ensureQueryData(context.qof.edition.list());
    },
});
