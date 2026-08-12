import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  fetchPrinters,
  startExport3mf,
  startExportChecklistHtml,
  startExportStlPack,
  type StlPackGroupBy,
} from "../../api/engine";
import { useEngineHealth } from "../../hooks/useEngineHealth";
import { useJobRunner } from "../../hooks/useJobRunner";
import { usePlanWorkspace } from "../../context/PlanWorkspaceContext";
import { useProfileSelection } from "../../context/ProfileContext";
import { completeExportDownload } from "../../lib/exportActions";
import { handleExport3mfJobDone } from "../../lib/export3mfJobResult";
import { handleStlPackExportJobDone } from "../../lib/exportStlJobResult";
import { flattenReviewParts } from "../../lib/reviewParts";
import { progressRoute, settingsRoute } from "../../lib/routes";
import { cn } from "../../lib/utils";
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
 * Export hub card grid — one-click / dropdown actions matching the workflow mock.
 */
export default function ExportActionCards({ onShare }: Props) {
  const { health } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const { review, reload } = usePlanWorkspace();
  const exportStlJob = useJobRunner("stl-export");
  const export3mfJob = useJobRunner("export-3mf");
  const exportJob = useJobRunner("export");

  const hasBlockers = review?.has_blockers ?? false;
  const includedParts = review
    ? flattenReviewParts(review.part_groups).filter((p) => p.included)
    : [];
  const includedCount = includedParts.length;
  const missingCount = includedParts.filter((p) => p.missing).length;
  const exportBusy = exportStlJob.busy || exportJob.busy || export3mfJob.busy;
  const canRun = selectedProfileId != null && Boolean(health) && Boolean(review);
  const canExportParts = canRun && !hasBlockers && includedCount > 0;

  const onExportStls = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId, { group_by: groupBy }),
      (snap) => {
        handleStlPackExportJobDone("STL export", snap, { pathField: "root_path" });
      },
    );
  };

  const onExportMissing = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportJob.runJob(
      () =>
        startExportStlPack(selectedProfileId, {
          missing_only: true,
          group_by: groupBy,
        }),
      (snap) => {
        handleStlPackExportJobDone("Missing-parts STL", snap, {
          pathField: "root_path",
        });
        if (snap.status === "done" && selectedProfileId != null) {
          void reload(selectedProfileId);
        }
      },
    );
  };

  const onExportChecklist = () => {
    if (selectedProfileId == null) return;
    void exportJob.runJob(
      () => startExportChecklistHtml(selectedProfileId),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Checklist export failed");
          return;
        }
        completeExportDownload("Checklist HTML", snap.result);
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
      highlight: false,
      primary: true,
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
      key: "missing",
      title: "Export missing STLs",
      description: "Only what is still unprinted, ready to hand to the next batch.",
      chips: [
        missingCount > 0 ? `${missingCount} parts` : "none missing",
        "zip",
      ] as const,
      highlight: missingCount > 0,
      primary: true,
      body: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={!canExportParts || exportBusy || missingCount === 0}
              className="gap-1"
            >
              {exportJob.busy ? "Exporting…" : "Export missing"}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Group exported files by</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onExportMissing("color_dir")}>
              <div className="flex flex-col">
                <span>Color + directory</span>
                <span className="text-xs text-muted-foreground">
                  Keep source folders (e.g. Primary/partsDir/file.stl)
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExportMissing("color")}>
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
      key: "print",
      title: "Print checklist",
      description: "Paper sheet with thumbnails and tick boxes per unit.",
      chips: ["Progress sheet", "browser print"] as const,
      highlight: false,
      primary: false,
      body: (
        <Button size="sm" variant="outline" asChild disabled={includedCount === 0}>
          <Link to={progressRoute(selectedProfileId)}>Open Progress to print</Link>
        </Button>
      ),
    },
    {
      key: "html",
      title: "Export checklist HTML",
      description: "Self-contained page you can open on a tablet by the printer.",
      chips: ["single file", "offline"] as const,
      highlight: false,
      primary: false,
      body: (
        <Button
          size="sm"
          variant="outline"
          disabled={!canRun || exportBusy || hasBlockers || includedCount === 0}
          onClick={onExportChecklist}
        >
          {exportJob.busy ? "Exporting…" : "Export HTML"}
        </Button>
      ),
    },
    {
      key: "share",
      title: "Share plan bundle",
      description:
        "Sources, picks, roles and quantities — no STLs. Someone else can rebuild it.",
      chips: ["no STLs", "link or file"] as const,
      highlight: false,
      primary: false,
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
    {
      key: "3mf",
      title: "Export 3MF",
      description: "Plated, per role, ready to open in your slicer.",
      chips: ["by role", "per plate"] as const,
      highlight: false,
      primary: false,
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
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <Card
          key={card.key}
          className={cn(
            "flex flex-col border-border shadow-sm",
            card.highlight && "border-primary/40",
          )}
        >
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
