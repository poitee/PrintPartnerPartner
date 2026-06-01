import { useEffect, useMemo, useState } from "react";
import {
  patchPart,
  partThumbnailUrl,
  type CatalogColor,
  type FilamentCatalog,
  type PartRow,
} from "../api/engine";
import { cn } from "../lib/utils";
import FilamentSwatch from "./FilamentSwatch";

type Props = {
  part: PartRow;
  catalog: FilamentCatalog | null;
  disabled?: boolean;
  onUpdated: () => void;
  onSelect?: (partId: number) => void;
  onIncludedChange?: (included: boolean) => void;
  onError: (message: string) => void;
};

function PartThumb({ partId, className }: { partId: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void partThumbnailUrl(partId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [partId]);
  if (!src) {
    return (
      <span
        className={cn("inline-block h-8 w-8 shrink-0 rounded-md bg-muted", className)}
        aria-hidden
      />
    );
  }
  return (
    <img
      className={cn("h-8 w-8 shrink-0 rounded-md object-contain bg-muted", className)}
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function allColors(catalog: FilamentCatalog | null): CatalogColor[] {
  if (!catalog) return [];
  return [...catalog.colors, ...catalog.custom_colors];
}

export default function PartFilamentRow({
  part,
  catalog,
  disabled,
  onUpdated,
  onSelect,
  onIncludedChange,
  onError,
}: Props) {
  const colors = useMemo(() => allColors(catalog), [catalog]);
  const qty = part.quantity_override ?? part.quantity_effective;
  const autoQty = part.quantity_auto;

  const onFilamentChange = async (value: string) => {
    try {
      await patchPart(part.id, { filament_color_id: value });
      onUpdated();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const onQtyChange = async (next: number) => {
    const clamped = Math.max(1, next);
    try {
      await patchPart(part.id, { quantity_override: clamped });
      onUpdated();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0">
      {onIncludedChange && (
        <input
          type="checkbox"
          checked={part.included}
          disabled={disabled}
          onChange={(e) => onIncludedChange(e.target.checked)}
          aria-label={`Include ${part.filename}`}
        />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:text-primary"
        onClick={() => onSelect?.(part.id)}
      >
        <PartThumb partId={part.id} className="h-8 w-8" />
        {part.filament_hex && (
          <FilamentSwatch hex={part.filament_hex} label={part.filament_display} />
        )}
        <span className="truncate">{part.filename}</span>
      </button>
      <select
        className="filament-select rounded-md border border-input bg-background px-2 py-1 text-sm"
        value={part.filament_color_id ?? ""}
        disabled={disabled || !catalog}
        onChange={(e) => void onFilamentChange(e.target.value)}
        aria-label={`Filament for ${part.filename}`}
      >
        <option value="">— filament —</option>
        {colors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.combo_label || c.display_name}
          </option>
        ))}
      </select>
      <div className="qty-control">
        <span className="qty-label">Qty</span>
        <button
          type="button"
          className="qty-btn"
          disabled={disabled || qty <= 1}
          onClick={() => void onQtyChange(qty - 1)}
          aria-label="Decrease quantity"
        >
          −
        </button>
        <input
          type="number"
          className="qty-input rounded-md border border-input bg-background"
          min={1}
          value={qty}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) void onQtyChange(n);
          }}
          aria-label={`Quantity for ${part.filename}`}
        />
        <button
          type="button"
          className="qty-btn"
          disabled={disabled}
          onClick={() => void onQtyChange(qty + 1)}
          aria-label="Increase quantity"
        >
          +
        </button>
        {part.quantity_override == null && autoQty !== qty && (
          <span className="qty-meta muted">auto {autoQty}</span>
        )}
      </div>
    </li>
  );
}
