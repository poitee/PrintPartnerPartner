import type { ReviewPart, RoleFilamentRow, SpoolmanSpoolRow } from "../../api/engine";
import PartThumbExpandButton from "../parts/PartThumbExpandButton";
import PartSpoolPicker from "../PartSpoolPicker";
import SpoolRemainingBadge from "../SpoolRemainingBadge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  part: ReviewPart;
  busy: boolean;
  spoolmanConfigured?: boolean;
  roleFilaments?: RoleFilamentRow[];
  spools?: SpoolmanSpoolRow[];
  spoolsLoading?: boolean;
  onQtyChange: (part: ReviewPart, qty: number) => void;
  onRemove: () => void;
  onRestore: () => void;
  onSpoolChange?: (partId: number, spoolman_spool_id: string | null) => void;
  onPreview: (part: ReviewPart) => void;
};

function MobileQtyStepper({
  part,
  disabled,
  onChange,
}: {
  part: ReviewPart;
  disabled?: boolean;
  onChange: (qty: number) => void;
}) {
  const qty = part.quantity_override ?? part.quantity_effective;
  return (
    <div className="qty-control flex items-center gap-1">
      <button
        type="button"
        className="qty-btn rounded-md border min-h-10 min-w-10"
        disabled={disabled || qty <= 1}
        onClick={() => onChange(qty - 1)}
        aria-label={`Decrease quantity for ${part.filename}`}
      >
        −
      </button>
      <span className="qty-display min-w-[2.5ch] text-center text-base font-semibold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        className="qty-btn rounded-md border min-h-10 min-w-10"
        disabled={disabled}
        onClick={() => onChange(qty + 1)}
        aria-label={`Increase quantity for ${part.filename}`}
      >
        +
      </button>
    </div>
  );
}

export default function ReviewSheetMobileCard({
  part,
  busy,
  spoolmanConfigured,
  roleFilaments = [],
  spools = [],
  spoolsLoading,
  onQtyChange,
  onRemove,
  onRestore,
  onSpoolChange,
  onPreview,
}: Props) {
  return (
    <article className={cn("checkoff-mobile-card", !part.included && "opacity-80")}>
      <div className="checkoff-mobile-card-head">
        <PartThumbExpandButton part={part} sizePx={72} onExpand={onPreview} />
        <div className="checkoff-mobile-card-meta">
          <h4 className="checkoff-mobile-filename" title={part.relative_path || part.filename}>
            {part.filename}
          </h4>
          <p className="checkoff-mobile-sub">
            {part.filament_display && <span>{part.filament_display}</span>}
            <SpoolRemainingBadge part={part} />
            {spoolmanConfigured && onSpoolChange && (
              <PartSpoolPicker
                part={part}
                roleFilaments={roleFilaments}
                spools={spools}
                spoolsLoading={spoolsLoading}
                disabled={busy || !part.included}
                onChange={onSpoolChange}
                className="mt-1 w-full"
              />
            )}
            {part.role && <span className="checkoff-mobile-role">{part.role}</span>}
            {!part.included && <span className="checkoff-mobile-role">excluded</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {part.included ? (
          <>
            <MobileQtyStepper
              part={part}
              disabled={busy}
              onChange={(n) => onQtyChange(part, n)}
            />
            <Button
              type="button"
              variant="sheetRemove"
              size="sm"
              className="sheet-remove-btn"
              disabled={busy}
              onClick={onRemove}
            >
              Remove
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="sheetRestore"
            className="sheet-restore-btn w-full"
            disabled={busy}
            onClick={onRestore}
          >
            Restore to build
          </Button>
        )}
      </div>
    </article>
  );
}
