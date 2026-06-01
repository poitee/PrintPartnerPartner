import { Check } from "lucide-react";
import type { CheckoffPart } from "../../api/engine";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { generatePartThumbnail } from "../../lib/stlThumbnail";
import { useEffect, useRef, useState } from "react";

function MobileThumb({ partId, tintHex }: { partId: number; tintHex?: string | null }) {
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
      { rootMargin: "200px" },
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

  return (
    <div ref={ref} className="checkoff-mobile-thumb">
      {src ? (
        <img className="checkoff-mobile-thumb-img" src={src} alt="" />
      ) : (
        <div
          className="checkoff-mobile-thumb-ph"
          style={{ background: tintHex ?? "#e5e7eb" }}
          aria-hidden
        />
      )}
    </div>
  );
}

type Props = {
  part: CheckoffPart;
  busy: boolean;
  onToggleUnit: (part: CheckoffPart, unitIndex: number) => void;
};

/** Touch-first checkoff row for narrow viewports (shop floor / phone). */
export default function CheckoffMobilePartCard({ part, busy, onToggleUnit }: Props) {
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
        <MobileThumb partId={part.id} tintHex={part.filament_hex} />
        <div className="checkoff-mobile-card-meta">
          <h4 className="checkoff-mobile-filename" title={part.relative_path || part.filename}>
            {part.filename}
          </h4>
          <p className="checkoff-mobile-sub">
            {part.filament_display && <span>{part.filament_display}</span>}
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
