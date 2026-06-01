import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Printer } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/layout/PageHeader";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import EmptyState from "../components/layout/EmptyState";
import { buildRoute, reviewRoute } from "../lib/routes";
import { completeExportDownload } from "../lib/exportActions";
import {
  fetchCheckoff,
  patchPartProgress,
  startExportChecklistHtml,
  startExportStlPack,
  type CheckoffPart,
} from "../api/engine";
import { generatePartThumbnail } from "../lib/stlThumbnail";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import {
  applyStackToggle,
  formatCheckoffSummary,
  isPartFullyPrinted,
  printedCountFromUnits,
} from "../lib/checkoffProgress";
import {
  loadPersistedCheckoffUi,
  savePersistedCheckoffUi,
  type CheckoffFilterMode,
} from "../lib/persistedCheckoffUi";
import { groupCheckoffParts } from "../lib/checkoffGroups";

const SHEET_THUMB_PX = 96;

/**
 * Renders a part's STL to a PNG only once it scrolls near the viewport
 * (IntersectionObserver) so the sheet can show a render for EVERY part without
 * rendering hundreds up front.
 */
function CheckoffPartThumb({
  partId,
  tintHex,
  compact,
}: {
  partId: number;
  tintHex?: string | null;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void generatePartThumbnail(partId, tintHex).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) {
        objectUrl = url;
        setSrc(url);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, partId, tintHex]);

  const px = compact ? 56 : SHEET_THUMB_PX;
  return (
    <div
      ref={ref}
      className="sheet-thumb"
      style={{ width: px, height: px }}
    >
      {src ? (
        <img className="sheet-thumb-img" src={src} alt="" />
      ) : (
        <div
          className="sheet-thumb-ph"
          style={{ background: tintHex ?? "#e5e7eb" }}
          aria-hidden
        />
      )}
    </div>
  );
}

