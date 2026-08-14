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
  "printer-upload",
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
  | "slicer_folder"
  | "ai_assistant";

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

/** Live printer host status from IntegrationAdapter.getStatus. */
export type PrinterHostState =
  | "idle"
  | "printing"
  | "paused"
  | "complete"
  | "error"
  | "offline"
  | "unknown";

export type PrinterHostStatus = {
  state: PrinterHostState;
  progress?: number;
  filename?: string;
  message?: string;
  eta_seconds?: number;
};

/** One Progress unit linked to a sent print job (verify-first Phase D). */
export type PrinterCheckoffUnit = {
  part_id: number;
  unit_index: number;
};

export type PrinterHostOutcome = "unknown" | "success" | "failed" | "cancelled";

export type PrinterCheckoffLinkState =
  | "watching"
  | "awaiting_verify"
  | "host_failed"
  | "dismissed"
  | "verified"
  /** @deprecated Legacy auto-tick; treated as verified when loading. */
  | "applied";

export type PrintRejectReason =
  | "bed_adhesion"
  | "layer_shift"
  | "warping"
  | "stringing"
  | "under_extrusion"
  | "over_extrusion"
  | "dimensional"
  | "collision"
  | "wrong_filament"
  | "other";

export type PrintOutcomeResult = "confirmed" | "rejected";

export type PrintVerifyDecision = {
  part_id: number;
  unit_index: number;
  result: PrintOutcomeResult;
  reason?: PrintRejectReason;
  note?: string;
};

export type PrintOutcomeEvent = {
  id: string;
  at: string;
  profile_id: number;
  part_id: number;
  unit_index: number;
  result: PrintOutcomeResult;
  reason?: PrintRejectReason;
  note?: string;
  host_integration_id?: string;
  filename?: string;
  match_key?: string;
  role?: string;
  filament_display?: string;
  link_id?: string;
};

export type PrintOutcomesSummary = {
  profile_id: number;
  total_confirmed: number;
  total_rejected: number;
  by_reason: Partial<Record<PrintRejectReason, number>>;
  by_role: Record<string, { confirmed: number; rejected: number }>;
  recent_rejected: PrintOutcomeEvent[];
};

/**
 * Durable job ↔ Progress units mapping for verify-first checkoff.
 * Created at Export send; host `complete` → awaiting_verify (user confirms).
 */
export type PrinterCheckoffLink = {
  id: string;
  profile_id: number;
  integration_id: string;
  printer_id: string;
  host_name: string;
  filename: string;
  remote_path?: string;
  upload_job_id?: string;
  units: PrinterCheckoffUnit[];
  /** Parsed object names that did not map to Progress units (visible, not confirmable). */
  unlabeled_names?: string[];
  /** Units already confirmed/rejected via verify API. */
  resolved_units?: PrintVerifyDecision[];
  state: PrinterCheckoffLinkState;
  host_outcome?: PrinterHostOutcome;
  /** True after we observe printing/paused for this filename. */
  saw_active: boolean;
  /** Upload used start=true — allow complete with cleared filename before first poll. */
  started?: boolean;
  /** Last observed print progress (0–100) while this link was active. */
  last_progress?: number;
  created_at: string;
  /** When host finished successfully (entered awaiting_verify). */
  completed_at?: string;
  applied_at?: string;
  units_marked?: number;
};

/** Reconcile side-effect (no longer auto-ticks Progress). */
export type PrinterCheckoffReconcileUpdate = {
  link_id: string;
  host_name: string;
  profile_id: number;
  filename: string;
  event: "awaiting_verify" | "host_failed";
  host_outcome: PrinterHostOutcome;
  units_pending: number;
};

export type PrinterSendQueueState =
  | "queued"
  | "sending"
  | "done"
  | "error"
  | "cancelled";

/** How drain/dispatch picks a live host for a queued send. */
export type PrinterSendQueueMatch = "pinned" | "compatible";

/** Durable outbound send queue item (Phase F thin farm assist). */
export type PrinterSendQueueItem = {
  id: string;
  filename: string;
  /** Absolute path under data/exports/printer-uploads/… */
  artifact_path: string;
  /**
   * Preferred fleet printer. For `match: "compatible"`, bed size (and optional
   * Progress filament) are taken from this machine; drain may reassign to
   * another idle host with the same bed.
   */
  printer_id: string;
  /**
   * `pinned` (default): wait for this printer only.
   * `compatible`: pick any idle linked Moonraker/PrusaLink with the same bed;
   * prefer loaded-filament overlap with tracked Progress units.
   */
  match?: PrinterSendQueueMatch;
  /** When true, wait for host Idle before dispatch (default). */
  wait_for_idle: boolean;
  start: boolean;
  profile_id?: number;
  checkoff_units?: PrinterCheckoffUnit[];
  state: PrinterSendQueueState;
  created_at: string;
  updated_at: string;
  upload_job_id?: string;
  error?: string;
  host_name?: string;
};

