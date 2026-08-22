/** Pure helpers for ?profile= URL sync (testable without React). */

export function parseProfileParam(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** When URL profile differs from selection, return the id to apply; else undefined. */
export function profileIdFromUrl(
  urlId: number | null,
  validIds: readonly number[],
  selectedProfileId: number | null,
): number | undefined {
  if (urlId == null) return undefined;
  if (!validIds.includes(urlId)) return undefined;
  if (selectedProfileId === urlId) return undefined;
  return urlId;
}

/**
 * Search string to write for the live location. `undefined` means leave the
 * URL alone. Using the pathname from the current location (not a captured
 * render) keeps New Build's navigate to Sources from being rewound to Builds.
 */
export function searchAfterProfileStamp(
  pathname: string,
  search: string,
  selectedProfileId: number | null,
): string | undefined {
  if (!shouldStampProfileOnPath(pathname)) return undefined;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const next = searchParamsWithProfile(new URLSearchParams(raw), selectedProfileId);
  if (!next) return undefined;
  const encoded = next.toString();
  return encoded ? `?${encoded}` : "";
}

/** Merge selected plan into search params; return undefined when unchanged. */
export function searchParamsWithProfile(
  prev: URLSearchParams,
  selectedProfileId: number | null,
): URLSearchParams | undefined {
  const current = prev.get("profile");
  if (selectedProfileId == null) {
    if (current == null) return undefined;
    const next = new URLSearchParams(prev);
    next.delete("profile");
    return next;
  }
  const expected = String(selectedProfileId);
  if (current === expected) return undefined;
  const next = new URLSearchParams(prev);
  next.set("profile", expected);
  return next;
}

/**
 * Global Production stays `/production` with no profile so URL sync cannot
 * bounce it to Build Production. Global Builds stays `/builds` for the same
 * reason: stamping `?profile=` there rewinds New Build's navigate to Sources.
 */
export function shouldStampProfileOnPath(pathname: string): boolean {
  return pathname !== "/production" && pathname !== "/builds" && pathname !== "/plans";
}
