import { Check } from "lucide-react";
import type { ReviewPart } from "../../api/engine";
import PartThumbExpandButton from "../parts/PartThumbExpandButton";
import SpoolRemainingBadge from "../SpoolRemainingBadge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  part: ReviewPart;
  busy: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
  onPreview: (part: ReviewPart) => void;
};

/** Touch-first checkoff row for narrow viewports (shop floor / phone). */
export default function CheckoffMobilePartCard({ part, busy, onToggleUnit, onPreview }: Props) {
  const done =
    part.printed_count >= part.quantity_effective && part.quantity_effective > 0;
  const nextIdx = part.print_units.findIndex((u) => !u);

  const markNext = () => {
    if (nextIdx >= 0) onToggleUnit(part, nextIdx);
  };

  return (
    <article
      className={cn("checkoff-mobile-card", done && "checkoff-mobile-card-done")}
    >
      <div className="checkoff-mobile-card-head">
        <PartThumbExpandButton part={part} sizePx={72} onExpand={onPreview} />
        <div className="checkoff-mobile-card-meta">
          <h4 className="checkoff-mobile-filename" title={part.relative_path || part.filename}>
            {part.filename}
          </h4>
          <p className="checkoff-mobile-sub">
            {part.filament_display && <span>{part.filament_display}</span>}
            <SpoolRemainingBadge part={part} />
            {part.role && <span className="checkoff-mobile-role">{part.role}</span>}
            <span className="checkoff-mobile-qty">
              {part.printed_count}/{part.quantity_effective} printed
            </span>
          </p>
        </div>
      </div>

      {part.quantity_effective > 0 && (
        <div className="checkoff-mobile-actions">
          <Button
            type="button"
            className="checkoff-mobile-mark-btn h-12 w-full text-base"
            disabled={busy || nextIdx < 0}
            onClick={markNext}
          >
            <Check className="mr-2 h-5 w-5 shrink-0" aria-hidden />
            {nextIdx < 0 ? "All units printed" : `Mark unit ${nextIdx + 1} done`}
          </Button>
        </div>
      )}

      <div className="checkoff-mobile-units" role="group" aria-label="Print units">
        {part.print_units.map((unitDone, idx) => (
          <label
            key={idx}
            className={cn("checkoff-mobile-unit", unitDone && "checkoff-mobile-unit-done")}
          >
            <input
              type="checkbox"
              checked={unitDone}
              onChange={() => onToggleUnit(part, idx)}
              disabled={busy}
            />
            <span>#{idx + 1}</span>
          </label>
        ))}
      </div>
    </article>
  );
}
