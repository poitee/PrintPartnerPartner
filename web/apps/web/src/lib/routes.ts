/** Central route builders — keep cross-route links consistent. */

export function withProfile(path: string, profileId: number | null | undefined): string {
  if (profileId == null || profileId <= 0) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}profile=${profileId}`;
}

/** Canonical: Library (sources registry). */
export function libraryRoute(): string {
  return "/library";
}

/** Canonical: Plan (attach sources, picks, roles). */
export function planRoute(profileId?: number | null): string {
  return withProfile("/plan", profileId ?? null);
}

/** Canonical: Parts (validate / quantities). */
export function partsRoute(profileId?: number | null): string {
  return withProfile("/parts", profileId ?? null);
}

/** Canonical: Progress (print checkoff). */
export function progressRoute(profileId?: number | null): string {
  return withProfile("/progress", profileId ?? null);
}

/** Canonical: Export hub. */
export function exportRoute(profileId?: number | null): string {
  return withProfile("/export", profileId ?? null);
}

export function buildsRoute(profileId?: number | null): string {
  return withProfile("/builds", profileId ?? null);
}

export function settingsRoute(): string {
  return "/settings";
}

/** Settings → Printers section (hash scrolls past About). */
export function settingsPrintersRoute(): string {
  return "/settings#printers";
}

export function printersRoute(): string {
  return "/printers";
}

export function helpRoute(): string {
  return "/help";
}

export function isPrintersPath(pathname: string): boolean {
  return pathname === "/printers";
}

/** @deprecated Prefer `libraryRoute` — kept for call-site compatibility. */
export function sourcesRoute(): string {
  return libraryRoute();
}

/** @deprecated Prefer `planRoute` — kept for call-site compatibility. */
export function buildRoute(profileId?: number | null): string {
  return planRoute(profileId);
}

/** @deprecated Prefer `partsRoute` — kept for call-site compatibility. */
export function reviewRoute(profileId?: number | null): string {
  return partsRoute(profileId);
}

/** Legacy Kit Studio deep link — redirects to Plan in the router. */
export function planStudioRoute(planId: number): string {
  return planRoute(planId);
}

export function isKitStudioPath(pathname: string): boolean {
  return /^\/plans\/\d+\/studio/.test(pathname);
}

export function isLibraryPath(pathname: string): boolean {
  return pathname === "/library" || pathname === "/sources";
}

/** Plan stage (`/plan`); also matches legacy `/build`. */
export function isBuildPath(pathname: string): boolean {
  return pathname === "/plan" || pathname === "/build";
}

export function isPlanPath(pathname: string): boolean {
  return isBuildPath(pathname);
}

export function isBuildsPath(pathname: string): boolean {
  return pathname === "/builds";
}

export function isPartsPath(pathname: string): boolean {
  return pathname === "/parts" || pathname === "/review";
}

export function isProgressPath(pathname: string): boolean {
  return pathname === "/progress" || pathname === "/checkoff";
}

export function isExportPath(pathname: string): boolean {
  return pathname === "/export";
}

/**
 * Parts or Progress (and legacy `/review` / `/checkoff`).
 * Used by surfaces that treat both as post-plan workflow.
 */
export function isReviewPath(pathname: string): boolean {
  return isPartsPath(pathname) || isProgressPath(pathname);
}

/** @deprecated Prefer `isProgressPath`. */
export function isCheckoffPath(pathname: string): boolean {
  return isProgressPath(pathname);
}

/** Alias for deep links — Progress is the dedicated checkoff stage. */
export function checkoffRoute(profileId?: number | null): string {
  return progressRoute(profileId);
}

export function isPlanWorkflowPath(pathname: string): boolean {
  return (
    isLibraryPath(pathname) ||
    isPlanPath(pathname) ||
    isBuildsPath(pathname) ||
    isPartsPath(pathname) ||
    isProgressPath(pathname) ||
    isExportPath(pathname) ||
    isKitStudioPath(pathname)
  );
}
