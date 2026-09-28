import {
    Alert,
    Button,
    Checkbox,
    Container,
    FormControlLabel,
    Stack,
    Typography,
} from "@mui/material";
import { createFileRoute } from "@tanstack/react-router";
import { RhfTextField } from "mui-rhf-integration";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/mini";
import { Scaffold } from "#/components/Scaffold/index.js";
import { type PurgeReport, usePurgeUserMutation } from "#/mutations/user-purge.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import { PurgeReportCard } from "./-components/PurgeReportCard.tsx";

const schema = z.object({
    emailAddress: z.string().check(z.trim(), z.minLength(1), z.email()),
});

type FieldValues = z.input<typeof schema>;
type TransformedValues = z.output<typeof schema>;

type Preview = {
    emailAddress: string;
    report: PurgeReport;
};

const Root = (): ReactNode => {
    const purgeMutation = usePurgeUserMutation();
    const [preview, setPreview] = useState<Preview | null>(null);
    const [erased, setErased] = useState<Preview | null>(null);
    const [verified, setVerified] = useState(false);

    const form = useForm<FieldValues, unknown, TransformedValues>({
        resolver: formResolver(schema),
        defaultValues: { emailAddress: "" },
    });

    // The confirm acts on the address that was previewed, and editing the
    // field drops the preview, so the report on screen always describes what
    // the button would do.
    const currentAddress = form.watch("emailAddress");

    if (preview && currentAddress.trim().toLowerCase() !== preview.emailAddress) {
        setPreview(null);
        setVerified(false);
    }

    const handleCheck = (values: TransformedValues) => {
        purgeMutation.mutate(
            { emailAddress: values.emailAddress, dryRun: true },
            {
                onSuccess: (report) => {
                    setPreview({ emailAddress: values.emailAddress.toLowerCase(), report });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    const handleErase = () => {
        if (!preview) {
            return;
        }

        purgeMutation.mutate(
            { emailAddress: preview.emailAddress, dryRun: false },
            {
                onSuccess: (report) => {
                    setErased({ emailAddress: preview.emailAddress, report });
                    setPreview(null);
                    setVerified(false);
                    form.reset();
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    if (erased) {
        return (
            <Scaffold>
                <Container maxWidth="sm" sx={{ my: 4 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                        Erased
                    </Typography>
                    <Alert severity="success" sx={{ mb: 3 }}>
                        Everything held about this address has been removed.
                    </Alert>
                    <PurgeReportCard
                        emailAddress={erased.emailAddress}
                        report={erased.report}
                        erased
                    />
                    <Button
                        sx={{ mt: 3 }}
                        onClick={() => {
                            setErased(null);
                        }}
                    >
                        Erase another
                    </Button>
                </Container>
            </Scaffold>
        );
    }

    return (
        <Scaffold>
            <Container maxWidth="sm" sx={{ my: 4 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                    Erase user
                </Typography>

                <Stack
                    component="form"
                    spacing={2}
                    noValidate
                    onSubmit={form.handleSubmit(handleCheck)}
                >
                    <RhfTextField
                        control={form.control}
                        name="emailAddress"
                        label="Email address"
                        helperText="The address the erasure request came from"
                        type="email"
                        required
                        fullWidth
                    />
                    <div>
                        <Button
                            type="submit"
                            variant="outlined"
                            loading={purgeMutation.isPending && !preview}
                        >
                            Check
                        </Button>
                    </div>
                </Stack>

                {preview && (
                    <Stack spacing={3} sx={{ mt: 4 }}>
                        <PurgeReportCard
                            emailAddress={preview.emailAddress}
                            report={preview.report}
                            erased={false}
                        />

                        <Alert severity="warning">This cannot be undone.</Alert>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={verified}
                                    onChange={(event) => {
                                        setVerified(event.target.checked);
                                    }}
                                />
                            }
                            label="I have verified this request came from the account holder"
                        />

                        <div>
                            <Button
                                variant="contained"
                                color="error"
                                disabled={!verified}
                                loading={purgeMutation.isPending}
                                onClick={handleErase}
                            >
                                Erase permanently
                            </Button>
                        </div>
                    </Stack>
                )}
            </Container>
        </Scaffold>
    );
};

export const Route = createFileRoute("/_user/erase-user/")({
    component: Root,
});
