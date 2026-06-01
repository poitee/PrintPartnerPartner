/** Shared API types between web client and server (seeded from desktop engine.ts). */

export type DeployMode = "self-host" | "saas";

export type HealthResponse = {
  ok: boolean;
  version: string;
  deploy_mode: DeployMode;
  data_dir: string;
  port?: number;
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
};
