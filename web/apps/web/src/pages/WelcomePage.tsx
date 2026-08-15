import { Link } from "react-router-dom";
import {
  ClipboardCheck,
  FolderGit2,
  Hammer,
  HelpCircle,
  Layers,
} from "lucide-react";
import CreatePlanButton from "../components/CreatePlanButton";
import EmptyState from "../components/layout/EmptyState";
import { Button } from "../components/ui/button";
import { useProfileSelection } from "../context/ProfileContext";
import { useSourcesQuery } from "../queries/sources";
import { buildRoute, helpRoute, sourcesRoute } from "../lib/routes";
import { useEngineHealth } from "../hooks/useEngineHealth";

const STEPS = [
  {
    icon: FolderGit2,
    title: "Add a source",
    description: "Register a GitHub repo, local folder, or zip with your STL kit files.",
    to: sourcesRoute(),
  },
  {
    icon: Layers,
    title: "Create a plan",
    description:
      "Use Create plan in the sidebar under the plan picker to create or switch plans.",
    to: null,
  },
  {
    icon: Hammer,
    title: "Pick files & colors",
    description: "Attach sources, select STL folders, and set role filament colors on Plan.",
    to: buildRoute(null),
  },
  {
    icon: ClipboardCheck,
    title: "Update & review",
    description:
      "Click Rebuild plan, then validate on Parts, track printing on Progress, and ship from Export.",
    to: buildRoute(null),
  },
] as const;

export default function WelcomePage() {
  const { health } = useEngineHealth();
  const { profiles } = useProfileSelection();
  const { data: sources = [] } = useSourcesQuery(Boolean(health?.ok));

  const doneSources = sources.length > 0;
  const donePlan = profiles.length > 0;

  if (doneSources && donePlan) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-8">
        <EmptyState
          icon={Hammer}
          title="You're set up"
          description="Continue on Plan to pick files and update your kit."
          action={{
            label: "Open Plan",
            onClick: () => {
              window.location.href = buildRoute(profiles[0]?.id ?? null);
            },
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Print Partner</h1>
        <p className="text-sm text-muted-foreground">
          Self-hosted workflow for layered STL kits.
        </p>
      </header>

      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done =
            (i === 0 && doneSources) ||
            (i === 1 && donePlan);
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className="flex gap-3 rounded-lg border border-border bg-card p-4"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  done
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {i + 1}. {step.title}
                  {done && (
                    <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                      Done
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
                {step.to && !done && i === 0 && (
                  <Button className="mt-2" size="sm" asChild>
                    <Link to={step.to}>Add source</Link>
                  </Button>
                )}
                {!done && i === 1 && (
                  <div className="mt-2">
                    <CreatePlanButton variant="default" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-center text-sm text-muted-foreground">
        <Link to={helpRoute()} className="inline-flex items-center gap-1 text-primary underline">
          <HelpCircle className="h-3.5 w-3.5" />
          Read the workflow guide
        </Link>
      </p>
    </div>
  );
}
