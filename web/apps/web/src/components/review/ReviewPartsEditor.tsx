import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { patchPart, type PartRow, type PlanReview } from "../../api/engine";
import { cn } from "../../lib/utils";
import Preview3D from "../Preview3D";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  flattenReviewParts,
  mergePartIntoReview,
  partitionIncludedParts,
  sourceLabelFromLayer,
} from "../../lib/reviewParts";
import ReviewMobilePartCard from "./ReviewMobilePartCard";
import { useMediaQuery } from "../../hooks/useMediaQuery";

type Props = {
  review: PlanReview;
  disabled?: boolean;
  onReviewUpdated: (next: PlanReview) => void;
  onReload: () => Promise<void>;
};

function roleBadgeVariant(role: string | null): "default" | "muted" {
  return role === "accent" ? "muted" : "default";
}

type ReviewSortKey = "repo" | "filename";

function sortIncludedParts(parts: PartRow[], sortBy: ReviewSortKey): PartRow[] {
  const byName = (a: PartRow, b: PartRow) =>
    a.filename.localeCompare(b.filename, undefined, { sensitivity: "base", numeric: true });
  if (sortBy === "filename") {
    return [...parts].sort(byName);
  }
  return [...parts].sort((a, b) => {
    const repoCmp = sourceLabelFromLayer(a.source_layer).localeCompare(
      sourceLabelFromLayer(b.source_layer),
      undefined,
      { sensitivity: "base" },
    );
    return repoCmp !== 0 ? repoCmp : byName(a, b);
  });
}

function QuantityStepper({
  part,
  disabled,
  onChange,
}: {
  part: PartRow;
  disabled?: boolean;
  onChange: (qty: number) => void;
}) {
  const qty = part.quantity_override ?? part.quantity_effective;
  return (
    <div className="qty-control">
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
      {part.quantity_override == null && part.quantity_auto !== qty && (
        <span className="qty-meta text-xs text-muted-foreground">auto {part.quantity_auto}</span>
      )}
    </div>
  );
}

export default function ReviewPartsEditor({
  review,
  disabled,
  onReviewUpdated,
  onReload,
}: Props) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PartRow | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);

  const [sortBy, setSortBy] = useState<ReviewSortKey>("repo");
  const isMobileLayout = useMediaQuery("(max-width: 767px)");

  const allParts = useMemo(
    () => flattenReviewParts(review.part_groups),
    [review.part_groups],
  );
  const { included } = useMemo(() => {
    const { included: inc } = partitionIncludedParts(allParts);
    return { included: sortIncludedParts(inc, sortBy) };
  }, [allParts, sortBy]);

  const selectedPart = useMemo(
    () => included.find((p) => p.id === selectedPartId) ?? null,
    [included, selectedPartId],
  );
  const previewMeshColor = selectedPart?.filament_hex ?? undefined;

  useEffect(() => {
    if (included.length === 0) {
      setSelectedPartId(null);
      return;
    }
    if (selectedPartId == null || !included.some((p) => p.id === selectedPartId)) {
      setSelectedPartId(included[0].id);
    }
  }, [included, selectedPartId]);

  const applyPatch = async (
    part: PartRow,
    fields: { included?: boolean; quantity_override?: number },
    successMessage?: string,
  ) => {
    setBusyId(part.id);
    try {
      const updated = await patchPart(part.id, fields);
      onReviewUpdated(mergePartIntoReview(review, updated));
      await onReload();
      if (successMessage) toast.success(successMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onQtyChange = (part: PartRow, next: number) => {
    const clamped = Math.max(1, Math.floor(next));
    if (clamped === (part.quantity_override ?? part.quantity_effective)) return;
    void applyPatch(part, { quantity_override: clamped });
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    await applyPatch(target, { included: false }, `Removed ${target.filename}`);
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Parts in build</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ReviewSortKey)}
              aria-label="Sort parts"
            >
              <option value="repo">Repo</option>
              <option value="filename">Filename</option>
            </select>
          </label>
          <span className="text-xs text-muted-foreground">{included.length} included</span>
        </div>
      </div>

      {included.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No parts included yet. Go back to Build to include parts from your sources.
        </p>
      ) : isMobileLayout ? (
        <div className="review-mobile-list space-y-2">
          {included.map((part) => (
            <ReviewMobilePartCard
              key={part.id}
              part={part}
              selected={selectedPartId === part.id}
              disabled={disabled}
              busy={busyId === part.id}
              onSelect={() => setSelectedPartId(part.id)}
              onQtyChange={(n) => onQtyChange(part, n)}
              onRemove={() => setRemoveTarget(part)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => setSortBy("filename")}
                    >
                      Part {sortBy === "filename" && "▲"}
                    </button>
                  </th>
                  <th className="pb-2 pr-3 font-medium">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => setSortBy("repo")}
                    >
                      Source {sortBy === "repo" && "▲"}
                    </button>
                  </th>
                  <th className="pb-2 pr-3 font-medium">Role</th>
                  <th className="pb-2 pr-3 font-medium">Qty</th>
                  <th className="pb-2 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {included.map((part) => (
                  <tr
                    key={part.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "cursor-pointer border-b border-border/60 last:border-0 transition-colors",
                      selectedPartId === part.id
                        ? "bg-primary/5 outline outline-1 -outline-offset-1 outline-primary/40"
                        : "hover:bg-muted/40",
                    )}
                    onClick={() => setSelectedPartId(part.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedPartId(part.id);
                      }
                    }}
                  >
                    <td className="py-2 pr-3 max-w-[200px]">
                      <span className="truncate block" title={part.relative_path || part.filename}>
                        {part.filename}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {sourceLabelFromLayer(part.source_layer)}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={roleBadgeVariant(part.role)}>
                        {part.role || "primary"}
                      </Badge>
                    </td>
                    <td
                      className="py-2 pr-3"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <QuantityStepper
                        part={part}
                        disabled={disabled || busyId === part.id}
                        onChange={(n) => onQtyChange(part, n)}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled || busyId === part.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRemoveTarget(part);
                        }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="rounded-md border border-border bg-muted/20 p-3 lg:sticky lg:top-4 lg:self-start">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">STL preview</h4>
            <Preview3D
              key={
                selectedPart
                  ? `${selectedPart.id}-${selectedPart.filament_hex ?? "unset"}`
                  : "none"
              }
              partId={selectedPart?.id ?? null}
              filename={selectedPart?.filename}
              meshColor={previewMeshColor}
              className="min-h-[220px]"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Click a part row to preview. Drag to rotate.
            </p>
          </aside>
        </div>
      )}

      <Dialog open={removeTarget != null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove from build?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {removeTarget
              ? `Exclude “${removeTarget.filename}” from this plan? You can add it again later.`
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              disabled={busyId != null}
              onClick={() => void confirmRemove()}
            >
              {busyId != null ? "Saving…" : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
