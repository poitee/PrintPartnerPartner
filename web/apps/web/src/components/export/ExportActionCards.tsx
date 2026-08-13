import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchIntegrations,
  fetchPrinters,
  startExport3mf,
  startExportChecklistHtml,
  startExportStlPack,
  startPrinterUpload,
  type IntegrationSummary,
  type PrinterMachine,
  type ReviewPart,
  type StlPackGroupBy,
} from "../../api/engine";
import { useEngineHealth } from "../../hooks/useEngineHealth";
import { useJobRunner } from "../../hooks/useJobRunner";
import { usePlanWorkspace } from "../../context/PlanWorkspaceContext";
import { useProfileSelection } from "../../context/ProfileContext";
import { completeExportDownload } from "../../lib/exportActions";
import { handleExport3mfJobDone } from "../../lib/export3mfJobResult";
import { handleStlPackExportJobDone } from "../../lib/exportStlJobResult";
import { incompleteUnitsForSelectedParts } from "../../lib/printerCheckoffUnits";
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

function isAllowedGcode(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".gcode") || lower.endsWith(".bgcode") || lower.endsWith(".gco");
}

function remainingLabel(part: ReviewPart): string {
  const total = Math.max(1, part.quantity_effective);
  const left = Math.max(0, total - (part.printed_count ?? 0));
  return left === 1 ? "1 unit left" : `${left} units left`;
}

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
  const printerUploadJob = useJobRunner("printer-upload");

  const [linkedPrinters, setLinkedPrinters] = useState<PrinterMachine[]>([]);
  const [bambuStatusOnlyCount, setBambuStatusOnlyCount] = useState(0);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
  const [autoCheckoff, setAutoCheckoff] = useState(true);
  const [selectedCheckoffPartIds, setSelectedCheckoffPartIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingStartRef = useRef(false);

  const hasBlockers = review?.has_blockers ?? false;
  const includedParts = review
    ? flattenReviewParts(review.part_groups).filter((p) => p.included)
    : [];
  const includedCount = includedParts.length;
  const missingParts = includedParts.filter((p) => p.missing);
  const missingCount = missingParts.length;
  const exportBusy =
    exportStlJob.busy || exportJob.busy || export3mfJob.busy || printerUploadJob.busy;
  const canRun = selectedProfileId != null && Boolean(health) && Boolean(review);
  const canExportParts = canRun && !hasBlockers && includedCount > 0;
  const hasLinked = linkedPrinters.length > 0;

  useEffect(() => {
    if (!health) return;
    let cancelled = false;
    void (async () => {
      try {
        const [printers, integrations] = await Promise.all([
          fetchPrinters(),
          fetchIntegrations(),
        ]);
        if (cancelled) return;
        const byId = new Map<string, IntegrationSummary>(
          integrations.map((i) => [i.id, i]),
        );
        const sendTypes = new Set(["moonraker", "prusalink"]);
        const linkedForSend = printers.filter((p) => {
          const id = p.integration_id?.trim();
          if (!id) return false;
          const host = byId.get(id);
          return Boolean(host && sendTypes.has(host.type));
        });
        const bambuLinked = printers.filter((p) => {
          const id = p.integration_id?.trim();
          if (!id) return false;
          return byId.get(id)?.type === "bambu";
        }).length;
        setLinkedPrinters(linkedForSend);
        setBambuStatusOnlyCount(bambuLinked);
        setSelectedPrinterId((prev) =>
          prev && linkedForSend.some((p) => p.id === prev)
            ? prev
            : linkedForSend[0]?.id ?? "",
        );
      } catch {
        if (cancelled) return;
        setLinkedPrinters([]);
        setBambuStatusOnlyCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [health]);

  const missingPartIdsKey = missingParts.map((p) => p.id).join(",");

  useEffect(() => {
    setSelectedCheckoffPartIds(
      missingPartIdsKey ? missingPartIdsKey.split(",").map(Number) : [],
    );
  }, [review?.profile_id, missingPartIdsKey]);

  const linkedChip = useMemo(() => {
    if (!hasLinked) return "no linked hosts";
    return linkedPrinters.length === 1
      ? "1 linked printer"
      : `${linkedPrinters.length} linked printers`;
  }, [hasLinked, linkedPrinters.length]);

  const checkoffUnits = useMemo(() => {
    if (!autoCheckoff || selectedProfileId == null) return [];
    return incompleteUnitsForSelectedParts(missingParts, selectedCheckoffPartIds);
  }, [autoCheckoff, missingParts, selectedCheckoffPartIds, selectedProfileId]);

  const toggleCheckoffPart = (partId: number) => {
    setSelectedCheckoffPartIds((prev) =>
      prev.includes(partId) ? prev.filter((id) => id !== partId) : [...prev, partId],
    );
  };

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

  const openFilePicker = (startAfterUpload: boolean) => {
    if (!hasLinked || !selectedPrinterId) {
      toast.error("No linked printer", {
        description: "Link a Moonraker or PrusaLink host in Settings first.",
      });
      return;
    }
    pendingStartRef.current = startAfterUpload;
    fileInputRef.current?.click();
  };

  const onFileChosen = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!isAllowedGcode(file.name)) {
      toast.error("Wrong file type", {
        description: "Choose a sliced .gcode, .gco, or .bgcode file.",
      });
      return;
    }
    if (!selectedPrinterId) {
      toast.error("No linked printer", {
        description: "Link a Moonraker or PrusaLink host in Settings first.",
      });
      return;
    }
    const start = pendingStartRef.current;
    const printerName =
      linkedPrinters.find((p) => p.id === selectedPrinterId)?.name ?? "printer";
    const units =
      autoCheckoff && selectedProfileId != null && checkoffUnits.length > 0
        ? checkoffUnits
        : undefined;
    if (autoCheckoff && missingCount > 0 && (!units || units.length === 0)) {
      toast.message("Sending without Progress verify tracking", {
        description: "Select at least one missing part, or turn the checkbox off.",
      });
    }
    void printerUploadJob.runJob(
      () =>
        startPrinterUpload({
          file,
          printer_id: selectedPrinterId,
          start,
          profile_id: units ? selectedProfileId ?? undefined : undefined,
          checkoff_units: units,
        }),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Send to printer failed");
          return;
        }
        const mapped =
          typeof snap.result?.checkoff_units === "number"
            ? snap.result.checkoff_units
            : units?.length ?? 0;
        if (mapped > 0) {
          toast.success(snap.message || `Sent ${file.name} to ${printerName}`, {
            description: `Will queue ${mapped} Progress unit${mapped === 1 ? "" : "s"} for verify when the print finishes.`,
          });
        } else {
          toast.success(snap.message || `Sent ${file.name} to ${printerName}`);
        }
      },
    );
  };

  const cards = [
    {
      key: "stls",
      title: "Export STLs",
      description: "Every included part, organised by role and source folder.",
      chips: ["by role", "flat or nested"] as const,
      highlight: false,
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
      body:
        includedCount === 0 ? (
          <Button size="sm" variant="outline" disabled>
            Open Progress to print
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
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
      key: "send",
      title: "Send to printer",
      description:
        "Upload a sliced .gcode / .bgcode to a linked Moonraker or PrusaLink host. Bambu is status-only (see Settings / setup docs).",
      chips: [linkedChip, "upload", "optional start", "Progress verify"] as const,
      highlight: hasLinked,
      body: (
        <div className="flex w-full flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gcode,.bgcode,.gco,application/octet-stream"
            className="hidden"
            onChange={(e) => onFileChosen(e.target.files)}
          />
          {hasLinked ? (
            <>
              <select
                className="min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={selectedPrinterId}
                disabled={exportBusy}
                aria-label="Target printer"
                onChange={(e) => setSelectedPrinterId(e.target.value)}
              >
                {linkedPrinters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {missingCount > 0 && selectedProfileId != null ? (
                <div className="rounded-md border border-border/80 bg-muted/30 px-2.5 py-2 text-xs">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={autoCheckoff}
                      disabled={exportBusy}
                      onChange={(e) => setAutoCheckoff(e.target.checked)}
                    />
                    <span className="leading-snug text-foreground">
                      Track for Progress verify when this print finishes
                      {autoCheckoff && checkoffUnits.length > 0
                        ? ` (${checkoffUnits.length})`
                        : ""}
                    </span>
                  </label>
                  {autoCheckoff ? (
                    <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto border-t border-border/60 pt-2">
                      {missingParts.map((part) => {
                        const checked = selectedCheckoffPartIds.includes(part.id);
                        return (
                          <li key={part.id}>
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={checked}
                                disabled={exportBusy}
                                onChange={() => toggleCheckoffPart(part.id)}
                              />
                              <span className="min-w-0 flex-1 leading-snug">
                                <span className="font-medium">{part.filename}</span>
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {remainingLabel(part)}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exportBusy || !selectedPrinterId}
                  onClick={() => openFilePicker(false)}
                >
                  {printerUploadJob.busy ? "Sending…" : "Upload"}
                </Button>
                <Button
                  size="sm"
                  disabled={exportBusy || !selectedPrinterId}
                  onClick={() => openFilePicker(true)}
                >
                  Upload & start
                </Button>
              </div>
            </>
          ) : (
            <div className="flex w-full flex-col gap-2">
              {bambuStatusOnlyCount > 0 ? (
                <p className="text-xs leading-snug text-muted-foreground">
                  Linked Bambu hosts are status-only. Send stays Moonraker/PrusaLink until
                  official Connect / Local Server — see Printer setup docs.
                </p>
              ) : null}
              <Button size="sm" variant="outline" asChild>
                <Link to={settingsRoute()}>Manage printers in Settings…</Link>
              </Button>
            </div>
          )}
        </div>
      ),
    },
  ];

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
