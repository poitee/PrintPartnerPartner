import { useEffect, useRef, useState } from "react";
import { generatePartThumbnail } from "../../lib/stlThumbnail";

const DEFAULT_THUMB_PX = 96;

/**
 * Lazy STL thumbnail for printable sheets (IntersectionObserver).
 */
export default function PartThumb({
  partId,
  tintHex,
  compact,
  sizePx = DEFAULT_THUMB_PX,
}: {
  partId: number;
  tintHex?: string | null;
  compact?: boolean;
  sizePx?: number;
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

  const px = compact ? 56 : sizePx;
  return (
    <div ref={ref} className="sheet-thumb" style={{ width: px, height: px }}>
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
