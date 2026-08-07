import { CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSourcesQuery } from "../queries/sources";
import { useProfileSelection } from "../context/ProfileContext";
import {
  isWorkflowOnboardingComplete,
  markWorkflowOnboardingComplete,
} from "../lib/persistedWorkflowOnboarding";
import { cn } from "../lib/utils";

type StepState = "done" | "attention" | "pending";

type Step = {
  label: string;
  state: StepState;
};

type Props = {
  compact?: boolean;
  className?: string;
};

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  }
  if (state === "attention") {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

/** Per-plan pipeline progress for sidebar / mobile nav (hidden after first full pass). */
export default function WorkflowProgress({ compact, className }: Props) {
  const [onboardingDismissed, setOnboardingDismissed] = useState(() =>
    isWorkflowOnboardingComplete(),
  );
  const { profiles, selectedProfileId } = useProfileSelection();
  const { data: sources = [] } = useSourcesQuery();
  const selected = profiles.find((p) => p.id === selectedProfileId);

  const hasSources = sources.length > 0;
  const hasPlan = profiles.length > 0;
  const buildStale = selected?.build_stale ?? false;
  const hasParts = (selected?.part_count ?? 0) > 0;
  const workflowComplete = hasSources && hasPlan && hasParts && !buildStale;

  useEffect(() => {
    if (onboardingDismissed || !workflowComplete) return;
    markWorkflowOnboardingComplete();
    setOnboardingDismissed(true);
  }, [onboardingDismissed, workflowComplete]);

  if (onboardingDismissed) return null;

  const steps: Step[] = [
    { label: "Sources", state: hasSources ? "done" : "attention" },
    {
      label: "Build",
      state: !hasPlan ? "pending" : buildStale ? "attention" : hasParts ? "done" : "attention",
    },
    {
      label: "Review",
      state: !hasParts ? "pending" : buildStale ? "attention" : "done",
    },
  ];

  if (!hasPlan && !hasSources) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/30 px-2 py-2",
        compact ? "text-[10px]" : "text-xs",
        className,
      )}
      aria-label="Workflow progress"
    >
      <p className="mb-1.5 font-medium text-muted-foreground">Progress</p>
      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-1.5">
            <StepDot state={step.state} />
            <span
              className={cn(
                step.state === "done" && "text-foreground",
                step.state === "attention" && "text-amber-700 dark:text-amber-300",
                step.state === "pending" && "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
