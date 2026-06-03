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

/** @deprecated use buildRoute */
export function planRoute(profileId?: number | null): string {
  return buildRoute(profileId);
}

export function reviewRoute(profileId?: number | null): string {
  return withProfile("/review", profileId ?? null);
}

export function sourcesRoute(): string {
  return "/sources";
}

/** @deprecated Plate step removed — use reviewRoute */
export function plateRoute(profileId?: number | null): string {
  return reviewRoute(profileId);
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
  return pathname === "/review";
}

export function isCheckoffPath(pathname: string): boolean {
  return pathname === "/checkoff";
}

export function checkoffRoute(profileId?: number | null): string {
  return withProfile("/checkoff", profileId ?? null);
}

export function isPlanWorkflowPath(pathname: string): boolean {
  return (
    isBuildPath(pathname) ||
    isBuildsPath(pathname) ||
    isReviewPath(pathname) ||
    isCheckoffPath(pathname) ||
    isKitStudioPath(pathname)
  );
}
