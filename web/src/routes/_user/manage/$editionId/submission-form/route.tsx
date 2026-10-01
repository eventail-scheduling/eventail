import {
    Container,
    Step,
    StepButton,
    Stepper,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { sessionFormSteps } from "#/components/SessionFormFields/index.js";
import { requireManager } from "#/utils/route-guards.ts";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const theme = useTheme();
    const compact = useMediaQuery(theme.breakpoints.down("md"));

    const activeStep = sessionFormSteps.findIndex((step) =>
        location.pathname.endsWith(`/submission-form/${step.path}`),
    );

    return (
        <Container>
            <Typography variant="h5" sx={{ mb: 1 }}>
                Submission form
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 0.75 }}>
                What speakers are asked for, and in which order.
            </Typography>

            <Stepper nonLinear activeStep={activeStep} alternativeLabel={compact} sx={{ my: 4 }}>
                {sessionFormSteps.map((step) => (
                    <Step key={step.path} completed={false}>
                        <StepButton
                            onClick={() => {
                                void navigate({
                                    to: `/manage/$editionId/submission-form/${step.path}`,
                                    params: { editionId },
                                    replace: true,
                                });
                            }}
                        >
                            {step.label}
                        </StepButton>
                    </Step>
                ))}
            </Stepper>

            <Outlet />
        </Container>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/submission-form")({
    beforeLoad: requireManager,
    component: Root,
});
