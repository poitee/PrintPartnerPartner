import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanReview, ReviewPart, RoleFilamentRow, SpoolmanSpoolRow } from "../../api/engine";
import { fetchRoleFilaments, fetchSpoolmanSpools } from "../../api/engine";
import { usePlanWorkspace } from "../../context/PlanWorkspaceContext";
import { useSpoolmanEnabled } from "../../hooks/useSpoolmanEnabled";
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
} from "../../lib/persistedReviewPartsUi";
import { useProfileSelection } from "../../context/ProfileContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import PartPreviewDialog from "../parts/PartPreviewDialog";
import PartThumbExpandButton from "../parts/PartThumbExpandButton";
import FilterSelect, { filterSelectOut, filterSelectValue } from "./FilterSelect";
import PartSpoolPicker from "../PartSpoolPicker";
import SpoolRemainingBadge from "../SpoolRemainingBadge";
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
          className="qty-input"
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
  busy,
  compact,
  spoolmanConfigured,
  roleFilaments,
  spools,
  spoolsLoading,
  onQtyChange,
  onRemove,
  onRestore,
  onSpoolChange,
  onPreview,
}: {
  part: ReviewPart;
  busy: boolean;
  compact: boolean;
  spoolmanConfigured: boolean;
  roleFilaments: RoleFilamentRow[];
  spools: SpoolmanSpoolRow[];
  spoolsLoading?: boolean;
  onQtyChange: (part: ReviewPart, qty: number) => void;
  onRemove: (part: ReviewPart) => void;
  onRestore: (part: ReviewPart) => void;
  onSpoolChange: (partId: number, spoolman_spool_id: string | null) => void;
  onPreview: (part: ReviewPart) => void;
}) {
  return (
    <tr className={cn("sheet-row", !part.included && "opacity-70")}>
      <td className="sheet-cell-part">
        <div className="sheet-part">
          <PartThumbExpandButton part={part} compact={compact} onExpand={onPreview} />
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
              {!part.included && <span className="sheet-role">excluded</span>}
            </span>
          </div>
        </div>
      </td>
      {spoolmanConfigured && (
        <td className="sheet-cell-spool">
          <PartSpoolPicker
            part={part}
            roleFilaments={roleFilaments}
            spools={spools}
            spoolsLoading={spoolsLoading}
            disabled={busy || !part.included}
            hideLabel
            onChange={onSpoolChange}
          />
        </td>
      )}
      <td className="sheet-cell-qty">
        <QuantityStepper
          part={part}
          disabled={busy || !part.included}
          onChange={(n) => onQtyChange(part, n)}
        />
      </td>
      <td className="sheet-cell-actions">
        {part.included ? (
          <Button
            type="button"
            variant="sheetRemove"
            size="sm"
            className="sheet-remove-btn"
            disabled={busy}
            onClick={() => onRemove(part)}
          >
            Remove
          </Button>
        ) : (
          <Button
            type="button"
            variant="sheetRestore"
            size="sm"
            className="sheet-restore-btn"
            disabled={busy}
            onClick={() => onRestore(part)}
          >
            Restore
          </Button>
        )}
      </td>
      <td className="sheet-cell-notes" aria-hidden />
    </tr>
  );
}

