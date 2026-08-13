import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ClipboardCheck, CheckSquare, Printer } from "lucide-react";
import { toast } from "sonner";
import StaleBuildBanner from "../components/StaleBuildBanner";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import EmptyState from "../components/layout/EmptyState";
import PrinterLiveStrip, {
  type PrinterLiveStripState,
} from "../components/checkoff/PrinterLiveStrip";
import PrintVerifyPanel, {
  type PrintVerifyQueueState,
} from "../components/checkoff/PrintVerifyPanel";
import SortableProgressPart from "../components/checkoff/SortableProgressPart";
import PartPreviewDialog from "../components/parts/PartPreviewDialog";
import PartThumbExpandButton from "../components/parts/PartThumbExpandButton";
import SpoolRemainingBadge from "../components/SpoolRemainingBadge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  startRecompute,
  type ReviewPart,
} from "../api/engine";
import { exportRoute, partsRoute, planRoute } from "../lib/routes";
import { groupCheckoffParts } from "../lib/checkoffGroups";
import {
  checkoffUnitTotals,
  formatPrintedUnitsLine,
  lastCompletedUnit,
  nextUnitToComplete,
} from "../lib/checkoffProgress";
import {
  loadPersistedCheckoffUi,
  savePersistedCheckoffUi,
  type CheckoffFilterMode,
} from "../lib/persistedCheckoffUi";
import {
  mergeVisibleReorder,
  moveItemById,
  reconcileOrder,
  sortByPreferredOrder,
} from "../lib/reorderList";
import { flattenReviewParts } from "../lib/reviewParts";
import { useCopilotUiOptional } from "../context/CopilotUiContext";
import { useProfileSelection } from "../context/ProfileContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import { waitForSheetThumbnails } from "../lib/waitForSheetThumbnails";

function CheckoffSheetRow({
  part,
  busy,
  compact,
  eagerThumbs,
  onToggleUnit,
  onPreview,
}: {
  part: ReviewPart;
  busy: boolean;
  compact: boolean;
  eagerThumbs?: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
  onPreview: (part: ReviewPart) => void;
}) {
  const done = part.printed_count >= part.quantity_effective && part.quantity_effective > 0;
  return (
    <tr className={cn("sheet-row", done && "sheet-row-done")}>
      <td className="sheet-cell-part">
        <div className="sheet-part">
          <PartThumbExpandButton
            part={part}
            compact={compact}
            eager={eagerThumbs}
            onExpand={onPreview}
          />
          <div className="sheet-part-meta">
            <span className="sheet-filename" title={part.relative_path || part.filename}>
              {part.filename}
            </span>
            <span className="sheet-part-tags">
              {part.filament_hex && (
                <span className="sheet-swatch" style={{ background: part.filament_hex }} />
              )}
              {part.filament_display && <span>{part.filament_display}</span>}
              <SpoolRemainingBadge part={part} />
              {part.role && <span className="sheet-role">{part.role}</span>}
            </span>
          </div>
        </div>
      </td>
      <td className="sheet-cell-qty sheet-cell-qty-readonly">{part.quantity_effective}</td>
      <td className="sheet-cell-printed">
        <div className="sheet-units">
          {part.print_units.map((unitDone, idx) => (
            <label
              key={idx}
              className={cn("sheet-unit", unitDone && "sheet-unit-done")}
              title={`Unit #${idx + 1}`}
            >
              <input
                type="checkbox"
                checked={unitDone}
                onChange={() => onToggleUnit(part, idx)}
                disabled={busy}
              />
              <span>{idx + 1}</span>
            </label>
          ))}
          <span className={cn("sheet-printed-count", done && "sheet-printed-done")}>
            <span className="sheet-printed-screen">
              {part.printed_count}/{part.quantity_effective}
            </span>
            <span className="sheet-printed-label" aria-hidden>
              {part.printed_count} of {part.quantity_effective}
            </span>
          </span>
        </div>
      </td>
      <td className="sheet-cell-notes">
        <span className="sheet-notes-line" aria-hidden />
      </td>
    </tr>
  );
}

const FILTER_MODES: { mode: CheckoffFilterMode; label: string }[] = [
  { mode: "missing", label: "Missing" },
  { mode: "done", label: "Done" },
  { mode: "all", label: "All" },
];

