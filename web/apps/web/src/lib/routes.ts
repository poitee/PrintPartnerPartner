/** Central route builders — keep cross-route links consistent. */

export function withProfile(path: string, profileId: number | null | undefined): string {
  if (profileId == null || profileId <= 0) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}profile=${profileId}`;
}

export function buildRoute(profileId?: number | null): string {
  return withProfile("/build", profileId ?? null);
}

export function buildsRoute(profileId?: number | null): string {
  return withProfile("/builds", profileId ?? null);
}

export function reviewRoute(profileId?: number | null): string {
  return withProfile("/review", profileId ?? null);
}

export function sourcesRoute(): string {
  return "/sources";
}

export function settingsRoute(): string {
  return "/settings";
}

export function helpRoute(): string {
  return "/help";
}

/** Legacy Kit Studio deep link — redirects to Build in the router. */
export function planStudioRoute(planId: number): string {
  return buildRoute(planId);
}

export function isKitStudioPath(pathname: string): boolean {
  return /^\/plans\/\d+\/studio/.test(pathname);
}

export function isBuildPath(pathname: string): boolean {
  return pathname === "/build" || pathname === "/plan";
}

export function isBuildsPath(pathname: string): boolean {
  return pathname === "/builds";
}

export function isReviewPath(pathname: string): boolean {
  return pathname === "/review" || pathname === "/checkoff";
}

/** Legacy path matcher — `/checkoff` redirects to Review. */
export function isCheckoffPath(pathname: string): boolean {
  return pathname === "/checkoff";
}

/** Alias for deep links — Checkoff is folded into Review. */
export function checkoffRoute(profileId?: number | null): string {
  return reviewRoute(profileId);
}

export function isPlanWorkflowPath(pathname: string): boolean {
  return (
    isBuildPath(pathname) ||
    isBuildsPath(pathname) ||
    isReviewPath(pathname) ||
    isKitStudioPath(pathname)
  );
}