export default function ReviewPartsSheet({ review, planName, disabled }: Props) {
  const { profiles } = useProfileSelection();
  const { setQuantity, setIncluded, setSpoolmanSpool, reload, busyPartId, loadedRevision } =
    usePlanWorkspace();
  const { configured: spoolmanConfigured, integrationId } = useSpoolmanEnabled();
  const [roleFilaments, setRoleFilaments] = useState<RoleFilamentRow[]>([]);
  const [spools, setSpools] = useState<SpoolmanSpoolRow[]>([]);
  const [spoolsLoading, setSpoolsLoading] = useState(false);
  const persisted = useMemo(() => loadPersistedReviewPartsUi(), []);
  const [ui, setUi] = useState<PersistedReviewPartsUi>(persisted);
  const [removeTarget, setRemoveTarget] = useState<ReviewPart | null>(null);
  const [previewPart, setPreviewPart] = useState<ReviewPart | null>(null);
  const isMobileLayout = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    savePersistedReviewPartsUi(ui);
  }, [ui]);

  useEffect(() => {
    if (!spoolmanConfigured || !integrationId) {
      setRoleFilaments([]);
      setSpools([]);
      setSpoolsLoading(false);
      return;
    }
    let cancelled = false;
    setSpoolsLoading(true);
    void (async () => {
      try {
        const [roles, spoolRows] = await Promise.all([
          fetchRoleFilaments(review.profile_id),
          fetchSpoolmanSpools(integrationId),
        ]);
        if (!cancelled) {
          setRoleFilaments(roles);
          setSpools(spoolRows);
        }
      } catch {
        if (!cancelled) {
          setRoleFilaments([]);
          setSpools([]);
        }
      } finally {
        if (!cancelled) setSpoolsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spoolmanConfigured, integrationId, review.profile_id, loadedRevision]);

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
    void setQuantity(part.id, next);
  };

  const onRemove = (part: ReviewPart) => setRemoveTarget(part);

  const confirmRemove = () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    void setIncluded(target.id, false);
  };

  const onRestore = (part: ReviewPart) => {
    void setIncluded(part.id, true);
  };

  const onSpoolChange = (partId: number, spoolman_spool_id: string | null) => {
    void setSpoolmanSpool(partId, spoolman_spool_id);
  };

  const displayName = planName || profiles.find((p) => p.id === review.profile_id)?.name || "Review";

  return (
    <section className="space-y-3">
      <div className="no-print checkoff-sticky flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold">Parts</h3>
        {spoolmanConfigured && (
          <p className="text-xs text-muted-foreground">
            Spool column: optional override per part
          </p>
        )}

        <input
          type="search"
          className="checkoff-search w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Search parts…"
          value={ui.search}
          onChange={(e) => patchUi({ search: e.target.value })}
          disabled={disabled}
        />

        <div className="flex flex-wrap gap-2">
          <FilterSelect
            aria-label="Print status"
            value={ui.printFilter}
            onValueChange={(v) =>
              patchUi({ printFilter: v as PersistedReviewPartsUi["printFilter"] })
            }
            options={[
              { value: "all", label: "Print: all" },
              { value: "missing", label: "Missing" },
              { value: "partial", label: "Partial" },
              { value: "complete", label: "Complete" },
            ]}
            disabled={disabled}
          />
          <FilterSelect
            aria-label="Included filter"
            value={ui.includedFilter}
            onValueChange={(v) =>
              patchUi({ includedFilter: v as PersistedReviewPartsUi["includedFilter"] })
            }
            options={[
              { value: "included", label: "Included only" },
              { value: "excluded", label: "Excluded only" },
              { value: "all", label: "All parts" },
            ]}
            disabled={disabled}
          />
          <FilterSelect
            aria-label="Source layer"
            value={filterSelectOut(ui.sourceLayer)}
            onValueChange={(v) => patchUi({ sourceLayer: filterSelectValue(v) || null })}
            options={[
              { value: "__empty", label: "All sources" },
              ...facets.sourceLayers.map((layer) => ({
                value: layer,
                label: sourceLabelFromLayer(layer),
              })),
            ]}
            disabled={disabled}
          />
          <FilterSelect
            aria-label="Folder"
            value={filterSelectOut(ui.folder)}
            onValueChange={(v) => patchUi({ folder: filterSelectValue(v) || null })}
            options={[
              { value: "__empty", label: "All folders" },
              ...facets.folders.map((f) => ({ value: f, label: f })),
            ]}
            disabled={disabled}
          />
          <FilterSelect
            aria-label="Role"
            value={filterSelectOut(ui.role)}
            onValueChange={(v) => patchUi({ role: filterSelectValue(v) || null })}
            options={[
              { value: "__empty", label: "All roles" },
              ...facets.roles.map((r) => ({ value: r, label: r })),
            ]}
            disabled={disabled}
          />
          <FilterSelect
            aria-label="Filament"
            value={filterSelectOut(ui.filament)}
            onValueChange={(v) => patchUi({ filament: filterSelectValue(v) || null })}
            options={[
              { value: "__empty", label: "All filaments" },
              ...facets.filaments.map((f) => ({ value: f, label: f })),
            ]}
            disabled={disabled}
          />
          <FilterSelect
            aria-label="Sort"
            value={ui.sort}
            onValueChange={(v) => patchUi({ sort: v as PersistedReviewPartsUi["sort"] })}
            options={[
              { value: "folder", label: "Sort: folder" },
              { value: "filename", label: "Sort: filename" },
              { value: "qty", label: "Sort: quantity" },
            ]}
            disabled={disabled}
          />
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
                          busy={busyPartId === part.id || Boolean(disabled)}
                          spoolmanConfigured={spoolmanConfigured}
                          roleFilaments={roleFilaments}
                          spools={spools}
                          spoolsLoading={spoolsLoading}
                          onQtyChange={onQtyChange}
                          onRemove={() => onRemove(part)}
                          onRestore={() => onRestore(part)}
                          onSpoolChange={onSpoolChange}
                          onPreview={setPreviewPart}
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
                          {spoolmanConfigured && <th className="sheet-cell-spool">Spool</th>}
                          <th className="sheet-cell-qty">Qty</th>
                          <th className="sheet-cell-actions">Actions</th>
                          <th className="sheet-cell-notes">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.parts.map((part) => (
                          <ReviewSheetRow
                            key={part.id}
                            part={part}
                            busy={busyPartId === part.id || Boolean(disabled)}
                            compact={isMobileLayout || ui.compactMode}
                            spoolmanConfigured={spoolmanConfigured}
                            roleFilaments={roleFilaments}
                            spools={spools}
                            spoolsLoading={spoolsLoading}
                            onQtyChange={onQtyChange}
                            onRemove={onRemove}
                            onRestore={onRestore}
                            onSpoolChange={onSpoolChange}
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

      <PartPreviewDialog part={previewPart} onClose={() => setPreviewPart(null)} />
    </section>
  );
}
