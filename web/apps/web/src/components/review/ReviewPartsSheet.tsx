import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { PlanReview, ReviewPart } from "../../api/engine";
import { usePlanWorkspace } from "../../context/PlanWorkspaceContext";
import { groupCheckoffParts } from "../../lib/checkoffGroups";
import { formatCheckoffSummary } from "../../lib/checkoffProgress";
import {
  collectReviewFacets,
  filterReviewParts,
} from "../../lib/reviewPartsFilter";
import {
  flattenReviewParts,
  sourceLabelFromLayer,
} from "../../lib/reviewParts";
import {
  loadPersistedReviewPartsUi,
  savePersistedReviewPartsUi,
  type PersistedReviewPartsUi,
  type ReviewViewMode,
} from "../../lib/persistedReviewPartsUi";
import { useProfileSelection } from "../../context/ProfileContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import PartThumb from "../parts/PartThumb";
import ReviewSheetMobileCard from "./ReviewSheetMobileCard";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../../lib/utils";

type Props = {
  review: PlanReview;
  planName: string;
  disabled?: boolean;
};

function QuantityStepper({
  part,
  disabled,
  onChange,
}: {
  part: ReviewPart;
  disabled?: boolean;
  onChange: (qty: number) => void;
}) {
  const qty = part.quantity_override ?? part.quantity_effective;
  const belowPrinted = part.printed_count > qty;
  return (
    <div className="qty-control flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="qty-btn"
          disabled={disabled || qty <= 1}
          onClick={() => onChange(qty - 1)}
          aria-label={`Decrease quantity for ${part.filename}`}
        >
          −
        </button>
        <input
          type="number"
          className="qty-input rounded-md border border-input bg-background w-12 text-center text-sm"
          min={1}
          value={qty}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          aria-label={`Quantity for ${part.filename}`}
        />
        <button
          type="button"
          className="qty-btn"
          disabled={disabled}
          onClick={() => onChange(qty + 1)}
          aria-label={`Increase quantity for ${part.filename}`}
        >
          +
        </button>
      </div>
      {belowPrinted && (
        <span className="text-xs text-amber-600">
          {part.printed_count} unit{part.printed_count === 1 ? "" : "s"} already printed
        </span>
      )}
    </div>
  );
}

function ReviewSheetRow({
  part,
  viewMode,
  busy,
  compact,
  onToggleUnit,
  onQtyChange,
  onRemove,
  onRestore,
}: {
  part: ReviewPart;
  viewMode: ReviewViewMode;
  busy: boolean;
  compact: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
  onQtyChange: (part: ReviewPart, qty: number) => void;
  onRemove: (part: ReviewPart) => void;
  onRestore: (part: ReviewPart) => void;
}) {
  const done =
    part.printed_count >= part.quantity_effective && part.quantity_effective > 0;
  const edit = viewMode === "edit";

  return (
    <tr
      className={cn(
        "sheet-row",
        done && viewMode === "print" && "sheet-row-done",
        !part.included && "opacity-70",
      )}
    >
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
              {part.role && <span className="sheet-role">{part.role}</span>}
              {!part.included && <span className="sheet-role">excluded</span>}
            </span>
          </div>
        </div>
      </td>
      <td className="sheet-cell-qty">
        {edit ? (
          <QuantityStepper
            part={part}
            disabled={busy || !part.included}
            onChange={(n) => onQtyChange(part, n)}
          />
        ) : (
          part.quantity_effective
        )}
      </td>
      {edit ? (
        <td className="sheet-cell-actions">
          {part.included ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onRemove(part)}
            >
              Remove
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onRestore(part)}
            >
              Restore
            </Button>
          )}
        </td>
      ) : (
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
                  disabled={busy || !part.included}
                />
                <span>{idx + 1}</span>
              </label>
            ))}
            <span className={cn("sheet-printed-count", done && "sheet-printed-done")}>
              {part.printed_count}/{part.quantity_effective}
            </span>
          </div>
        </td>
      )}
      <td className="sheet-cell-notes" aria-hidden />
    </tr>
  );
}

