import { useEffect, useRef, useState } from "react";
import { partThumbnailUrl } from "../../api/engine";
import { generatePartThumbnail } from "../../lib/stlThumbnail";

const DEFAULT_THUMB_PX = 96;

/**
 * Lazy part thumbnail (IntersectionObserver). Tries the cheap server-cached
 * PNG first; the server returns a 1x1 transparent placeholder when nothing is
 * cached, in which case we fall back to rendering the STL client-side (which
 * also uploads the render to warm the server cache).
 */
export default function PartThumb({
  partId,
  tintHex,
  compact,
  sizePx = DEFAULT_THUMB_PX,
  eager = false,
}: {
  partId: number;
  tintHex?: string | null;
  compact?: boolean;
  sizePx?: number;
  /** Load immediately (e.g. before printing) instead of waiting for scroll into view. */
  eager?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) setVisible(true);
  }, [eager]);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible || eager) return;
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
  }, [visible, eager]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    let probe: HTMLImageElement | null = null;

    // Client STL render fallback; uploads the PNG so the server cache warms.
    const renderClientSide = () => {
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
    };

    void partThumbnailUrl(partId).then((serverUrl) => {
      if (cancelled) return;
      // Probe off-DOM so the 1x1 placeholder never flashes in the UI.
      probe = new Image();
      probe.onload = () => {
        if (cancelled) return;
        if (probe && probe.naturalWidth > 1 && probe.naturalHeight > 1) {
          setSrc(serverUrl);
        } else {
          renderClientSide();
        }
      };
      probe.onerror = () => {
        if (!cancelled) renderClientSide();
      };
      probe.src = serverUrl;
    });

    return () => {
      cancelled = true;
      if (probe) {
        probe.onload = null;
        probe.onerror = null;
        probe = null;
      }
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
