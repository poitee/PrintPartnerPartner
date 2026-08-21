import type { AcceptedPlanCorruptionCode } from "../db/accepted-plan-operational.js";
import type {
  AcceptedProfileProgress,
  AcceptedProfileSummary,
  ProfileHeader,
} from "../db/repository.js";

export type AcceptedProgressSummaryView =
  | {
      readonly kind: "ready";
      readonly total_units: number;
      readonly remaining_units: number;
    }
  | { readonly kind: "empty" }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "compatibility_dirty"
        | "uninitialized"
        | "integrity"
        | "concurrent_update";
    };

export type AcceptedProfileSummaryView = Readonly<
  ProfileHeader & { readonly accepted_progress: AcceptedProgressSummaryView }
>;

export type LegacyProfileSummaryView = Readonly<
  ProfileHeader & {
    readonly remaining_units: number;
    readonly total_units: number;
  }
>;

export type LegacyProgressFailure =
  | {
      readonly kind: "unavailable";
      readonly reason: "compatibility_dirty" | "uninitialized";
    }
  | { readonly kind: "integrity_failure"; readonly code: AcceptedPlanCorruptionCode }
  | { readonly kind: "concurrent_update" };

export type LegacyProfileSummaryResult =
  | { readonly kind: "ready"; readonly profile: LegacyProfileSummaryView }
  | { readonly kind: "unavailable"; readonly failure: LegacyProgressFailure };

function unreachable(progress: never): never {
  throw new Error(`Unexpected accepted Progress state: ${JSON.stringify(progress)}`);
}

function toAcceptedProgressSummary(
  progress: AcceptedProfileProgress,
): AcceptedProgressSummaryView {
  switch (progress.kind) {
    case "ready":
      return {
        kind: "ready",
        total_units: progress.totalUnits,
        remaining_units: progress.remainingUnits,
      };
    case "empty":
      return { kind: "empty" };
    case "unavailable":
      return { kind: "unavailable", reason: progress.reason };
    case "integrity_failure":
      return { kind: "unavailable", reason: "integrity" };
    case "concurrent_update":
      return { kind: "unavailable", reason: "concurrent_update" };
    default:
      return unreachable(progress);
  }
}

export function toProfileSummary(
  summary: AcceptedProfileSummary,
): AcceptedProfileSummaryView {
  return {
    ...summary.header,
    accepted_progress: toAcceptedProgressSummary(summary.progress),
  };
}

export function toLegacyProfileSummary(
  summary: AcceptedProfileSummary,
): LegacyProfileSummaryResult {
  const { progress } = summary;
  switch (progress.kind) {
    case "ready":
      return {
        kind: "ready",
        profile: {
          ...summary.header,
          remaining_units: progress.remainingUnits,
          total_units: progress.totalUnits,
        },
      };
    case "empty":
      return {
        kind: "ready",
        profile: { ...summary.header, remaining_units: 0, total_units: 0 },
      };
    case "unavailable":
      return {
        kind: "unavailable",
        failure: { kind: "unavailable", reason: progress.reason },
      };
    case "integrity_failure":
      return {
        kind: "unavailable",
        failure: { kind: "integrity_failure", code: progress.code },
      };
    case "concurrent_update":
      return { kind: "unavailable", failure: { kind: "concurrent_update" } };
    default:
      return unreachable(progress);
  }
}