export default function ReviewPartsSheet({ review, planName, disabled }: Props) {
  const { profiles } = useProfileSelection();
  const { setQuantity, setIncluded, toggleUnit, reload, busyPartId } = usePlanWorkspace();
  const persisted = useMemo(() => loadPersistedReviewPartsUi(), []);
  const [ui, setUi] = useState<PersistedReviewPartsUi>(persisted);
  const [removeTarget, setRemoveTarget] = useState<ReviewPart | null>(null);
  const isMobileLayout = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    savePersistedReviewPartsUi(ui);
  }, [ui]);

  const allParts = useMemo(() => flattenReviewParts(review.part_groups), [review.part_groups]);

  const facets = useMemo(() => collectReviewFacets(allParts), [allParts]);

  const filtered = useMemo(
    () => filterReviewParts(allParts, review, ui),
    [allParts, review, ui],
  );

  const grouped = useMemo(() => groupCheckoffParts(filtered), [filtered]);

  const summary = useMemo(
    () => formatCheckoffSummary(allParts.filter((p) => p.included)),
    [allParts],
  );

  const needsExcluded = ui.includedFilter !== "included";
  useEffect(() => {
    if (!needsExcluded || !review.profile_id) return;
    void reload(review.profile_id, { includeExcluded: true });
  }, [needsExcluded, review.profile_id, reload]);

  const patchUi = useCallback((patch: Partial<PersistedReviewPartsUi>) => {
    setUi((prev) => ({ ...prev, ...patch }));
  }, []);

  const onQtyChange = (part: ReviewPart, next: number) => {
    void setQuantity(part.id, next).then(() => toast.success("Quantity updated"));
  };

  const onRemove = (part: ReviewPart) => setRemoveTarget(part);

  const confirmRemove = () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    void setIncluded(target.id, false).then(() =>
      toast.success(`Removed ${target.filename}`),
    );
  };

  const onRestore = (part: ReviewPart) => {
    void setIncluded(part.id, true).then(() => toast.success(`Restored ${part.filename}`));
  };

  const onToggleUnit = (part: ReviewPart, unitIndex: number) => {
    const next = !part.print_units[unitIndex];
    void toggleUnit(part.id, unitIndex, next);
  };

  const displayName = planName || profiles.find((p) => p.id === review.profile_id)?.name || "Review";

  return (
    <section className="space-y-3">
      <div className="no-print checkoff-sticky flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold flex-1">Parts</h3>
          <div className="flex rounded-md border border-input p-0.5" role="group" aria-label="View mode">
            {(["edit", "print"] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={ui.viewMode === mode ? "secondary" : "ghost"}
                className="min-h-8 capitalize"
                onClick={() => patchUi({ viewMode: mode })}
              >
                {mode}
              </Button>
            ))}
          </div>
        </div>

        <input
          type="search"
          className="checkoff-search w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Search parts…"
          value={ui.search}
          onChange={(e) => patchUi({ search: e.target.value })}
          disabled={disabled}
        />

        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            value={ui.printFilter}
            onChange={(e) =>
              patchUi({ printFilter: e.target.value as PersistedReviewPartsUi["printFilter"] })
            }
            aria-label="Print status"
          >
            <option value="all">Print: all</option>
            <option value="missing">Missing</option>
            <option value="partial">Partial</option>
            <option value="complete">Complete</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            value={ui.includedFilter}
            onChange={(e) =>
              patchUi({
                includedFilter: e.target.value as PersistedReviewPartsUi["includedFilter"],
              })
            }
            aria-label="Included filter"
          >
            <option value="included">Included only</option>
            <option value="excluded">Excluded only</option>
            <option value="all">All parts</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs max-w-[10rem]"
            value={ui.sourceLayer ?? ""}
            onChange={(e) => patchUi({ sourceLayer: e.target.value || null })}
            aria-label="Source layer"
          >
            <option value="">All sources</option>
            {facets.sourceLayers.map((layer) => (
              <option key={layer} value={layer}>
                {sourceLabelFromLayer(layer)}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs max-w-[10rem]"
            value={ui.folder ?? ""}
            onChange={(e) => patchUi({ folder: e.target.value || null })}
            aria-label="Folder"
          >
            <option value="">All folders</option>
            {facets.folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            value={ui.role ?? ""}
            onChange={(e) => patchUi({ role: e.target.value || null })}
            aria-label="Role"
          >
            <option value="">All roles</option>
            {facets.roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs max-w-[10rem]"
            value={ui.filament ?? ""}
            onChange={(e) => patchUi({ filament: e.target.value || null })}
            aria-label="Filament"
          >
            <option value="">All filaments</option>
            {facets.filaments.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            value={ui.sort}
            onChange={(e) => patchUi({ sort: e.target.value as PersistedReviewPartsUi["sort"] })}
            aria-label="Sort"
          >
            <option value="folder">Sort: folder</option>
            <option value="filename">Sort: filename</option>
            <option value="qty">Sort: quantity</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={ui.issuesOnly}
              onChange={(e) => patchUi({ issuesOnly: e.target.checked })}
            />
            Issues only
          </label>
          {!isMobileLayout && (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={ui.compactMode}
                onChange={(e) => patchUi({ compactMode: e.target.checked })}
              />
              Compact rows
            </label>
          )}
          <span className="text-muted-foreground">{summary}</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parts match the current filters.</p>
      ) : (
        <article
          className={cn(
            "checkoff-sheet",
            ui.compactMode && !isMobileLayout && "compact",
            isMobileLayout && "checkoff-sheet-mobile",
          )}
        >
          <header className="sheet-header">
            <h2 className="sheet-title">{displayName}</h2>
            <p className="sheet-subtitle">
              {filtered.length} part{filtered.length === 1 ? "" : "s"} · {summary}
            </p>
          </header>

          {grouped.map((repo) => (
            <section key={repo.repoLayer} className="sheet-repo">
              <h3 className="sheet-repo-title">
                {repo.repoLabel}
                <span className="sheet-repo-count">{repo.partCount}</span>
              </h3>
              {repo.folders.map((group) => (
                <div key={group.folder} className="sheet-folder">
                  <h4 className="sheet-folder-title">{group.folder}</h4>
                  {isMobileLayout && (
                    <div className="checkoff-mobile-list no-print">
                      {group.parts.map((part) => (
                        <ReviewSheetMobileCard
                          key={part.id}
                          part={part}
                          viewMode={ui.viewMode}
                          busy={busyPartId === part.id || Boolean(disabled)}
                          onToggleUnit={onToggleUnit}
                          onQtyChange={onQtyChange}
                          onRemove={() => onRemove(part)}
                          onRestore={() => onRestore(part)}
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
                          {ui.viewMode === "edit" ? (
                            <th className="sheet-cell-actions">Actions</th>
                          ) : (
                            <th className="sheet-cell-printed">Printed</th>
                          )}
                          <th className="sheet-cell-notes">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.parts.map((part) => (
                          <ReviewSheetRow
                            key={part.id}
                            part={part}
                            viewMode={ui.viewMode}
                            busy={busyPartId === part.id || Boolean(disabled)}
                            compact={isMobileLayout || ui.compactMode}
                            onToggleUnit={onToggleUnit}
                            onQtyChange={onQtyChange}
                            onRemove={onRemove}
                            onRestore={onRestore}
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

      <Dialog open={removeTarget != null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove from build?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {removeTarget
              ? `Exclude “${removeTarget.filename}” from this plan? Use the Included filter to restore it later.`
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="ghost" disabled={busyPartId != null} onClick={() => void confirmRemove()}>
              {busyPartId != null ? "Saving…" : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
