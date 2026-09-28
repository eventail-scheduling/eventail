import { Step, StepLabel, Stepper, useMediaQuery, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionFormStep } from "#/components/SessionFormFields/index.js";

type SessionStepperProps = {
    steps: SessionFormStep[];
    activeStep: number;
};

export const SessionStepper = ({ steps, activeStep }: SessionStepperProps): ReactNode => {
    const theme = useTheme();
    const alternativeLabel = useMediaQuery(theme.breakpoints.down("md"));

    return (
        <Stepper activeStep={activeStep} alternativeLabel={alternativeLabel} sx={{ mb: 3 }}>
            {steps.map((step) => (
                <Step key={step.path}>
                    <StepLabel>{step.label}</StepLabel>
                </Step>
            ))}
        </Stepper>
    );
};