export default function CheckoffPage() {
  const navigate = useNavigate();
  const { health, error: engineError } = useEngineHealth();
  const { selectedProfileId, profiles } = useProfileSelection();
  const {
    review,
    loading,
    error: workspaceError,
    reload,
    revision,
    loadedRevision,
    toggleUnit,
    busyPartId,
  } = usePlanWorkspace();
  const recomputeJob = useJobRunner("recompute");
  const isMobileLayout = useMediaQuery("(max-width: 767px)");
  const persistedUi = useMemo(() => loadPersistedCheckoffUi(), []);
  const [filter, setFilter] = useState<CheckoffFilterMode>(persistedUi.filter);
  const [search, setSearch] = useState("");
  const [compactMode, setCompactMode] = useState(persistedUi.compactMode);
  const [continuousPrintLayout, setContinuousPrintLayout] = useState(
    persistedUi.continuousPrintLayout,
  );
  const [partOrderByPlanId, setPartOrderByPlanId] = useState(
    () => persistedUi.partOrderByPlanId,
  );
  const [previewPart, setPreviewPart] = useState<ReviewPart | null>(null);
  const [printPrep, setPrintPrep] = useState(false);
  const [verifyRefreshKey, setVerifyRefreshKey] = useState(0);
  const [liveStrip, setLiveStrip] = useState<PrinterLiveStripState>({
    anyPrinting: false,
    hostCount: 0,
  });
  const [verifyQueue, setVerifyQueue] = useState<PrintVerifyQueueState>({
    awaitingCount: 0,
    primaryHostName: null,
  });
  const sheetRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const copilot = useCopilotUiOptional();
  const [pendingPreviewId, setPendingPreviewId] = useState<number | null>(null);
  const appliedIntentSeqRef = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const state = location.state as { previewPartId?: number } | null;
    const partId = state?.previewPartId;
    if (partId == null) return;
    setPendingPreviewId(partId);
  }, [location.state]);

  useEffect(() => {
    if (!copilot || copilot.intentSeq === 0) return;
    if (copilot.intentSeq === appliedIntentSeqRef.current) return;
    const intent = copilot.lastIntent;
    if (intent?.kind !== "highlight_part" || intent.surface !== "checkoff") return;
    if (selectedProfileId != null && intent.planId !== selectedProfileId) return;
    appliedIntentSeqRef.current = copilot.intentSeq;
    setPendingPreviewId(intent.partId);
  }, [copilot, copilot?.intentSeq, selectedProfileId]);

  useEffect(() => {
    if (pendingPreviewId == null || !review) return;
    const part = flattenReviewParts(review.part_groups).find((p) => p.id === pendingPreviewId);
    if (!part) return;
    setPreviewPart(part);
    setPendingPreviewId(null);
    window.history.replaceState({}, document.title);
  }, [pendingPreviewId, review]);

  useEffect(() => {
    if (pendingPreviewId == null) return;
    const timer = window.setTimeout(() => {
      setPendingPreviewId(null);
      window.history.replaceState({}, document.title);
      toast.message(
        `Part #${pendingPreviewId} not found yet — Update build or ask the kit advisor to search parts.`,
      );
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [pendingPreviewId]);

  useEffect(() => {
    const onBeforePrint = () => setPrintPrep(true);
    const onAfterPrint = () => setPrintPrep(false);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  const onPrint = useCallback(async () => {
    setPrintPrep(true);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const sheet = sheetRef.current;
    if (sheet) await waitForSheetThumbnails(sheet);
    window.print();
  }, []);

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) return;
    if (review?.profile_id !== selectedProfileId || loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [health?.ok, selectedProfileId, revision, loadedRevision, reload, review?.profile_id]);

  useEffect(() => {
    setVerifyQueue({ awaitingCount: 0, primaryHostName: null });
  }, [selectedProfileId]);

  useEffect(() => {
    savePersistedCheckoffUi({
      filter,
      compactMode,
      continuousPrintLayout,
      partOrderByPlanId,
    });
  }, [filter, compactMode, continuousPrintLayout, partOrderByPlanId]);

  const planName =
    profiles.find((p) => p.id === selectedProfileId)?.name ??
    review?.plan_name ??
    "Progress";
  const buildStale = profiles.find((p) => p.id === selectedProfileId)?.build_stale ?? false;

  const onUpdateBuild = () => {
    if (selectedProfileId == null) return;
    void recomputeJob.runJob(
      () => startRecompute(selectedProfileId, { apply_manifest: true }),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Update failed");
          return;
        }
        void reload(selectedProfileId);
      },
      { profileId: selectedProfileId },
    );
  };

  const includedParts = useMemo(() => {
    if (!review) return [];
    return flattenReviewParts(review.part_groups).filter((p) => p.included);
  }, [review]);

  const planPartOrder = useMemo(() => {
    const preferred =
      selectedProfileId == null
        ? []
        : (partOrderByPlanId[String(selectedProfileId)] ?? []);
    return reconcileOrder(
      preferred,
      includedParts.map((p) => p.id),
    );
  }, [includedParts, partOrderByPlanId, selectedProfileId]);

  const filtered = useMemo(() => {
    let rows = includedParts;
    if (filter === "missing") rows = rows.filter((p) => p.missing);
    if (filter === "done") rows = rows.filter((p) => !p.missing);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          p.filename.toLowerCase().includes(q) ||
          p.relative_path.toLowerCase().includes(q) ||
          (p.filament_display || "").toLowerCase().includes(q),
      );
    }
    return sortByPreferredOrder(rows, planPartOrder, (p) => p.id);
  }, [includedParts, filter, search, planPartOrder]);

  const onProgressDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (selectedProfileId == null) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const visibleBefore = filtered.map((p) => p.id);
      const visibleAfter = moveItemById(
        visibleBefore,
        Number(active.id),
        Number(over.id),
      );
      if (visibleAfter === visibleBefore) return;
      const nextOrder = mergeVisibleReorder(planPartOrder, visibleBefore, visibleAfter);
      setPartOrderByPlanId((prev) => ({
        ...prev,
        [String(selectedProfileId)]: nextOrder,
      }));
    },
    [filtered, planPartOrder, selectedProfileId],
  );

  const grouped = useMemo(() => groupCheckoffParts(filtered), [filtered]);
  const totals = useMemo(() => checkoffUnitTotals(includedParts), [includedParts]);
  const printedLine = useMemo(() => formatPrintedUnitsLine(includedParts), [includedParts]);
  const loadError = workspaceError;
  const toggleBusy = busyPartId != null;

  /** Progress operator modes — printing blocks verify UI until the live job ends. */
  const progressMode: "printing" | "verify" | "idle" = liveStrip.anyPrinting
    ? "printing"
    : verifyQueue.awaitingCount > 0
      ? "verify"
      : "idle";

  const progressEyebrow =
    selectedProfileId != null && includedParts.length > 0
      ? `${planName} · ${includedParts.length} part${includedParts.length === 1 ? "" : "s"}`
      : selectedProfileId != null
        ? planName
        : null;

  const progressDescription =
    includedParts.length === 0
      ? "Mark each unit as you finish it on the shop floor."
      : progressMode === "printing"
        ? "Verify when a print finishes. Remaining parts stay below."
        : progressMode === "verify"
          ? `${verifyQueue.primaryHostName?.trim() || "Printer"} finished. Confirm what landed.`
          : "Mark remaining units. Verify waits on the next finished print.";

  const onToggleUnit = useCallback(
    (part: ReviewPart, unitIndex: number) => {
      const next = !part.print_units[unitIndex];
      void toggleUnit(part.id, unitIndex, next);
    },
    [toggleUnit],
  );

  const onIncrement = useCallback(
    (part: ReviewPart) => {
      const idx = nextUnitToComplete(part.print_units);
      if (idx >= 0) void toggleUnit(part.id, idx, true);
    },
    [toggleUnit],
  );

  const onDecrement = useCallback(
    (part: ReviewPart) => {
      const idx = lastCompletedUnit(part.print_units);
      if (idx >= 0) void toggleUnit(part.id, idx, false);
    },
    [toggleUnit],
  );

  const renderEmpty = () => {
    if (selectedProfileId == null) {
      return (
        <EmptyState
          icon={ClipboardCheck}
          title="No plan selected"
          description="Choose a build plan to track print progress on the shop floor."
          action={{
            label: "Open Plan",
            onClick: () => navigate(planRoute(null)),
          }}
        />
      );
    }
    if (!review || includedParts.length === 0) {
      return (
        <EmptyState
          icon={ClipboardCheck}
          title="No parts yet"
          description="Update the plan, then review parts before tracking progress."
          action={{
            label: "Open Plan",
            onClick: () => navigate(planRoute(selectedProfileId)),
          }}
        />
      );
    }
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No parts match"
        description="Try a different filter or clear your search."
        action={{
          label: "Show all",
          onClick: () => {
            setFilter("all");
            setSearch("");
          },
        }}
      />
    );
  };

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
        <RouteBreadcrumbs
          items={[
            { label: "Plan", to: planRoute(selectedProfileId) },
            { label: "Parts", to: partsRoute(selectedProfileId) },
            { label: "Progress" },
          ]}
        />
        <PageHeader
          icon={CheckSquare}
          accent
          eyebrow={progressEyebrow}
          title="Progress"
          description={progressDescription}
          actions={
            <PageHeaderActions>
              <Button
                variant="ghost"
                className="min-h-10 w-full sm:w-auto"
                onClick={() => void onPrint()}
                disabled={selectedProfileId == null || includedParts.length === 0}
              >
                <Printer className="mr-1 h-4 w-4" />
                Print
              </Button>
              <Button className="min-h-10 w-full sm:w-auto" asChild>
                <Link to={exportRoute(selectedProfileId)}>Export hub</Link>
              </Button>
            </PageHeaderActions>
          }
        />

        <StaleBuildBanner
          stale={buildStale}
          busy={recomputeJob.busy}
          onUpdate={onUpdateBuild}
        />

        {includedParts.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
              <span
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={totals.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${totals.percent}% of print units completed`}
              >
                <span
                  className="block h-full rounded-full bg-success transition-[width]"
                  style={{ width: `${totals.percent}%` }}
                />
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {totals.percent}% · {totals.remainingUnits} remaining
              </span>
            </div>
            {isMobileLayout && (
              <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
                {totals.printedUnits} / {totals.totalUnits}
              </span>
            )}
          </div>
        )}

        <div className="checkoff-sticky flex flex-col gap-2">
          <PrinterLiveStrip
            engineReady={Boolean(health?.ok)}
            onLiveStateChange={setLiveStrip}
            onCheckoffUpdate={(profileId) => {
              if (selectedProfileId != null && profileId === selectedProfileId) {
                setVerifyRefreshKey((k) => k + 1);
              }
            }}
          />
          {progressMode === "printing" && includedParts.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Verify appears when this print finishes. We don&apos;t mark parts from a live
              job.
            </p>
          ) : null}
          <PrintVerifyPanel
            engineReady={Boolean(health?.ok)}
            profileId={selectedProfileId}
            parts={includedParts}
            refreshKey={verifyRefreshKey}
            suppressVerifyActions={progressMode === "printing"}
            onQueueChange={setVerifyQueue}
            onVerified={() => {
              if (selectedProfileId != null) void reload(selectedProfileId);
            }}
          />
          {progressMode === "idle" &&
          includedParts.length > 0 &&
          Boolean(health?.ok) &&
          selectedProfileId != null ? (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Nothing to verify. Send a sliced .gcode from Export, then confirm here when it
              finishes.
            </div>
          ) : null}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <input
            type="search"
            className="checkoff-search w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base sm:flex-1 sm:py-1.5 sm:text-sm"
            placeholder="Search parts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={toggleBusy}
          />
          <div
            className={cn(
              "checkoff-filter-group",
              isMobileLayout
                ? "flex w-full flex-wrap gap-2"
                : "inline-flex overflow-hidden rounded-md border border-border",
            )}
            role="group"
            aria-label="Filter"
          >
            {FILTER_MODES.map(({ mode, label }) => (
              <Button
                key={mode}
                size="sm"
                className={cn(
                  isMobileLayout
                    ? "min-h-10 rounded-full px-3.5"
                    : "min-h-8 rounded-none border-0 px-3 shadow-none",
                  filter === mode && isMobileLayout && "border-primary/40 bg-primary/10 text-primary",
                  filter === mode && !isMobileLayout && "bg-primary/10 text-primary",
                  filter !== mode && isMobileLayout && "border border-border bg-background text-muted-foreground",
                )}
                variant={filter === mode ? "secondary" : "ghost"}
                aria-pressed={filter === mode}
                onClick={() => setFilter(mode)}
                disabled={toggleBusy}
              >
                {label}
              </Button>
            ))}
          </div>
          {!isMobileLayout && (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={compactMode}
                  onChange={(e) => setCompactMode(e.target.checked)}
                />
                Compact print rows
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={continuousPrintLayout}
                  onChange={(e) => setContinuousPrintLayout(e.target.checked)}
                />
                Continuous layout when printing
              </label>
            </>
          )}
          </div>
        </div>

        <div>
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        </div>
      </div>

      {!health ? (
        <Card className="no-print">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {engineError
                ? "Engine offline — start the print-partner engine to use Progress."
                : "Connecting to the engine…"}
            </p>
          </CardContent>
        </Card>
      ) : loading && !review ? (
        <Card className="no-print">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading progress…</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <div className="no-print">{renderEmpty()}</div>
      ) : (
        <>
          {/* Screen Progress list (mock Progress / phone checkoff). */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onProgressDragEnd}
          >
            <SortableContext
              items={filtered.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div
                className="no-print flex flex-col gap-2 sm:gap-2"
                aria-label="Reorderable progress parts"
              >
                {filtered.map((part) => (
                  <SortableProgressPart
                    key={part.id}
                    part={part}
                    mobile={isMobileLayout}
                    busy={busyPartId === part.id || toggleBusy}
                    disabled={toggleBusy}
                    onToggleUnit={onToggleUnit}
                    onIncrement={onIncrement}
                    onDecrement={onDecrement}
                    onPreview={setPreviewPart}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Printable sheet — paper tokens; off-screen until print (thumbs still load). */}
          <article
            ref={sheetRef}
            aria-hidden={!printPrep}
            className={cn(
              "checkoff-sheet",
              compactMode && "compact",
              printPrep && continuousPrintLayout && "checkoff-sheet-print-continuous",
              printPrep
                ? "pointer-events-none absolute top-0 -left-[9999px] w-[880px] print:pointer-events-auto print:static print:left-auto print:w-auto"
                : "hidden print:block",
            )}
          >
            <header className="sheet-header">
              <h1 className="sheet-title">{planName}</h1>
              <p className="sheet-subtitle">
                {filtered.length} part{filtered.length === 1 ? "" : "s"} · {printedLine}
              </p>
            </header>

            {grouped.map((repo) => (
              <section key={repo.repoLayer} className="sheet-repo">
                <h2 className="sheet-repo-title">
                  {repo.repoLabel}
                  <span className="sheet-repo-count">{repo.partCount}</span>
                </h2>
                {repo.folders.map((group) => (
                  <div key={group.folder} className="sheet-folder">
                    <h3 className="sheet-folder-title">{group.folder}</h3>
                    <div className="sheet-table-wrap">
                      <table className="sheet-table">
                        <thead>
                          <tr>
                            <th className="sheet-cell-part">Part</th>
                            <th className="sheet-cell-qty">Qty</th>
                            <th className="sheet-cell-printed">Printed</th>
                            <th className="sheet-cell-notes">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.parts.map((part) => (
                            <CheckoffSheetRow
                              key={part.id}
                              part={part}
                              busy={busyPartId === part.id || toggleBusy}
                              compact={compactMode}
                              eagerThumbs={printPrep}
                              onToggleUnit={onToggleUnit}
                              onPreview={setPreviewPart}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </article>
        </>
      )}

      {review && (
        <div className="no-print flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className="min-h-10 w-full sm:w-auto" variant="ghost" asChild>
            <Link to={partsRoute(selectedProfileId)}>Back to Parts</Link>
          </Button>
          <Button className="min-h-10 w-full sm:w-auto" variant="ghost" asChild>
            <Link to={exportRoute(selectedProfileId)}>Open Export hub</Link>
          </Button>
        </div>
      )}

      <PartPreviewDialog part={previewPart} onClose={() => setPreviewPart(null)} />
    </div>
  );
}
