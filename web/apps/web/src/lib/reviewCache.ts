export function optimisticReviewCacheKey(
  _profileId: number,
  _includeExcluded: boolean,
): readonly unknown[] {
  return [];
}

export type OptimisticRollback<T> =
  | { kind: "restore"; previous: T }
  | { kind: "remove" };

export function rollbackOptimisticCache<T>(_previous: T | undefined): OptimisticRollback<T> {
  return { kind: "remove" };
}
