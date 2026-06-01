/** Shared API types between web client and server. */

export type DeployMode = "self-host" | "saas";

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
  "import-kit-bundle",
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