function CheckoffSheetRow({
  part,
  busy,
  compact,
  onToggleUnit,
}: {
  part: CheckoffPart;
  busy: boolean;
  compact: boolean;
  onToggleUnit: (part: CheckoffPart, unitIndex: number) => void;
}) {
  const done = part.printed_count >= part.quantity_effective && part.quantity_effective > 0;
  return (
    <tr className={cn("sheet-row", done && "sheet-row-done")}>
      <td className="sheet-cell-part">
        <div className="sheet-part">
          <CheckoffPartThumb partId={part.id} tintHex={part.filament_hex} compact={compact} />
          <div className="sheet-part-meta">
            <span className="sheet-filename" title={part.relative_path || part.filename}>
              {part.filename}
            </span>
            <span className="sheet-part-tags">
              {part.filament_hex && (
                <span className="sheet-swatch" style={{ background: part.filament_hex }} />
              )}
              {part.filament_display && <span>{part.filament_display}</span>}
              {part.role && <span className="sheet-role">{part.role}</span>}
            </span>
          </div>
        </div>
      </td>
      <td className="sheet-cell-qty">{part.quantity_effective}</td>
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
  const { health } = useEngineHealth();
  const { selectedProfileId, profiles } = useProfileSelection();
  const { busy, message, runJob } = useJobRunner("export");
  const planName =
    profiles.find((p) => p.id === selectedProfileId)?.name ?? "Checkoff";
  const persistedUi = useMemo(() => loadPersistedCheckoffUi(), []);
  const [parts, setParts] = useState<CheckoffPart[]>([]);
  const [summary, setSummary] = useState("");
  const [filter, setFilter] = useState<CheckoffFilterMode>(persistedUi.filter);
  const [search, setSearch] = useState("");
  const [compactMode, setCompactMode] = useState(persistedUi.compactMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenRef = useRef(0);
  const engineReady = Boolean(health?.ok);

  const loadCheckoff = useCallback(async (profileId: number) => {
    const gen = ++loadGenRef.current;
    setLoadError(null);
    try {
      const data = await fetchCheckoff(profileId);
      if (gen !== loadGenRef.current) return;
      setParts(data.parts);
      setSummary(data.summary || formatCheckoffSummary(data.parts));
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!engineReady || selectedProfileId == null) return;
    void loadCheckoff(selectedProfileId);
  }, [engineReady, selectedProfileId, loadCheckoff]);

  useEffect(() => {
    savePersistedCheckoffUi({ filter, compactMode });
  }, [filter, compactMode]);

  const filtered = useMemo(() => {
    let rows = parts;
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
  }, [parts, filter, search]);

  const grouped = useMemo(() => groupCheckoffParts(filtered), [filtered]);

  const missingCount = useMemo(() => parts.filter((p) => p.missing).length, [parts]);

  const applyPartProgress = useCallback((partId: number, printUnits: boolean[], missing: boolean) => {
    setParts((prev) => {
      const nextParts = prev.map((p) =>
        p.id === partId
          ? {
              ...p,
              print_units: printUnits,
              printed_count: printedCountFromUnits(printUnits),
              missing,
            }
          : p,
      );
      setSummary(formatCheckoffSummary(nextParts));
      return nextParts;
    });
  }, []);

  const toggleUnit = useCallback(
    async (part: CheckoffPart, unitIndex: number) => {
      if (unitIndex < 0 || unitIndex >= part.print_units.length) return;
      loadGenRef.current += 1;
      const next = !part.print_units[unitIndex];
      const optimisticUnits = applyStackToggle(part.print_units, unitIndex, next);
      const optimisticMissing = !isPartFullyPrinted({
        quantity_effective: part.quantity_effective,
        printed_count: printedCountFromUnits(optimisticUnits),
        missing: true,
      });
      applyPartProgress(part.id, optimisticUnits, optimisticMissing);
      try {
        const updated = await patchPartProgress(part.id, unitIndex, next);
        applyPartProgress(part.id, updated.print_units, updated.missing);
        toast.success(next ? "Marked printed" : "Marked not printed");
      } catch (e) {
        if (selectedProfileId != null) void loadCheckoff(selectedProfileId);
        setLoadError(e instanceof Error ? e.message : String(e));
        toast.error("Could not save print progress");
      }
    },
    [applyPartProgress, loadCheckoff, selectedProfileId],
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
        if (selectedProfileId != null) void loadCheckoff(selectedProfileId);
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
    if (parts.length === 0) {
      return (
        <EmptyState
          icon={ClipboardCheck}
          title="No parts yet"
          description="Update build on the Build page to load parts into checkoff."
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
        description="Track what you've printed on the shop floor."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.print()}
              disabled={selectedProfileId == null || parts.length === 0}
            >
              <Printer className="mr-1 h-4 w-4" />
              Print
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onExportChecklist}
              disabled={selectedProfileId == null || busy}
            >
              Export checklist
            </Button>
            <Button
              size="sm"
              onClick={onExportMissing}
              disabled={selectedProfileId == null || busy || missingCount === 0}
            >
              Export missing STLs
            </Button>
          </>
        }
      />

      <p className="text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">Export checklist</strong> downloads a
        printable HTML; <strong className="font-medium text-foreground">Export missing STLs</strong>{" "}
        downloads a ZIP of every still-unprinted unit, organized by role and folder.
      </p>

      <div className="checkoff-sticky no-print flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <input
          type="search"
          className="checkoff-search min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          placeholder="Search parts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={busy}
        />
        <div className="filter-group" role="group" aria-label="Filter">
          {(["all", "missing", "done"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={filter === mode ? "secondary" : "ghost"}
              onClick={() => setFilter(mode)}
              disabled={busy}
            >
              {mode === "all" ? "All" : mode === "missing" ? "Missing" : "Done"}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(e) => setCompactMode(e.target.checked)}
          />
          Compact rows
        </label>
      </div>

      <div className="no-print">
        {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      </div>

      {selectedProfileId == null || parts.length === 0 || filtered.length === 0 ? (
        renderEmpty()
      ) : (
        <article className={cn("checkoff-sheet", compactMode && "compact")}>
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
                          busy={busy}
                          compact={compactMode}
                          onToggleUnit={toggleUnit}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
