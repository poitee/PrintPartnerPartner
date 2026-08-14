import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  fetchPrinters,
  startExport3mf,
  startExportStlPack,
  type StlPackGroupBy,
} from "../../api/engine";
import { useEngineHealth } from "../../hooks/useEngineHealth";
import { useJobRunner } from "../../hooks/useJobRunner";
import { usePlanWorkspace } from "../../context/PlanWorkspaceContext";
import { useProfileSelection } from "../../context/ProfileContext";
import { checkoffUnitTotals } from "../../lib/checkoffProgress";
import { handleExport3mfJobDone } from "../../lib/export3mfJobResult";
import { handleStlPackExportJobDone } from "../../lib/exportStlJobResult";
import { flattenReviewParts } from "../../lib/reviewParts";
import { settingsRoute } from "../../lib/routes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type Props = {
  onShare: () => void;
};

/**
 * Slicer-input file cards for Export — STLs (all + remaining from this plan's
 * Progress checkoff), 3MF, share bundle. Sending to a printer lives in
 * PrinterSendPanel above. Farm-queue verbs (Send ready / Send now / Remove)
 * live on Progress, not here.
 */
export default function ExportActionCards({ onShare }: Props) {
  const { health } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const { review } = usePlanWorkspace();
  const exportStlJob = useJobRunner("stl-export");
  const export3mfJob = useJobRunner("export-3mf");

  const hasBlockers = review?.has_blockers ?? false;
  const includedParts = review
    ? flattenReviewParts(review.part_groups).filter((p) => p.included)
    : [];
  const includedCount = includedParts.length;
  const remainingUnits = checkoffUnitTotals(includedParts).remainingUnits;
  const exportBusy = exportStlJob.busy || export3mfJob.busy;
  const canRun = selectedProfileId != null && Boolean(health) && Boolean(review);
  const canExportParts = canRun && !hasBlockers && includedCount > 0;
  const canExportRemaining = canExportParts && remainingUnits > 0;

  const onExportStls = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId, { group_by: groupBy }),
      (snap) => {
        handleStlPackExportJobDone("STL export", snap, { pathField: "root_path" });
      },
    );
  };

  const onExportRemaining = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () =>
        startExportStlPack(selectedProfileId, {
          missing_only: true,
          group_by: groupBy,
        }),
      (snap) => {
        handleStlPackExportJobDone("Export remaining", snap, {
          pathField: "root_path",
        });
      },
    );
  };

  const onExport3mf = (layoutMode: "per_plate" | "zip") => {
    if (selectedProfileId == null) return;
    void (async () => {
      try {
        const printers = await fetchPrinters();
        if (!printers.length) {
          toast.error("No printers configured", {
            description: "Add a printer in Settings before exporting 3MF.",
          });
          return;
        }
        await export3mfJob.runJob(
          () =>
            startExport3mf({
              profile_id: selectedProfileId,
              layout_mode: layoutMode,
              enabled_printer_ids: printers.map((p) => p.id),
            }),
          (snap) => {
            handleExport3mfJobDone("3MF export", snap);
          },
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const cards = [
    {
      key: "stls",
      title: "Export STLs",
      description: "Every included part, organised by role and source folder.",
      chips: ["by role", "flat or nested"] as const,
      body: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={!canExportParts || exportBusy}
              className="gap-1"
            >
              {exportStlJob.busy
                ? "Exporting…"
                : includedCount > 0
                  ? `Export ${includedCount} parts`
                  : "Export STLs"}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Group exported files by</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onExportStls("color_dir")}>
              <div className="flex flex-col">
                <span>Color + directory</span>
                <span className="text-xs text-muted-foreground">
                  Keep source folders (e.g. Primary/partsDir/file.stl)
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExportStls("color")}>
              <div className="flex flex-col">
                <span>Color only</span>
                <span className="text-xs text-muted-foreground">
                  Flatten all directories (e.g. Primary/file.stl)
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    {
      key: "remaining",
      title: `Export remaining ${remainingUnits}`,
      description:
        "Unprinted STL units from this plan's Progress checkoff — not shop-bin stock.",
      chips: [
        remainingUnits > 0
          ? `${remainingUnits} unit${remainingUnits === 1 ? "" : "s"}`
          : "none remaining",
        "this plan",
      ] as const,
      body: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={!canExportRemaining || exportBusy}
              className="gap-1"
            >
              {exportStlJob.busy
                ? "Exporting…"
                : remainingUnits > 0
                  ? `Export remaining ${remainingUnits}`
                  : "Export remaining"}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Group exported files by</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onExportRemaining("color_dir")}>
              <div className="flex flex-col">
                <span>Color + directory</span>
                <span className="text-xs text-muted-foreground">
                  Keep source folders (e.g. Primary/partsDir/file.stl)
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExportRemaining("color")}>
              <div className="flex flex-col">
                <span>Color only</span>
                <span className="text-xs text-muted-foreground">
                  Flatten all folders (e.g. Primary/file.stl)
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    {
      key: "3mf",
      title: "Export 3MF",
      description: "Plated, per role, ready to open in your slicer.",
      chips: ["by role", "per plate"] as const,
      body: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={!canExportParts || exportBusy}
              className="gap-1"
            >
              {export3mfJob.busy ? "Exporting…" : "Export 3MF"}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>3MF layout</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onExport3mf("per_plate")}>
              <div className="flex flex-col">
                <span>One file per plate</span>
                <span className="text-xs text-muted-foreground">
                  Best for Prusa / Bambu / Orca (default)
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport3mf("zip")}>
              <div className="flex flex-col">
                <span>Zip all plates</span>
                <span className="text-xs text-muted-foreground">
                  Plate 3MFs plus print_plan.json
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={settingsRoute()} className="cursor-pointer">
                Manage printers in Settings…
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    {
      key: "share",
      title: "Share plan",
      description:
        "Sources, picks, roles and quantities — no STLs. Someone else can rebuild it.",
      chips: ["no STLs", "link or file"] as const,
      body: (
        <Button
          size="sm"
          variant="outline"
          disabled={selectedProfileId == null}
          onClick={onShare}
        >
          Create bundle
        </Button>
      ),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <Card key={card.key} className="flex flex-col border-border shadow-sm">
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="text-[13.5px] font-semibold leading-snug">
              {card.title}
            </CardTitle>
            <CardDescription className="text-[12.5px] leading-relaxed">
              {card.description}
            </CardDescription>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {card.chips.map((chip) => (
                <Badge
                  key={chip}
                  variant="muted"
                  className="rounded-full px-2 py-0.5 font-mono text-[10.5px] font-normal"
                >
                  {chip}
                </Badge>
              ))}
            </div>
          </CardHeader>
          <CardContent className="mt-auto flex items-center gap-2 pt-1">
            {card.body}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
