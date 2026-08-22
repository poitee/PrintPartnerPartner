import { useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import EmptyState from "../components/layout/EmptyState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { SegmentedControl } from "../components/ui/segmented-control";
import { Layers } from "lucide-react";
import {
  ACCEPTED_VISUAL_SKETCH,
  VISUAL_SKETCHES,
  visualSketchLabel,
  visualSketchSummary,
  type VisualSketch,
} from "../lib/visualSketch";
import { pageDensityFromPath } from "../lib/pageDensity";
import { buildsRoute, productionRoute } from "../lib/routes";

const INVENTORY: Array<{ name: string; status: "Keep" | "Revise" | "Merge" | "Remove"; why: string }> = [
  { name: "ui/* primitives", status: "Keep", why: "One job each; catalog states live here." },
  { name: "layout/PageHeader, EmptyState, SpineRail", status: "Keep", why: "Shell owners for every section." },
  { name: "plan/PlanDraftPanel", status: "Keep", why: "Plan-owned Apply." },
  { name: "checkoff/PrintVerifyPanel", status: "Keep", why: "Build Checkoff owns verification." },
  { name: "export/accepted-plates/*", status: "Keep", why: "Production owner; saved XY, pin, Arrange, and transfer are in code." },
  { name: "share/IncomingSharesCard", status: "Keep", why: "Mounted on Builds; outgoing sharing stays live." },
  { name: "settings/PrintersSettingsCard", status: "Keep", why: "Global Printers owns setup; Settings keeps a copy plus Library." },
  { name: "PlanTray leftover copy", status: "Revise", why: "Still says plan in places the spine already owns." },
  { name: "WelcomePage", status: "Remove", why: "Deleted; Builds is home." },
];

function FixtureBuildRow() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-[var(--density-row-gap)] border-b border-border py-2 text-sm">
      <span className="font-medium">Voron 2.4</span>
      <span className="font-mono text-xs text-muted-foreground">6 remaining</span>
      <span className="font-mono text-xs text-muted-foreground">2 printing · 1 to verify</span>
    </div>
  );
}

function FixturePlanItem() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-[var(--density-card-pad)]">
      <div>
        <p className="font-medium">frame_bottom.stl</p>
        <p className="text-xs text-muted-foreground">primary · qty 2 inferred</p>
      </div>
      <Badge>Ready</Badge>
    </div>
  );
}

function FixtureProductionJob() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-[var(--density-card-pad)]">
      <div>
        <p className="font-medium">Awaiting verification</p>
        <p className="font-mono text-xs text-muted-foreground">Core One · plate-01.gcode</p>
      </div>
      <Link className="text-xs underline-offset-2 hover:underline" to={productionRoute(7)}>
        Checkoff
      </Link>
    </div>
  );
}

/** Maintainer catalog for Phase 8 component states and visual sketches. */
export default function DevCatalogPage() {
  const [sketch, setSketch] = useState<VisualSketch>(ACCEPTED_VISUAL_SKETCH);
  const [mode, setMode] = useState<"light" | "dark">("dark");

  return (
    <div className="space-y-[var(--density-row-gap)]">
      <PageHeader
        icon={Layers}
        title="Component catalog"
        description="Primitive states, Keep/Revise/Merge/Remove inventory, and the three visual sketches. Shipping theme is the hybrid."
      />
      <p className="text-sm text-muted-foreground">
        Compare sketches here. Sources, Plan, and Checkoff stay calm. Production and Printers stay dense.
        Paper Checkoff tokens are independent of these sketches.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <SegmentedControl
          aria-label="Visual sketch"
          value={sketch}
          onValueChange={setSketch}
          options={VISUAL_SKETCHES.map((value) => ({
            value,
            label: visualSketchLabel(value),
          }))}
        />
        <SegmentedControl
          aria-label="Catalog appearance"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
        />
      </div>
      <p className="text-sm text-muted-foreground">{visualSketchSummary(sketch)}</p>

      <div
        data-testid="catalog-stage"
        data-sketch={sketch}
        className={mode === "dark" ? "dark" : undefined}
      >
        <div className="space-y-[var(--density-row-gap)] rounded-lg border border-border bg-background p-[var(--density-card-pad)] text-foreground">
          <section className="space-y-2" aria-labelledby="catalog-primitives">
            <h2 id="catalog-primitives" className="text-sm font-medium">
              Primitive states
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button>New Build</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost" disabled>
                Disabled
              </Button>
              <Button variant="secondary">Retry</Button>
            </div>
            <Input aria-label="Search builds" placeholder="Search builds" defaultValue="" />
            <EmptyState icon={Layers} title="No Builds yet." />
            <p className="text-sm text-muted-foreground">Connecting to the engine…</p>
            <p className="text-sm text-destructive" role="alert">
              Could not load builds: engine offline
            </p>
          </section>

          <section className="space-y-2" aria-labelledby="catalog-fixtures">
            <h2 id="catalog-fixtures" className="text-sm font-medium">
              Workflow fixtures
            </h2>
            <p className="text-xs text-muted-foreground">
              Calm density {pageDensityFromPath("/plan")} · Production density{" "}
              {pageDensityFromPath("/export")}
            </p>
            <Card>
              <CardHeader>
                <CardTitle>Build row</CardTitle>
                <CardDescription>Name, remaining, printing, verify.</CardDescription>
              </CardHeader>
              <CardContent>
                <FixtureBuildRow />
              </CardContent>
            </Card>
            <FixturePlanItem />
            <div data-density="dense">
              <FixtureProductionJob />
            </div>
          </section>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="catalog-inventory">
        <h2 id="catalog-inventory" className="text-sm font-medium">
          Inventory
        </h2>
        <table className="w-full text-sm" aria-label="Component inventory">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3">Component</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1">Why</th>
            </tr>
          </thead>
          <tbody>
            {INVENTORY.map((row) => (
              <tr key={row.name} className="border-t border-border/80">
                <td className="py-2 pr-3 font-mono text-xs">{row.name}</td>
                <td className="py-2 pr-3">{row.status}</td>
                <td className="py-2 text-muted-foreground">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          Full table: <code>.audit/phase-8-component-inventory.tsv</code>. Return to{" "}
          <Link className="underline-offset-2 hover:underline" to={buildsRoute()}>
            Builds
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
