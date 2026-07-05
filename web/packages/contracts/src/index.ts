/** Shared API types between web client and server. */

export type DeployMode = "self-host" | "saas";

/** Global preference controlling how timestamps (e.g. "Generated …", "Last synced …") are displayed. */
export type DateFormatId =
  | "mdy_12h"
  | "dmy_12h"
  | "mdy_short"
  | "dmy_short"
  | "ymd_24h"
  | "iso";

export const DATE_FORMAT_DEFAULT: DateFormatId = "mdy_12h";

export const DATE_FORMAT_PRESETS: Array<{ id: DateFormatId; label: string; example: string }> = [
  { id: "mdy_12h", label: "Jul 3, 2026, 9:01 PM", example: "Jul 3, 2026, 9:01 PM" },
  { id: "dmy_12h", label: "3 Jul 2026, 9:01 PM", example: "3 Jul 2026, 9:01 PM" },
  { id: "mdy_short", label: "07/03/2026, 9:01 PM", example: "07/03/2026, 9:01 PM" },
  { id: "dmy_short", label: "03/07/2026, 21:01", example: "03/07/2026, 21:01" },
  { id: "ymd_24h", label: "2026-07-03 21:01", example: "2026-07-03 21:01" },
  { id: "iso", label: "2026-07-03T21:01:32.727Z (ISO)", example: "2026-07-03T21:01:32.727Z" },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats an ISO timestamp per the given global date-format preference. Works in both browser and Node (Intl is available in both). */
export function formatTimestamp(
  iso: string | null | undefined,
  formatId: DateFormatId = DATE_FORMAT_DEFAULT,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  switch (formatId) {
    case "iso":
      return date.toISOString();
    case "ymd_24h":
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    case "mdy_short":
      return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    case "dmy_short":
      return new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    case "dmy_12h":
      return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
    case "mdy_12h":
    default:
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
  }
}

export type ApiError = {
  detail: string;
  title?: string;
  status?: number;
  type?: string;
};

export const JOB_KINDS = [
  "sync",
  "recompute",
  "import-scan",
  "check-source-updates",
  "export-stl-pack",
  "export-checklist-html",
  "export-kit-bundle",
  "export-3mf",
  "pack-preview",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export type JobStartResponse = {
  job_id: string;
};

export type ExportArtifact = {
  path?: string;
  download_url: string | null;
  kind?: string;
  job_id?: string;
  created_at?: string;
  manifest_path?: string | null;
};

export type FleetPreset = {
  id: string;
  name: string;
  bed_width_mm: number;
  bed_depth_mm: number;
  bed_height_mm?: number;
  margin_mm?: number;
  enabled?: boolean;
};

export type IntegrationType =
  | "moonraker"
  | "prusalink"
  | "bambu"
  | "spoolman"
  | "slicer_folder";

export type IntegrationConfig = Record<string, unknown>;

export type IntegrationSummary = {
  id: string;
  type: IntegrationType;
  name: string;
  config: IntegrationConfig;
  created_at: string;
  updated_at: string;
};

export type IntegrationTestResult = {
  ok: boolean;
  message?: string;
};

export type DeviceSummary = {
  id: string;
  name: string;
  type?: string;
  status?: string;
};

export type WebhookEvent = "job.done" | "job.error";

export type WebhookRegistration = {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string | null;
  created_at: string;
};

export type ApiV1Index = {
  version: string;
  openapi: string;
  health: string;
};

export type HealthResponse = {
  ok: boolean;
  version: string;
  deploy_mode: DeployMode;
  data_dir: string;
  port?: number;
  api_version?: string;
  capabilities?: string[];
  db?: {
    connected: boolean;
    driver: string;
    postgres: boolean | null;
  };
};

/** Response from GET /settings/update-check — app release availability. */
export type AppUpdateCheckResponse = {
  enabled: boolean;
  update_available: boolean;
  current_version: string;
  latest_version: string | null;
  release_url: string | null;
  release_notes_url: string | null;
  deploy_mode: DeployMode;
  checked_at: string | null;
};

export type ProfileSummary = {
  id: number;
  name: string;
  order_number: string | null;
  part_count: number;
};

export type SourceSummary = {
  id: number;
  name: string;
  url: string;
  source_kind: string;
  source_type: string;
  /** @deprecated library uses `category`; kept for API compat */
  role: string;
  category: string | null;
  branch: string;
  tag: string | null;
  local_path: string | null;
  last_synced_at: string | null;
  last_commit_sha: string | null;
  docs_url: string | null;
  manifest_community_slug: string | null;
  metadata: Record<string, unknown> | null;
  naming_use_defaults?: boolean;
  update_status?: "up_to_date" | "updates_available" | "unknown" | null;
  update_checked_at?: string | null;
};

export type PartRow = {
  id: number;
  match_key: string;
  relative_path: string;
  filename: string;
  source_layer: string | null;
  status: string;
  role: string | null;
  requirement: string | null;
  option_group_id: string | null;
  included: boolean;
  filament_color_id: string | null;
  filament_custom_hex?: string | null;
  spoolman_spool_id?: string | null;
  filament_display?: string;
  filament_hex?: string | null;
  quantity_auto: number;
  quantity_override: number | null;
  quantity_effective: number;
};

/** Plan review / checkoff sheet row (print progress + filament display). */
export type ReviewPart = PartRow & {
  print_units: boolean[];
  printed_count: number;
  missing: boolean;
  filament_display: string;
};

export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled";

export type JobEvent = {
  status: JobStatus | string;
  message: string;
  progress: number | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type JobSnapshot = JobEvent & {
  job_id: string;
  kind: string;
  finished_at?: string | null;
};