export type PrinterUploadResult = {
  ok: boolean;
  remote_path?: string;
  started?: boolean;
  message?: string;
  checkoff_link_id?: string;
  checkoff_units?: number;
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
  multi_user?: boolean;
  data_dir: string;
  port?: number;
  api_version?: string;
  capabilities?: string[];
  db?: {
    connected: boolean;
    driver: string;
    postgres: boolean | null;
  };
  /**
   * Optional Google Drive (GIS) client id for parts-manifest open/save.
   * Public OAuth Web client id only — never a client secret.
   */
  google_drive?: {
    client_id: string | null;
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
  /** Quiet operator note (e.g. contact customer before printing). */
  special_request: string | null;
  part_count: number;
  /** Included print units still unmarked on Progress. */
  remaining_units: number;
  /** Included print units (quantity sum) for this plan. */
  total_units: number;
  /** True when plan config changed since the last successful recompute. */
  build_stale: boolean;
  /** ISO timestamp when archived as a template; null if active. */
  archived_at: string | null;
  /** ISO timestamp of last spine selection. */
  last_used_at: string | null;
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
  /** Count of synced markdown/PDF docs indexed for this source. */
  doc_count?: number;
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

/** AI assistant provider id (server config / status). */
export type AiProviderId = "anthropic" | "openai" | "ollama" | "none";

/** Web search backend for assistant research tools. */
export type SearchProviderId =
  | "anthropic-native"
  | "openai-native"
  | "brave"
  | "exa"
  | "duckduckgo"
  | "none";

export type SearchSetupOption = {
  id: SearchProviderId;
  label: string;
  summary: string;
  setup: string;
};

export type AssistantStatus = {
  enabled: boolean;
  provider: AiProviderId;
  model: string | null;
  /** When true, other accessible plans are summarized as few-shot examples (not model training). */
  use_other_builds_as_examples: boolean;
  /** Whether the active provider adapter exposes native tool calling. */
  tools_supported: boolean;
  /** Where active AI provider settings came from (`settings` = UI integration). */
  source?: "settings" | "env" | "none";
  /** Soft daily request cap (`null` / omitted = unlimited). */
  daily_request_budget?: number | null;
  /** Soft daily estimated-token cap (`null` / omitted = unlimited). */
  daily_token_budget?: number | null;
  /** Requests used today (UTC) for this tenant. */
  daily_requests_used?: number;
  /** Estimated tokens used today (UTC) for this tenant. */
  daily_tokens_used?: number;
  /**
   * Active web search backend + setup guidance for all options.
   * `configured` is true when the resolved provider has what it needs (e.g. Brave/Exa key)
   * without exposing secrets.
   */
  search?: {
    provider: SearchProviderId;
    configured: boolean;
    options: SearchSetupOption[];
  };
};

/**
 * Documented `ai_assistant` integration config keys (stored as IntegrationConfig bag).
 * Secrets (`api_key`, `search_api_key`) are redacted in list/get responses.
 *
 * - provider, model, api_key, base_url / ollama_url
 * - max_tokens, use_other_builds_as_examples, daily_*_budget, enabled
 * - search_provider (`SearchProviderId` | null/auto), search_api_key
 * - allow_url_ingest, guide_ingest_max_bytes, ollama_num_ctx
 */

export type AssistantChatRole = "user" | "assistant" | "system";

export type AssistantChatMessage = {
  role: AssistantChatRole;
  content: string;
};

/** Mutating assistant action — never applied until POST /assistant/actions/apply. */
export type AssistantActionType =
  | "apply_stack_preset"
  | "set_base"
  | "add_addon"
  | "remove_layer"
  | "update_kit_selections"
  | "start_recompute"
  | "start_sync"
  | "propose_source_mapping"
  | "set_source_git_ref"
  | "apply_build_recipe"
  | "restore_plan_snapshot"
  | "create_plan_snapshot"
  | "propose_add_source"
  | "import_guide_notes"
  | "propose_exclude_replaced_parts"
  | "duplicate_plan"
  | "archive_plan"
  /** Client-executed UI opens — auto-run; do not require Apply. */
  | "ui_navigate"
  | "ui_open_source"
  | "ui_open_docs"
  | "ui_highlight_part"
  | "ui_focus_stl_search"
  | "ui_focus_kit_option";

export const ASSISTANT_UI_ACTION_TYPES = [
  "ui_navigate",
  "ui_open_source",
  "ui_open_docs",
  "ui_highlight_part",
  "ui_focus_stl_search",
  "ui_focus_kit_option",
] as const satisfies readonly AssistantActionType[];

export function isAssistantUiAction(type: string): boolean {
  return (ASSISTANT_UI_ACTION_TYPES as readonly string[]).includes(type);
}

export type AssistantProposedAction = {
  id: string;
  type: AssistantActionType;
  plan_id: number;
  label: string;
  summary: string;
  params: Record<string, unknown>;
};

export type PlanDecisionKind =
  | "applied_action"
  | "dismissed_action"
  | "user_note"
  | "choice";

export type PlanDecisionActor = "assistant" | "user";

export type PlanDecision = {
  id: number;
  plan_id: number;
  created_at: string;
  actor: PlanDecisionActor;
  kind: PlanDecisionKind;
  action_type: string | null;
  params: Record<string, unknown>;
  label: string;
  summary: string;
  rationale: string | null;
  result: Record<string, unknown> | null;
};

export type PlanDecisionsResponse = {
  decisions: PlanDecision[];
};

export type PlanDecisionCreateRequest = {
  kind?: PlanDecisionKind;
  actor?: PlanDecisionActor;
  action_type?: string | null;
  params?: Record<string, unknown>;
  label?: string;
  summary?: string;
  rationale?: string | null;
  result?: Record<string, unknown> | null;
};

export type BuildRecipe = {
  plan_id: number;
  plan_name: string;
  base: { source_name: string | null; project_id: number | null; tag: string | null; branch: string | null };
  addons: Array<{ source_name: string; project_id: number; tag: string | null; branch: string | null }>;
  stack_preset: string | null;
  kit_selections: Record<string, string>;
  include: string[];
  exclude: string[];
  decision_count: number;
  markdown: string;
};

export type PlanSnapshotSource = "user" | "assistant" | "pre_apply";

export type PlanSnapshotSummary = {
  id: number;
  plan_id: number;
  name: string;
  created_at: string;
  source: PlanSnapshotSource;
};

export type PlanSnapshot = PlanSnapshotSummary & {
  payload: Record<string, unknown>;
};

export type PlanSnapshotsResponse = {
  snapshots: PlanSnapshotSummary[];
};

export type PlanSnapshotCreateRequest = {
  name?: string;
  source?: PlanSnapshotSource;
};

export type AssistantActionDismissRequest = {
  action: AssistantProposedAction;
};

export type AssistantChatRequest = {
  messages: AssistantChatMessage[];
  plan_id?: number;
  /** When true (default), response is SSE. When false, JSON `{ message }`. */
  stream?: boolean;
  /**
   * Override Settings flag for this request. When omitted, uses integration/env
   * `use_other_builds_as_examples` (default true). Examples are context only — not training.
   */
  use_other_builds_as_examples?: boolean;
};

export type AssistantChatResponse = {
  message: AssistantChatMessage;
  /** Proposed mutations; apply only via POST /assistant/actions/apply after user confirm. */
  proposed_actions?: AssistantProposedAction[];
  /** True when tools were unavailable and context stuffing was used instead. */
  tools_degraded?: boolean;
};

export type AssistantActionApplyRequest = {
  action: AssistantProposedAction;
};

export type AssistantActionApplyResponse = {
  ok: boolean;
  detail?: string;
  job_id?: string;
  result?: Record<string, unknown>;
};

export type AssistantFeedbackRating = "up" | "down";

export type AssistantFeedbackRequest = {
  rating: AssistantFeedbackRating;
  /** Short excerpt of the assistant message being rated (no full transcript required). */
  message_excerpt?: string;
  plan_id?: number;
  comment?: string;
};

export type AssistantFeedbackResponse = {
  ok: boolean;
  id: string;
};

export type AssistantHistoryMessage = AssistantChatMessage & {
  id: string;
  created_at: string;
  /**
   * Pending confirm-to-apply cards for this assistant turn.
   * Persisted so reopen does not lose Apply/Dismiss UI.
   */
  proposed_actions?: AssistantProposedAction[];
};

export type AssistantHistoryResponse = {
  messages: AssistantHistoryMessage[];
};
