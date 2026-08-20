export const queryKeys = {
  health: ["health"] as const,
  profiles: ["profiles"] as const,
  profile: (id: number) => ["profiles", id] as const,
  sources: ["sources"] as const,
  source: (id: number) => ["sources", id] as const,
  planReviews: ["planReview"] as const,
  planReview: (profileId: number, includeExcluded?: boolean) =>
    ["planReview", profileId, includeExcluded ?? false] as const,
  planLayers: (profileId: number) => ["planLayers", profileId] as const,
  checkoff: (profileId: number) => ["checkoff", profileId] as const,
  roleFilaments: (profileId: number) => ["roleFilaments", profileId] as const,
  workflowGuide: ["workflowGuide"] as const,
  buildTrackingSettings: ["buildTrackingSettings"] as const,
  plateWorkspace: (profileId: number) => ["plateWorkspace", profileId] as const,
  printGroups: (profileId: number) => ["printGroups", profileId] as const,
};
