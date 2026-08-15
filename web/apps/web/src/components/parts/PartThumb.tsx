import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { partThumbnailUrl } from "../../api/engine";
import { generatePartThumbnail } from "../../lib/stlThumbnail";
import {
  getThumbnailCacheVersion,
  subscribeThumbnailCache,
} from "../../lib/thumbnailCache";

const DEFAULT_THUMB_PX = 96;

/**
 * Lazy part thumbnail (IntersectionObserver). Tries the cheap server-cached
 * PNG first; the server returns a 1x1 transparent placeholder when nothing is
 * cached, in which case we fall back to rendering the STL client-side (which
 * also uploads the render to warm the server cache).
 *
 * Fix #6: passes a priority to the render queue so parts that are already
 * visible on screen jump ahead of parts still off-screen.
 */
export default memo(function PartThumb({
  partId,
  tintHex,
  compact,
  sizePx,
  eager = false,
  fallbackLabel,
}: {
  partId: number;
  tintHex?: string | null;
  compact?: boolean;
  sizePx?: number;
  /** Load immediately (e.g. before printing) instead of waiting for scroll into view. */
  eager?: boolean;
  /** Shown while the image is loading / unavailable (e.g. filename initials). */
  fallbackLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(eager);
  // Fix #6: track whether the element is already intersecting (for priority)
  const [intersecting, setIntersecting] = useState(eager);
  const cacheVersion = useSyncExternalStore(
    subscribeThumbnailCache,
    getThumbnailCacheVersion,
    getThumbnailCacheVersion,
  );

  useEffect(() => {
    if (eager) {
      setVisible(true);
      setIntersecting(true);
    }
  }, [eager]);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible || eager) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          setIntersecting(true);
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

    // Fix #6: visible parts get priority 1, off-screen buffered parts get 0
    const priority = intersecting ? 1 : 0;

    // Client STL render fallback; uploads the PNG so the server cache warms.
    const renderClientSide = () => {
      void generatePartThumbnail(partId, tintHex, { priority }).then((url) => {
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

    void partThumbnailUrl(partId, { hex: tintHex, cacheVersion }).then((serverUrl) => {
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
  }, [visible, intersecting, partId, tintHex, cacheVersion]);

  const px = sizePx ?? (compact ? 56 : DEFAULT_THUMB_PX);
  const label = fallbackLabel?.trim().slice(0, 3) || null;
  return (
    <div ref={ref} className="sheet-thumb" style={{ width: px, height: px }}>
      {src ? (
        <img className="sheet-thumb-img" src={src} alt="" />
      ) : label ? (
        <span
          className="sheet-thumb-fallback"
          style={tintHex ? { color: tintHex } : undefined}
          aria-hidden
        >
          {label}
        </span>
      ) : (
        <div
          className="sheet-thumb-ph"
          style={{ background: tintHex ?? "#e5e7eb" }}
          aria-hidden
        />
      )}
    </div>
  );
});
