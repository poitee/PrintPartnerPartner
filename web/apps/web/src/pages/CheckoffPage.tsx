import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardCheck, Printer } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import EmptyState from "../components/layout/EmptyState";
import CheckoffMobilePartCard from "../components/checkoff/CheckoffMobilePartCard";
import PartThumb from "../components/parts/PartThumb";
import SpoolRemainingBadge from "../components/SpoolRemainingBadge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { startExportChecklistHtml, startExportStlPack, type ReviewPart } from "../api/engine";
import { buildRoute, reviewRoute } from "../lib/routes";
import { completeExportDownload } from "../lib/exportActions";
import { groupCheckoffParts } from "../lib/checkoffGroups";
import { formatCheckoffSummary } from "../lib/checkoffProgress";
import {
  loadPersistedCheckoffUi,
  savePersistedCheckoffUi,
  type CheckoffFilterMode,
} from "../lib/persistedCheckoffUi";
import { flattenReviewParts } from "../lib/reviewParts";
import { useProfileSelection } from "../context/ProfileContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";

function CheckoffSheetRow({
  part,
  busy,
  compact,
  onToggleUnit,
}: {
  part: ReviewPart;
  busy: boolean;
  compact: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
}) {
  const done = part.printed_count >= part.quantity_effective && part.quantity_effective > 0;
  return (
    <tr className={cn("sheet-row", done && "sheet-row-done")}>
      <td className="sheet-cell-part">
        <div className="sheet-part">
          <PartThumb partId={part.id} tintHex={part.filament_hex} compact={compact} />
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
            {part.printed_count}/{part.quantity_effective}
          </span>
        </div>
      </td>
      <td className="sheet-cell-notes" aria-hidden />
    </tr>
  );
}

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
    progressSummary,
    toggleUnit,
    busyPartId,
  } = usePlanWorkspace();
  const { busy: exportBusy, message, runJob } = useJobRunner("export");
  const isMobileLayout = useMediaQuery("(max-width: 767px)");
  const persistedUi = useMemo(() => loadPersistedCheckoffUi(), []);
  const [filter, setFilter] = useState<CheckoffFilterMode>(persistedUi.filter);
  const [search, setSearch] = useState("");
  const [compactMode, setCompactMode] = useState(persistedUi.compactMode);

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) return;
    if (review?.profile_id !== selectedProfileId || loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [health?.ok, selectedProfileId, revision, loadedRevision, reload, review?.profile_id]);

  useEffect(() => {
    savePersistedCheckoffUi({ filter, compactMode });
  }, [filter, compactMode]);

  const planName =
    review?.plan_name ??
    profiles.find((p) => p.id === selectedProfileId)?.name ??
    "Checkoff";

  const includedParts = useMemo(() => {
    if (!review) return [];
    return flattenReviewParts(review.part_groups).filter((p) => p.included);
  }, [review]);

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
    return rows;
  }, [includedParts, filter, search]);

  const grouped = useMemo(() => groupCheckoffParts(filtered), [filtered]);
  const summary = progressSummary || formatCheckoffSummary(includedParts);
  const missingCount = useMemo(() => includedParts.filter((p) => p.missing).length, [includedParts]);
  const loadError = workspaceError;
  const toggleBusy = exportBusy || busyPartId != null;

  const onToggleUnit = useCallback(
    (part: ReviewPart, unitIndex: number) => {
      const next = !part.print_units[unitIndex];
      void toggleUnit(part.id, unitIndex, next).then(() => {
        toast.success(next ? "Marked printed" : "Marked not printed");
      });
    },
    [toggleUnit],
  );

  const onExportChecklist = () => {
    if (selectedProfileId == null) return;
    void runJob(
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

  const onExportMissing = () => {
    if (selectedProfileId == null) return;
    void runJob(
      () => startExportStlPack(selectedProfileId, { missing_only: true }),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Missing-STL export failed");
          return;
        }
        completeExportDownload("Missing-parts STL", snap.result, {
          pathField: "root_path",
          isDirectory: true,
        });
        if (selectedProfileId != null) void reload(selectedProfileId);
      },
    );
  };

  const renderEmpty = () => {
    if (selectedProfileId == null) {
      return (
        <EmptyState
          icon={ClipboardCheck}
          title="No plan selected"
          description="Choose a build plan to track print progress on the shop floor."
          action={{
            label: "Open Build",
            onClick: () => navigate(buildRoute(null)),
          }}
        />
      );
    }
    if (!review || includedParts.length === 0) {
      return (
        <EmptyState
          icon={ClipboardCheck}
          title="No parts yet"
          description="Update build on the Build page, then review parts before checkoff."
          action={{
            label: "Open Build",
            onClick: () => navigate(buildRoute(selectedProfileId)),
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
            { label: "Build", to: buildRoute(selectedProfileId) },
            { label: "Review", to: reviewRoute(selectedProfileId) },
            { label: "Checkoff" },
          ]}
        />
        <PageHeader
          title="Checkoff"
          description="Print this sheet and mark each unit as you finish it on the shop floor."
          actions={
            <PageHeaderActions>
              <Button
                variant="ghost"
                className="min-h-10 w-full sm:w-auto"
                onClick={() => window.print()}
                disabled={selectedProfileId == null || includedParts.length === 0}
              >
                <Printer className="mr-1 h-4 w-4" />
                Print
              </Button>
              <Button
                variant="secondary"
                className="min-h-10 w-full sm:w-auto"
                onClick={onExportChecklist}
                disabled={selectedProfileId == null || exportBusy || !review}
              >
                Export checklist
              </Button>
              <Button
                className="col-span-2 min-h-10 w-full sm:col-span-1 sm:w-auto"
                onClick={onExportMissing}
                disabled={selectedProfileId == null || exportBusy || missingCount === 0}
              >
                Export missing STLs
              </Button>
            </PageHeaderActions>
          }
        />

        <p className="hidden text-sm text-muted-foreground md:block">
          <strong className="font-medium text-foreground">Export checklist</strong> downloads a
          printable HTML; <strong className="font-medium text-foreground">Export missing STLs</strong>{" "}
          downloads a ZIP of every still-unprinted unit, organized by role and folder.
        </p>

        <div className="checkoff-sticky no-print flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <input
            type="search"
            className="checkoff-search w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base sm:flex-1 sm:py-1.5 sm:text-sm"
            placeholder="Search parts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={toggleBusy}
          />
          <div
            className="checkoff-filter-group grid w-full grid-cols-3 gap-1 sm:flex sm:w-auto"
            role="group"
            aria-label="Filter"
          >
            {(["all", "missing", "done"] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                className="min-h-10 sm:min-h-8"
                variant={filter === mode ? "secondary" : "ghost"}
                onClick={() => setFilter(mode)}
                disabled={toggleBusy}
              >
                {mode === "all" ? "All" : mode === "missing" ? "Missing" : "Done"}
              </Button>
            ))}
          </div>
          {!isMobileLayout && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={compactMode}
                onChange={(e) => setCompactMode(e.target.checked)}
              />
              Compact rows
            </label>
          )}
        </div>

        <div className="no-print">
          {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>
      </div>

      {!health ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {engineError
                ? "Engine offline — start the print-partner engine to use checkoff."
                : "Connecting to the engine…"}
            </p>
          </CardContent>
        </Card>
      ) : loading && !review ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading checkoff sheet…</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        renderEmpty()
      ) : (
        <article
          className={cn(
            "checkoff-sheet",
            compactMode && !isMobileLayout && "compact",
            isMobileLayout && "checkoff-sheet-mobile",
          )}
        >
          <header className="sheet-header">
            <h1 className="sheet-title">{planName}</h1>
            <p className="sheet-subtitle">
              {filtered.length} part{filtered.length === 1 ? "" : "s"} · {summary}
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
                  {isMobileLayout && (
                    <div className="checkoff-mobile-list no-print">
                      {group.parts.map((part) => (
                        <CheckoffMobilePartCard
                          key={part.id}
                          part={part}
                          busy={busyPartId === part.id || toggleBusy}
                          onToggleUnit={onToggleUnit}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    className={cn(
                      "sheet-table-wrap",
                      isMobileLayout && "checkoff-print-table hidden print:block",
                    )}
                  >
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
                            compact={isMobileLayout || compactMode}
                            onToggleUnit={onToggleUnit}
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
      )}

      {review && (
        <div className="no-print flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className="min-h-10 w-full sm:w-auto" variant="ghost" asChild>
            <Link to={reviewRoute(selectedProfileId)}>Back to Review</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
