import type {
  AppUpdateCheckResponse,
  HealthResponse,
  JobEvent,
  JobSnapshot,
  PartRow,
  ProfileSummary,
  SourceSummary,
} from "@print-partner/contracts";
import {
  pickKitBundleFileWeb,
  pickLocalDirectoryWeb,
  pickLocalFilesWeb,
  pickZipArchiveFileWeb,
  saveTextFileWeb,
} from "@/lib/webFilePickers";

export type { AppUpdateCheckResponse, HealthResponse, JobEvent, JobSnapshot, PartRow, ProfileSummary, SourceSummary };

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const API_PREFIX = (import.meta.env.VITE_API_PREFIX ?? "").replace(/\/$/, "");

function resolveEngineUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const withPrefix = API_PREFIX ? `${API_PREFIX}${normalized}` : normalized;
  if (API_BASE) return `${API_BASE}${withPrefix}`;
  if (typeof window !== "undefined") {
    return `${window.location.origin.replace(/\/$/, "")}${withPrefix}`;
  }
  return withPrefix;
}

/** @deprecated use SourceSummary */
export type ProjectSummary = SourceSummary;

export type SourceUpdateCheckSettings = {
  interval_hours: number;
};

export type StlSearchHit = {
  source_id: number;
  source_name: string;
  category: string | null;
  relative_path: string;
  filename: string;
};

export type StlSearchResponse = {
  query: string;
  results: StlSearchHit[];
};

export type CatalogColor = {
  id: string;
  display_name: string;
  product_line: string;
  hex: string;
  combo_label: string;
  swatch_url: string;
};

export type FilamentCatalog = {
  synced_at: string;
  source: string;
  status: string;
  colors: CatalogColor[];
  custom_colors: CatalogColor[];
  spoolman_colors?: CatalogColor[];
  /** Set when a Spoolman integration is selected for the Build picker. */
  default_spoolman_integration_id?: string | null;
  spoolman_status?: "ok" | "empty" | "error" | "disabled" | "not_found";
  spoolman_error?: string | null;
};

export type IntegrationSummary = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type IntegrationTestResult = {
  ok: boolean;
  message?: string;
};

export type SpoolmanDefaultSettings = {
  integration_id: string | null;
};

export type ProfileLayer = {
  id: number;
  layer_order: number;
  layer_type: string;
  project_id: number | null;
  project_name: string | null;
};

export type ChoiceTreeNode = {
  id: string;
  label?: string;
  type?: "pick_one" | "pick_any" | "addon_toggle";
  group?: string;
  source_id?: string;
  replaces_slot?: string;
  sources?: string[];
  children?: ChoiceTreeNode[];
};

export type KitManifest = {
  name: string | null;
  layers: string[];
  base_source_id?: string | null;
  addon_source_ids?: string[];
  selections: Record<string, string>;
  include: string[];
  exclude: string[];
  replacements?: Record<string, string>;
  choice_tree?: ChoiceTreeNode[];
  /** UI-only cache for cross-repo folder links (authoritative rules live in repo YAML). */
  category_links?: Array<{
    categoryId: string;
    members: Array<{ source: string; pathGlob: string }>;
  }>;
};

export type ManifestV2 = {
  profile_id: number;
  version: number;
  yaml: string;
  plan: {
    name: string | null;
    base_source_id: string | null;
    addon_source_ids: string[];
  };
  sources: Array<{
    id: string;
    kind: string;
    url: string | null;
    branch: string | null;
    role: string | null;
  }>;
  selections: Record<string, string>;
  option_groups: Record<
    string,
    {
      rule: string;
      label: string | null;
      parts: string[];
      variants: RepoManifestVariant[];
    }
  >;
  slots?: Record<
    string,
    {
      label: string | null;
      default_group: string | null;
    }
  >;
  choice_tree?: ChoiceTreeNode[];
  option_group_count: number;
  addon_count: number;
};

export type PlanManifestBuilderSource = {
  source_id: number;
  layer_type: string;
  name: string;
  role: string;
  url: string;
  exists: boolean;
  path: string;
  yaml: string;
  document: RepoManifestDocument;
  scanned_parts: ScannedManifestPart[];
};

export type PlanManifestBuilderBootstrap = {
  profile_id: number;
  sources: PlanManifestBuilderSource[];
  merged_option_groups: Record<string, RepoManifestOptionGroup>;
};

export async function fetchPlanManifestBuilder(
  profileId: number,
): Promise<PlanManifestBuilderBootstrap> {
  return engineFetch(`/plans/${profileId}/plan-manifest-builder`);
}

export type ApplyStackPresetResult = {
  profile_id: number;
  preset_id: string;
  missing_sources: string[];
  layers: ProfileLayer[];
  selections: Record<string, string>;
};

/** Apply kit-catalog stack preset (base + addons + default selections). */
export async function applyStackPresetApi(
  profileId: number,
  presetId: string,
): Promise<ApplyStackPresetResult> {
  return engineFetch(`/plans/${profileId}/apply-stack-preset`, {
    method: "POST",
    body: JSON.stringify({ preset_id: presetId }),
  });
}

export type ManifestWarning = {
  code: string;
  message: string;
  severity: string;
  match_key: string | null;
};

export type ManifestSummary = {
  profile_id: number;
  required: { total: number; included: number };
  optional: { total: number; included: number };
  recommended: { total: number; included: number };
  option_groups: Array<{
    id: string;
    rule: string;
    members: number;
    selected: number;
    min: number | null;
    max: number | null;
  }>;
};

export type PrinterMachine = {
  id: string;
  name: string;
  bed_width_mm: number;
  bed_depth_mm: number;
  bed_height_mm: number | null;
  margin_mm: number;
  max_filament_slots: number;
  loaded_filaments: Array<{
    slot: number;
    filament_color_id: string | null;
    label: string;
  }>;
  enabled?: boolean;
};

export type PrinterPreset = {
  id: string;
  name: string;
  model_slug?: string;
  thumbnail?: string;
  bed_width_mm: number;
  bed_depth_mm: number;
  bed_height_mm: number | null;
  max_filament_slots: number;
};

export type PlateFootprint = {
  match_key: string;
  unit: number;
  filename: string;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  group_key?: string;
};

export type PlatePreview = {
  index: number;
  group_label: string;
  items: PlateFootprint[];
};

export type PrinterBedPreview = {
  printer_id: string;
  bed_width_mm: number;
  bed_depth_mm: number;
  margin_mm: number;
  plates: PlatePreview[];
};

export type PlateWorkspace = {
  profile_id: number;
  plan: PrintPlan;
  printers: PrinterMachine[];
  groups: PrintGroup[];
  preview: PrinterBedPreview[];
  unassigned_group_count: number;
  plate_count: number;
  warnings: string[];
};

export type PrintGroup = {
  group_key: string;
  filament_key: string;
  filament_label: string;
  filament_hex: string | null;
  repo: string;
  folder: string;
  part_count: number;
  label: string;
  printer_id: string | null;
  suggested_printer_name: string | null;
  warning: string | null;
};

export type RoleFilamentRow = {
  role: string;
  part_count: number;
  filament_color_id: string | null;
  spoolman_spool_id?: string | null;
  filament_custom_hex: string | null;
  filament_display: string;
  filament_hex: string | null;
};

export type SpoolmanSpoolRow = {
  id: number;
  filament_id: number;
  remaining_weight: number | null;
  location?: string | null;
};

export type PrintPlan = {
  enabled_printer_ids: string[];
  group_assignments?: Record<string, string>;
  plate_layout?: {
    spacing_mm: number;
    pool: Array<{ match_key: string; unit: number }>;
    printers: Array<{
      printer_id: string;
      plates: Array<Array<{ match_key: string; unit: number }>>;
      unassigned: Array<{ match_key: string; unit: number }>;
    }>;
  } | null;
};

/** @deprecated Use ReviewPart — checkoff data is merged into plan review. */
export type CheckoffPart = Pick<
  ReviewPart,
  | "id"
  | "filename"
  | "match_key"
  | "relative_path"
  | "source_layer"
  | "role"
  | "quantity_effective"
  | "printed_count"
  | "print_units"
  | "missing"
  | "filament_display"
  | "filament_hex"
>;

export type CustomFilament = {
  id: string;
  color_id: string;
  display_name: string;
  hex: string;
  product_line: string;
  notes: string;
  created_at: string;
};

export type Export3mfOptions = {
  profile_id: number;
  layout_mode?: string;
  spacing_mm?: number;
  missing_only?: boolean;
  enabled_printer_ids?: string[];
};

export type ExportStlPackOptions = {
  profile_id: number;
  missing_only?: boolean;
};

export async function engineBaseUrl(): Promise<string> {
  return API_BASE;
}

async function engineFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(resolveEngineUrl(path), { ...init, headers });
  if (!res.ok) {
    throw new Error(`Engine ${path} failed: ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const snippet = (await res.text()).trimStart().slice(0, 40);
    if (snippet.startsWith("<!") || snippet.toLowerCase().startsWith("<html")) {
      throw new Error(
        `Engine ${path} returned HTML instead of JSON — check API route and dev proxy`,
      );
    }
    throw new Error(`Engine ${path} expected JSON but got ${contentType || "unknown type"}`);
  }
  return res.json() as Promise<T>;
}

async function engineFetchText(path: string): Promise<string> {
  const res = await fetch(resolveEngineUrl(path));
  if (!res.ok) {
    throw new Error(`Engine ${path} failed: ${res.status}`);
  }
  return res.text();
}

export async function fetchHealth(): Promise<HealthResponse> {
  return engineFetch<HealthResponse>("/health");
}

export async function fetchAppUpdateCheck(refresh = false): Promise<AppUpdateCheckResponse> {
  const suffix = refresh ? "?refresh=1" : "";
  return engineFetch<AppUpdateCheckResponse>(`/settings/update-check${suffix}`);
}

export async function fetchProfiles(): Promise<ProfileSummary[]> {
  const body = await engineFetch<{ profiles: ProfileSummary[] }>("/plans");
  return body.profiles;
}

export async function fetchSources(): Promise<SourceSummary[]> {
  const body = await engineFetch<{ sources: SourceSummary[] }>("/sources");
  return body.sources;
}

export type GithubBranchesResponse = {
  owner: string;
  repo: string;
  default_branch: string;
  branches: string[];
};

export async function fetchGithubBranches(url: string): Promise<GithubBranchesResponse> {
  const base = await engineBaseUrl();
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("GitHub repository URL is required");
  }
  const endpoint = new URL("/sources/github-branches", base);
  endpoint.searchParams.set("url", trimmed);
  const res = await fetch(endpoint.toString());
  if (!res.ok) {
    let detail = `Could not list branches (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) {
        detail = body.detail;
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<GithubBranchesResponse>;
}

export async function fetchSourceHasManifest(
  sourceId: number,
): Promise<{ has_manifest: boolean; manifest_kind: string | null }> {
  return engineFetch(`/sources/${sourceId}/has-manifest`);
}

export async function createProfile(
  name: string,
  baseProjectId?: number,
): Promise<ProfileSummary & { layers?: ProfileLayer[] }> {
  return engineFetch("/plans", {
    method: "POST",
    body: JSON.stringify({
      name,
      ...(baseProjectId != null ? { base_project_id: baseProjectId } : {}),
    }),
  });
}

export async function updateProfile(
  profileId: number,
  name: string,
): Promise<ProfileSummary> {
  return engineFetch(`/plans/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteProfile(profileId: number): Promise<void> {
  await engineFetch(`/plans/${profileId}`, { method: "DELETE" });
}

export async function duplicateProfile(
  profileId: number,
  name: string,
  options?: { clearCheckoff?: boolean },
): Promise<ProfileSummary & { layers?: ProfileLayer[] }> {
  return engineFetch(`/plans/${profileId}/duplicate`, {
    method: "POST",
    body: JSON.stringify({ name, clear_checkoff: options?.clearCheckoff ?? false }),
  });
}

export async function setProfileBaseLayer(
  profileId: number,
  projectId: number,
): Promise<ProfileLayer[]> {
  const body = await engineFetch<{ layers: ProfileLayer[] }>(
    `/plans/${profileId}/layers/base`,
    {
      method: "PUT",
      body: JSON.stringify({ project_id: projectId }),
    },
  );
  return body.layers;
}

export async function deleteProfileLayer(
  profileId: number,
  layerId: number,
): Promise<void> {
  await engineFetch(`/plans/${profileId}/layers/${layerId}`, {
    method: "DELETE",
  });
}

function mergeSourceMetadata(
  metadata: Record<string, unknown> | undefined,
  category: string | null | undefined,
): Record<string, unknown> | undefined {
  if (category === undefined) return metadata;
  const base = { ...(metadata ?? {}) };
  if (category == null || category === "") {
    delete base.category;
  } else {
    base.category = category;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

export async function fetchSourceCategories(): Promise<string[]> {
  const body = await engineFetch<{ categories: string[] }>(
    "/settings/source-categories",
  );
  return body.categories;
}

export async function saveSourceCategories(categories: string[]): Promise<string[]> {
  const body = await engineFetch<{ categories: string[] }>(
    "/settings/source-categories",
    {
      method: "PUT",
      body: JSON.stringify({ categories }),
    },
  );
  return body.categories;
}

export async function searchSourceStls(
  q: string,
  limit = 50,
): Promise<StlSearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return engineFetch<StlSearchResponse>(`/sources/stl-search?${params}`);
}

export async function createSource(body: {
  name: string;
  url?: string;
  branch?: string;
  source_kind: string;
  role?: string;
  category?: string | null;
  local_path?: string;
  metadata?: Record<string, unknown>;
}): Promise<SourceSummary> {
  const { category, metadata, ...rest } = body;
  const payload = {
    ...rest,
    metadata: mergeSourceMetadata(metadata, category),
  };
  return engineFetch<SourceSummary>("/sources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateSource(
  sourceId: number,
  fields: Partial<{
    name: string;
    url: string;
    branch: string;
    source_kind: string;
    role: string;
    category: string | null;
    local_path: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<SourceSummary> {
  const { category, metadata, ...rest } = fields;
  const payload = {
    ...rest,
    ...(category !== undefined
      ? { metadata: mergeSourceMetadata(metadata, category) }
      : metadata !== undefined
        ? { metadata }
        : {}),
  };
  return engineFetch<SourceSummary>(`/sources/${sourceId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteSource(sourceId: number): Promise<void> {
  await engineFetch(`/sources/${sourceId}`, { method: "DELETE" });
}

export async function fetchImportRules(sourceId: number): Promise<{
  rules: string[];
  legacy_import_all: boolean;
}> {
  return engineFetch(`/sources/${sourceId}/import-rules`);
}

export async function saveImportRules(
  sourceId: number,
  rules: string[],
): Promise<{ rules: string[] }> {
  return engineFetch(`/sources/${sourceId}/import-rules`, {
    method: "PUT",
    body: JSON.stringify({ rules }),
  });
}

export type StlTreeFileNode = {
  kind: "file";
  path: string;
  name: string;
  checked: boolean;
};

export type StlTreeFolderNode = {
  kind: "folder";
  path: string;
  name: string;
  check_state: "checked" | "unchecked" | "partial";
  children: StlTreeNode[];
};

export type StlTreeNode = StlTreeFileNode | StlTreeFolderNode;

export type StlTreeResponse = {
  project_id: number;
  legacy_import_all: boolean;
  total: number;
  selected: number;
  nodes: StlTreeNode[];
};

export async function fetchStlTree(sourceId: number): Promise<StlTreeResponse> {
  return engineFetch(`/sources/${sourceId}/stl-tree`);
}

export type PartsGroup = {
  folder: string;
  parts: PartRow[];
};

export async function fetchProfilePartsGrouped(
  profileId: number,
  query = "",
): Promise<{ groups: PartsGroup[]; total: number }> {
  const q = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  const body = await engineFetch<{ groups: PartsGroup[]; total: number }>(
    `/plans/${profileId}/parts-grouped${q}`,
  );
  return body;
}

export async function replaceProfileLayer(
  profileId: number,
  layerId: number,
  projectId: number,
): Promise<ProfileLayer[]> {
  const body = await engineFetch<{ layers: ProfileLayer[] }>(
    `/plans/${profileId}/layers/${layerId}`,
    {
      method: "PUT",
      body: JSON.stringify({ project_id: projectId }),
    },
  );
  return body.layers;
}

export type CommunityExportDraft = {
  slug: string;
  manifest_yaml: string;
  meta_yaml: string;
  issue_body: string;
};

export async function exportCommunityManifestDraft(
  projectId: number,
  slug: string,
): Promise<CommunityExportDraft> {
  return engineFetch("/manifest-registry/export-draft", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, slug }),
  });
}

export async function startImportScan(projectId: number): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/import-scan", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }),
  });
  return body.job_id;
}

/** Upload a shared kit bundle from the user's computer (web / Docker). */
export async function uploadKitBundle(
  file: File,
  newName?: string,
): Promise<KitImportJobResult> {
  const form = new FormData();
  form.append("file", file);
  if (newName?.trim()) form.append("new_name", newName.trim());
  const res = await fetch(resolveEngineUrl("/imports/kit-bundle"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = `Import failed: ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<KitImportJobResult>;
}

/** Pick a kit bundle file in the browser. */
export async function pickKitBundle(): Promise<File | null> {
  return pickKitBundleFileWeb();
}

/** Import a shared kit bundle via browser file upload. */
export async function importKitBundle(file: File): Promise<KitImportJobResult> {
  return uploadKitBundle(file);
}

export async function startExportKitBundle(
  profileId: number,
  includePrintProgress = false,
): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/export-kit-bundle", {
    method: "POST",
    body: JSON.stringify({
      profile_id: profileId,
      include_print_progress: includePrintProgress,
    }),
  });
  return body.job_id;
}

export async function fetchPrintGroups(profileId: number): Promise<PrintGroup[]> {
  const body = await engineFetch<{ groups: PrintGroup[] }>(
    `/plans/${profileId}/print-groups`,
  );
  return body.groups;
}

export async function savePrintAssignments(
  profileId: number,
  assignments: Record<string, string>,
): Promise<{ plan: PrintPlan; groups: PrintGroup[] }> {
  return engineFetch(`/plans/${profileId}/print-assignments`, {
    method: "PUT",
    body: JSON.stringify({ assignments }),
  });
}

export async function savePrinterFleet(
  printers: PrinterMachine[],
): Promise<PrinterMachine[]> {
  const body = await engineFetch<{ printers: PrinterMachine[] }>("/printers", {
    method: "PUT",
    body: JSON.stringify({ printers }),
  });
  return body.printers;
}

export async function addPrinter(body: {
  name: string;
  bed_width_mm: number;
  bed_depth_mm: number;
}): Promise<PrinterMachine> {
  return engineFetch<PrinterMachine>("/printers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deletePrinter(printerId: string): Promise<void> {
  await engineFetch(`/printers/${printerId}`, { method: "DELETE" });
}

export async function pickLocalDirectory(): Promise<File[]> {
  return pickLocalDirectoryWeb();
}

export async function pickLocalFiles(): Promise<File[]> {
  return pickLocalFilesWeb();
}

export async function saveTextFile(
  defaultName: string,
  contents: string,
): Promise<string | null> {
  return saveTextFileWeb(defaultName, contents);
}

export async function fetchProfileLayers(
  profileId: number,
): Promise<ProfileLayer[]> {
  const body = await engineFetch<{ layers: ProfileLayer[] }>(
    `/plans/${profileId}/layers`,
  );
  return body.layers;
}

export async function addProfileAddonLayer(
  profileId: number,
  projectId: number,
): Promise<ProfileLayer[]> {
  const body = await engineFetch<{ layers: ProfileLayer[] }>(
    `/plans/${profileId}/layers`,
    {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    },
  );
  return body.layers;
}

export async function patchPart(
  partId: number,
  fields: {
    included?: boolean;
    filament_color_id?: string;
    quantity_override?: number;
    spoolman_spool_id?: string | null;
  },
): Promise<PartRow> {
  return engineFetch<PartRow>(`/parts/${partId}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

/**
 * Trigger a browser download for a server-produced export. `downloadUrl` is the
 * `download_url` returned by export jobs (e.g. "/exports/<key>"); the server
 * serves it with Content-Disposition: attachment.
 */
export function downloadExport(downloadUrl: string, suggestedName?: string): void {
  if (typeof document === "undefined") return;
  const href = /^https?:\/\//i.test(downloadUrl)
    ? downloadUrl
    : resolveEngineUrl(downloadUrl);
  const anchor = document.createElement("a");
  anchor.href = href;
  if (suggestedName) anchor.download = suggestedName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function fetchLegalDocument(
  name: "summary" | "license" | "attribution" | "third-party",
): Promise<string> {
  return engineFetchText(`/legal/${name}`);
}

export async function fetchCustomFilaments(): Promise<CustomFilament[]> {
  const body = await engineFetch<{ filaments: CustomFilament[] }>("/filaments/custom");
  return body.filaments;
}

async function v1Fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return engineFetch<T>(`/api/v1${normalized}`, init);
}

export async function fetchIntegrations(): Promise<IntegrationSummary[]> {
  const body = await v1Fetch<{ integrations: IntegrationSummary[] }>("/integrations");
  return body.integrations;
}

export async function createIntegration(body: {
  type: string;
  name: string;
  config: Record<string, unknown>;
}): Promise<IntegrationSummary> {
  return v1Fetch<IntegrationSummary>("/integrations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateIntegration(
  id: string,
  body: { name?: string; config?: Record<string, unknown> },
): Promise<IntegrationSummary> {
  return v1Fetch<IntegrationSummary>(`/integrations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteIntegration(id: string): Promise<void> {
  await v1Fetch(`/integrations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function testIntegration(id: string): Promise<IntegrationTestResult> {
  return v1Fetch<IntegrationTestResult>(`/integrations/${encodeURIComponent(id)}/test`, {
    method: "POST",
  });
}

export async function fetchSpoolmanDefaultSettings(): Promise<SpoolmanDefaultSettings> {
  return engineFetch<SpoolmanDefaultSettings>("/settings/spoolman-default");
}

export async function saveSpoolmanDefaultIntegration(
  integrationId: string | null,
): Promise<SpoolmanDefaultSettings> {
  return engineFetch<SpoolmanDefaultSettings>("/settings/spoolman-default", {
    method: "PUT",
    body: JSON.stringify({ integration_id: integrationId }),
  });
}

export async function fetchFilamentCatalog(): Promise<FilamentCatalog> {
  return engineFetch<FilamentCatalog>("/filaments/catalog");
}

export async function fetchWorkflowGuide(): Promise<string> {
  return engineFetchText("/help/workflow");
}

export async function createCustomFilament(body: {
  display_name: string;
  hex: string;
  product_line?: string;
}): Promise<CustomFilament> {
  return engineFetch<CustomFilament>("/filaments/custom", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteCustomFilament(filamentId: string): Promise<void> {
  await engineFetch(`/filaments/custom/${encodeURIComponent(filamentId)}`, {
    method: "DELETE",
  });
}

export type RepoManifestPartRule = {
  match: string;
  requirement?: string;
  change?: string;
  replaces?: string;
  replaces_slot?: string;
  default_included?: boolean;
  option_group?: string;
  slot?: string;
};

export type RepoManifestSlot = {
  label?: string;
  default_group?: string;
};

export type RepoManifestVariantSource = {
  source_id: number;
  source_name: string;
};

export type RepoManifestVariant = {
  id: string;
  label?: string;
  parts?: string[];
  excludes?: string[];
  source_id?: number;
  source_name?: string;
  sources?: RepoManifestVariantSource[];
};

export type RepoManifestOptionGroup = {
  rule: string;
  label?: string;
  parts?: Array<{ match: string } | string>;
  variants?: RepoManifestVariant[];
  min?: number;
  max?: number;
};

export type RepoManifestDocument = {
  format?: string;
  version?: number;
  project?: string;
  plan?: {
    name?: string;
    base_source_id?: string;
    addon_source_ids?: string[];
  };
  sources?: Array<{
    id: string;
    kind: string;
    url?: string;
    branch?: string;
    role?: string;
  }>;
  selections?: Record<string, string>;
  option_groups?: Record<string, RepoManifestOptionGroup>;
  slots?: Record<string, RepoManifestSlot>;
  parts?: RepoManifestPartRule[];
  addons?: Array<Record<string, unknown>>;
  choice_tree?: ChoiceTreeNode[];
};

export type ScannedManifestPart = {
  match: string;
  relative_path: string;
};

export type ManifestBuilderBootstrap = {
  source_id: number;
  source: {
    id: number;
    name: string;
    url: string;
    source_kind: string | null;
    role: string;
    local_path: string | null;
  };
  exists: boolean;
  manifest_kind: string | null;
  yaml: string;
  document: RepoManifestDocument;
  scanned_parts: ScannedManifestPart[];
  path: string;
};

export async function fetchRepoManifest(sourceId: number): Promise<{
  source_id: number;
  path: string;
  exists: boolean;
  manifest_kind: string | null;
  yaml: string;
  document: RepoManifestDocument;
}> {
  return engineFetch(`/sources/${sourceId}/repo-manifest`);
}

export async function putRepoManifest(
  sourceId: number,
  body: { yaml?: string; document?: RepoManifestDocument },
): Promise<{
  source_id: number;
  path: string;
  saved: boolean;
  yaml: string;
  document: RepoManifestDocument;
}> {
  return engineFetch(`/sources/${sourceId}/repo-manifest`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function fetchManifestBuilder(
  sourceId: number,
): Promise<ManifestBuilderBootstrap> {
  return engineFetch(`/sources/${sourceId}/manifest-builder`);
}

export async function generateManifestDraft(sourceId: number): Promise<{
  project_id: number;
  part_count: number;
  yaml: string;
}> {
  return engineFetch(`/sources/${sourceId}/manifest-draft`, { method: "POST" });
}

/**
 * URL for a part thumbnail. The optional `hex` and `cacheVersion` are appended
 * only as cache-busting query params (the server keys cached PNGs by the part's
 * stored filament color, not the query string). This makes a color change — or
 * a manual "Regenerate thumbnails" bump — produce a distinct URL so the browser
 * does not serve a stale cached image.
 */
export async function partThumbnailUrl(
  partId: number,
  opts?: { hex?: string | null; cacheVersion?: number },
): Promise<string> {
  const base = resolveEngineUrl(`/parts/${partId}/thumbnail`);
  const params = new URLSearchParams();
  if (opts?.hex) params.set("hex", opts.hex);
  if (opts?.cacheVersion) params.set("v", String(opts.cacheVersion));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Clear cached thumbnail/preview PNGs for every part in a plan so they
 * regenerate from the current filament colors. Returns how many cached files
 * were removed on the server.
 */
export async function regeneratePlanThumbnails(
  profileId: number,
): Promise<{ cleared: number }> {
  return engineFetch(`/plans/${profileId}/regenerate-thumbnails`, {
    method: "POST",
  });
}

/** Upload a client-rendered PNG thumbnail after Preview3D renders (optional cache). */
export async function uploadPartThumbnail(partId: number, pngBlob: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", pngBlob, "thumbnail.png");
  const res = await fetch(resolveEngineUrl(`/parts/${partId}/thumbnail`), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Thumbnail upload failed: ${res.status}`);
  }
}

/** Cached cover image for a source (GitHub social preview, Printables og:image, README, etc.). */
export async function sourceCoverUrl(sourceId: number): Promise<string> {
  return resolveEngineUrl(`/sources/${sourceId}/cover`);
}

export async function partPreviewUrl(partId: number): Promise<string> {
  return resolveEngineUrl(`/parts/${partId}/preview`);
}

export async function partMeshUrl(partId: number): Promise<string> {
  return resolveEngineUrl(`/parts/${partId}/mesh`);
}

function encodeStlRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Mesh bytes for an STL under a synced source (before plan recompute). */
export async function sourceStlMeshUrl(sourceId: number, relativePath: string): Promise<string> {
  return resolveEngineUrl(`/sources/${sourceId}/stl/${encodeStlRelativePath(relativePath)}/mesh`);
}

/** PNG preview for an STL under a synced source (before plan recompute). */
export async function sourceStlPreviewUrl(sourceId: number, relativePath: string): Promise<string> {
  return resolveEngineUrl(`/sources/${sourceId}/stl/${encodeStlRelativePath(relativePath)}/preview`);
}

export type GitHubPatSettings = {
  configured: boolean;
  masked: string | null;
};

export async function fetchGitHubPatSettings(): Promise<GitHubPatSettings> {
  return engineFetch<GitHubPatSettings>("/settings/github-pat");
}

export async function saveGitHubPat(token: string): Promise<GitHubPatSettings> {
  return engineFetch<GitHubPatSettings>("/settings/github-pat", {
    method: "PUT",
    body: JSON.stringify({ token }),
  });
}

export type StlNamingRoleId = "primary" | "accent" | "clear" | "opaque";

export type StlNamingRole = {
  id: StlNamingRoleId;
  label: string;
  markers: string[];
};

export type StlNamingFolderRule = {
  path_contains: string;
  role_id: StlNamingRoleId;
};

export type StlNamingProfile = {
  roles: StlNamingRole[];
  quantity: {
    regex: string;
    default: number;
  };
  slug: {
    strip_markers: boolean;
    strip_quantity: boolean;
  };
  folder_rules: StlNamingFolderRule[];
  export_role_order: StlNamingRoleId[];
};

export type StlNamingPreviewResult = {
  role: StlNamingRoleId;
  quantity: number;
  part_slug: string;
};

export type SourceNamingSettings = {
  use_defaults: boolean;
  override: Partial<StlNamingProfile>;
  effective: StlNamingProfile;
};

export const DEFAULT_STL_NAMING_PROFILE: StlNamingProfile = {
  roles: [
    { id: "primary", label: "Primary", markers: [] },
    { id: "accent", label: "Accent", markers: ["[a]"] },
    { id: "clear", label: "Clear", markers: ["[c]"] },
    { id: "opaque", label: "Opaque", markers: ["[o]"] },
  ],
  quantity: {
    regex: String.raw`[ _]x([0-9]+)\.stl$`,
    default: 1,
  },
  slug: {
    strip_markers: true,
    strip_quantity: true,
  },
  folder_rules: [],
  export_role_order: ["primary", "accent", "clear", "opaque"],
};

export const DEFAULT_QUANTITY_REGEX = DEFAULT_STL_NAMING_PROFILE.quantity.regex;

export function mergeStlNamingProfiles(
  base: StlNamingProfile,
  override: Partial<StlNamingProfile> | undefined,
): StlNamingProfile {
  if (!override) return base;
  return {
    roles: override.roles ?? base.roles,
    quantity: override.quantity ? { ...base.quantity, ...override.quantity } : base.quantity,
    slug: override.slug ? { ...base.slug, ...override.slug } : base.slug,
    folder_rules: override.folder_rules ?? base.folder_rules,
    export_role_order: override.export_role_order ?? base.export_role_order,
  };
}

export async function fetchStlNaming(): Promise<StlNamingProfile> {
  const body = await engineFetch<{ profile: StlNamingProfile }>("/settings/stl-naming");
  return body.profile;
}

export async function saveStlNaming(profile: StlNamingProfile): Promise<StlNamingProfile> {
  const body = await engineFetch<{ profile: StlNamingProfile }>("/settings/stl-naming", {
    method: "PUT",
    body: JSON.stringify({ profile }),
  });
  return body.profile;
}

export async function previewStlNaming(body: {
  relative_path: string;
  profile?: Partial<StlNamingProfile> | StlNamingProfile;
}): Promise<StlNamingPreviewResult> {
  return engineFetch<StlNamingPreviewResult>("/settings/stl-naming/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchSourceNaming(sourceId: number): Promise<SourceNamingSettings> {
  return engineFetch<SourceNamingSettings>(`/sources/${sourceId}/naming`);
}

export async function saveSourceNaming(
  sourceId: number,
  body: { use_defaults: boolean; override: Partial<StlNamingProfile> },
): Promise<SourceNamingSettings> {
  return engineFetch<SourceNamingSettings>(`/sources/${sourceId}/naming`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export type ReportIssueResult = {
  created: boolean;
  issue_url?: string;
  prefilled_url?: string;
};

export async function reportManifestIssue(body: {
  profile_id: number;
  title?: string;
  details?: string;
}): Promise<ReportIssueResult> {
  return engineFetch<ReportIssueResult>("/community/report-issue", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ManifestRegistryEntry = {
  slug: string;
  target_repo: string;
  title: string | null;
  manifest_file: string;
};

export type KitCatalogBase = {
  label: string;
  source_name: string;
  compatible_addons: string[];
  printer_family?: string;
  default_addons?: string[];
};

export type KitCatalogSourceEntry = {
  name: string;
  variant_id?: string;
  compatible_bases?: string[];
};

export type KitCatalogCategory = {
  label: string;
  rule: string;
  replaces_slot?: string;
  sources: KitCatalogSourceEntry[];
};

export type KitCatalogStackPreset = {
  label: string;
  base: string;
  addon_sources: string[];
  default_selections?: Record<string, string>;
};

export type KitCatalog = {
  version: number;
  bases: Record<string, KitCatalogBase>;
  addon_categories: Record<string, KitCatalogCategory>;
  stack_presets?: Record<string, KitCatalogStackPreset>;
};

export async function fetchKitCatalog(): Promise<KitCatalog> {
  return engineFetch<KitCatalog>("/kit-catalog");
}

export type SourcesMaintenanceReport = {
  no_manifest: Array<{ id: number; name: string }>;
  catalog_orphans: string[];
  empty_categories: Array<{ id: string; label: string }>;
  drift: Array<{
    source_id: number;
    name: string;
    unmatched: number;
    missing: number;
  }>;
};

export async function fetchSourcesMaintenance(): Promise<SourcesMaintenanceReport> {
  return engineFetch<SourcesMaintenanceReport>("/sources/maintenance");
}

export type ImportReposTxtResult = {
  created: number;
  updated: number;
  skipped: number;
  skipped_names: string[];
  results: Array<{
    name: string;
    action: string;
    role?: string;
    source_id?: number;
  }>;
};

export type PlanMaintenanceEntry = {
  profile_id: number;
  name: string;
  warning_count: number;
  warnings: ManifestWarning[];
};

export type PlansMaintenanceReport = {
  plans_with_warnings: PlanMaintenanceEntry[];
};

export async function fetchPlansMaintenance(): Promise<PlansMaintenanceReport> {
  return engineFetch<PlansMaintenanceReport>("/plans/maintenance");
}

const JOB_TERMINAL = new Set(["done", "error", "cancelled"]);

export async function waitForJobDone(jobId: string): Promise<JobSnapshot> {
  for (;;) {
    const snap = await fetchJob(jobId);
    if (JOB_TERMINAL.has(snap.status)) return snap;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

export async function importReposTxt(body: {
  text?: string;
}): Promise<ImportReposTxtResult> {
  return engineFetch<ImportReposTxtResult>("/sources/import-repos-txt", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ManifestTemplateSummary = {
  id: string;
  label: string;
  category: string;
  available: string;
};

export type ManifestTemplatePayload = {
  id: string;
  label: string;
  category: string;
  yaml: string;
  document: RepoManifestDocument;
};

export async function fetchManifestTemplates(): Promise<ManifestTemplateSummary[]> {
  const body = await engineFetch<{ templates: ManifestTemplateSummary[] }>(
    "/manifest-templates",
  );
  return body.templates;
}

export async function fetchManifestTemplate(
  templateId: string,
): Promise<ManifestTemplatePayload> {
  return engineFetch<ManifestTemplatePayload>(`/manifest-templates/${templateId}`);
}

export async function fetchManifestRegistry(): Promise<ManifestRegistryEntry[]> {
  const body = await engineFetch<{ entries: ManifestRegistryEntry[] }>(
    "/manifest-registry",
  );
  return body.entries;
}

export async function fetchCommunityManifest(slug: string): Promise<{
  slug: string;
  yaml: string;
  document: RepoManifestDocument;
}> {
  return engineFetch(`/manifest-registry/${encodeURIComponent(slug)}`);
}

export async function fetchProfileParts(profileId: number): Promise<PartRow[]> {
  const body = await engineFetch<{ parts: PartRow[] }>(
    `/plans/${profileId}/parts?limit=10000`,
  );
  return body.parts;
}

export async function fetchManifestSummary(
  profileId: number,
): Promise<ManifestSummary> {
  return engineFetch<ManifestSummary>(
    `/plans/${profileId}/manifest-summary`,
  );
}

export async function fetchManifestWarnings(
  profileId: number,
): Promise<ManifestWarning[]> {
  const body = await engineFetch<{ warnings: ManifestWarning[] }>(
    `/plans/${profileId}/manifest-warnings`,
  );
  return body.warnings;
}

export async function startRecompute(
  profileId: number,
  options?: { apply_manifest?: boolean },
): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/recompute", {
    method: "POST",
    body: JSON.stringify({
      profile_id: profileId,
      apply_manifest: options?.apply_manifest ?? false,
    }),
  });
  return body.job_id;
}

export type PlanReviewIssue = {
  code: string;
  message: string;
  severity: "blocker" | "warning";
  link_hint?: "sources" | "build" | null;
};

export type PlanReviewLayer = {
  id: number;
  layer_type: string;
  project_id: number | null;
  project_name: string | null;
  local_path: string | null;
  synced: boolean;
  last_synced_at: string | null;
};

export type PlanReviewTotals = {
  included_parts: number;
  total_print_units: number;
  by_role: Record<string, number>;
  by_filament: Record<string, number>;
};

/** Plan part row with print progress (unified Review API). */
export type ReviewPart = PartRow & {
  printed_count: number;
  print_units: boolean[];
  missing: boolean;
  filament_display: string;
  filament_hex?: string | null;
  spool_summary?: Array<{ remaining_g: number; spool_id: number }>;
  spool_badge?: string | null;
};

export type PlanReviewPartGroup = {
  folder: string;
  source_layer: string | null;
  parts: ReviewPart[];
};

export type PlanReview = {
  profile_id: number;
  plan_name: string;
  layers: PlanReviewLayer[];
  totals: PlanReviewTotals;
  issues: PlanReviewIssue[];
  has_blockers: boolean;
  part_groups: PlanReviewPartGroup[];
};

export async function fetchPlanReview(
  profileId: number,
  options?: { includeExcluded?: boolean },
): Promise<PlanReview> {
  const qs =
    options?.includeExcluded === true ? "?include_excluded=true" : "";
  return engineFetch<PlanReview>(`/plans/${profileId}/review${qs}`);
}

export type KitBundleUnmatchedSource = {
  name: string;
  url?: string;
  branch?: string;
  source_kind?: string;
  role?: string;
  import_rules?: string[];
  manifest_community_slug?: string | null;
  /** Which layer slot this source filled in the shared plan (base/addon). */
  layer_type?: string;
};

export type KitImportJobResult = {
  profile_id: number;
  profile_name: string;
  parts_imported: number;
  layers_imported: number;
  /** Legacy import result */
  unmatched_projects?: string[];
  /** v3 share bundle — repos not matched locally */
  unmatched_sources?: KitBundleUnmatchedSource[];
  warnings?: string[];
};

export async function startSync(projectIds?: number[]): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/sync", {
    method: "POST",
    body: JSON.stringify(
      projectIds && projectIds.length ? { project_ids: projectIds } : {},
    ),
  });
  return body.job_id;
}

export async function fetchSourceUpdateCheckSettings(): Promise<SourceUpdateCheckSettings> {
  return engineFetch<SourceUpdateCheckSettings>("/settings/source-update-check");
}

export async function saveSourceUpdateCheckInterval(
  intervalHours: number,
): Promise<SourceUpdateCheckSettings> {
  return engineFetch<SourceUpdateCheckSettings>("/settings/source-update-check", {
    method: "PUT",
    body: JSON.stringify({ interval_hours: intervalHours }),
  });
}

export async function startCheckSourceUpdates(): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/check-source-updates", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return body.job_id;
}

export async function fetchPrinterPresets(): Promise<PrinterPreset[]> {
  const body = await engineFetch<{ presets: PrinterPreset[] }>("/printer-presets");
  return body.presets;
}

export async function fetchPlateWorkspace(profileId: number): Promise<PlateWorkspace> {
  return engineFetch<PlateWorkspace>(`/plans/${profileId}/plate-workspace`);
}

export type PackPreviewOptions = {
  profile_id: number;
  enabled_printer_ids?: string[];
  assignments?: Record<string, string>;
  auto_assign?: boolean;
  spacing_mm?: number;
};

export async function startPackPreview(options: PackPreviewOptions): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/pack-preview", {
    method: "POST",
    body: JSON.stringify(options),
  });
  return body.job_id;
}

export async function startExportStlPack(
  profileId: number,
  options?: Pick<ExportStlPackOptions, "missing_only">,
): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/export-stl-pack", {
    method: "POST",
    body: JSON.stringify({
      profile_id: profileId,
      missing_only: options?.missing_only ?? false,
    }),
  });
  return body.job_id;
}

export async function fetchPrinters(): Promise<PrinterMachine[]> {
  const body = await engineFetch<{ printers: PrinterMachine[] }>("/printers");
  return body.printers;
}

export async function fetchPrintPlan(profileId: number): Promise<PrintPlan> {
  const body = await engineFetch<{ plan: PrintPlan }>(
    `/plans/${profileId}/print-plan`,
  );
  return body.plan;
}

export async function savePrintPlan(
  profileId: number,
  plan: Partial<PrintPlan>,
): Promise<PrintPlan> {
  const body = await engineFetch<{ plan: PrintPlan }>(
    `/plans/${profileId}/print-plan`,
    {
      method: "PUT",
      body: JSON.stringify(plan),
    },
  );
  return body.plan;
}

export async function fetchRoleFilaments(profileId: number): Promise<RoleFilamentRow[]> {
  const body = await engineFetch<{ roles: RoleFilamentRow[] }>(
    `/plans/${profileId}/role-filaments`,
  );
  return body.roles;
}

export async function saveRoleFilament(
  profileId: number,
  payload: {
    role: string;
    filament_color_id?: string | null;
    filament_custom_hex?: string | null;
    spoolman_spool_id?: string | null;
  },
): Promise<{ updated: number; roles: RoleFilamentRow[] }> {
  return engineFetch(`/plans/${profileId}/role-filament`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchSpoolmanSpools(integrationId: string): Promise<SpoolmanSpoolRow[]> {
  const body = await v1Fetch<{ spools: SpoolmanSpoolRow[] }>(
    `/integrations/${encodeURIComponent(integrationId)}/spoolman/spools`,
  );
  return body.spools;
}

export async function prepareMissingPrintPlan(profileId: number): Promise<{
  copy_count: number;
  plan: PrintPlan;
}> {
  return engineFetch(`/plans/${profileId}/print-plan/prepare-missing`, {
    method: "POST",
    body: "{}",
  });
}

export async function fetchCheckoff(profileId: number): Promise<{
  summary: string;
  parts: CheckoffPart[];
}> {
  return engineFetch(`/plans/${profileId}/checkoff`);
}

export async function patchPartProgress(
  partId: number,
  unitIndex: number,
  completed: boolean,
): Promise<{
  printed_count: number;
  print_units: boolean[];
  missing: boolean;
}> {
  return engineFetch(`/parts/${partId}/progress`, {
    method: "PATCH",
    body: JSON.stringify({ unit_index: unitIndex, completed }),
  });
}

export async function startExport3mf(options: Export3mfOptions): Promise<string> {
  const body = await engineFetch<{ job_id: string }>("/jobs/export-3mf", {
    method: "POST",
    body: JSON.stringify(options),
  });
  return body.job_id;
}

export async function startExportChecklistHtml(profileId: number): Promise<string> {
  const body = await engineFetch<{ job_id: string }>(
    "/jobs/export-checklist-html",
    {
      method: "POST",
      body: JSON.stringify({ profile_id: profileId }),
    },
  );
  return body.job_id;
}

export async function applyManifest(
  profileId: number,
  preserveIncluded = true,
): Promise<{ applied_rules: number; warnings: ManifestWarning[] }> {
  return engineFetch(`/plans/${profileId}/apply-manifest`, {
    method: "POST",
    body: JSON.stringify({ preserve_included: preserveIncluded }),
  });
}

export async function fetchManifestV2(profileId: number): Promise<ManifestV2> {
  return engineFetch<ManifestV2>(`/plans/${profileId}/manifest-v2`);
}

export async function fetchPlanManifestSummary(
  profileId: number,
): Promise<ManifestSummary> {
  return engineFetch<ManifestSummary>(`/plans/${profileId}/manifest-summary`);
}

export async function fetchPlanKitManifest(profileId: number): Promise<KitManifest> {
  const body = await engineFetch<{ kit: KitManifest }>(
    `/plans/${profileId}/kit-manifest`,
  );
  return body.kit;
}

export async function savePlanKitManifest(
  profileId: number,
  kit: KitManifest,
): Promise<KitManifest> {
  const body = await engineFetch<{ kit: KitManifest }>(
    `/plans/${profileId}/kit-manifest`,
    {
      method: "PUT",
      body: JSON.stringify({ kit }),
    },
  );
  return body.kit;
}

export async function fetchPlanLayers(profileId: number): Promise<ProfileLayer[]> {
  const body = await engineFetch<{ layers: ProfileLayer[] }>(
    `/plans/${profileId}/layers`,
  );
  return body.layers;
}

export async function fetchPlanParts(profileId: number): Promise<PartRow[]> {
  const body = await engineFetch<{ parts: PartRow[] }>(
    `/plans/${profileId}/parts?limit=10000`,
  );
  return body.parts;
}

export async function fetchPlanManifestWarnings(
  profileId: number,
): Promise<ManifestWarning[]> {
  const body = await engineFetch<{ warnings: ManifestWarning[] }>(
    `/plans/${profileId}/manifest-warnings`,
  );
  return body.warnings;
}

export async function fetchJob(jobId: string): Promise<JobSnapshot> {
  return engineFetch<JobSnapshot>(`/jobs/${jobId}`);
}

export function connectJobWebSocket(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  onError: (err: Error) => void,
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;

  void (async () => {
    try {
      const base = await engineBaseUrl();
      const origin =
        base ||
        (typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "");
      const url = origin.replace(/^http/, "ws") + `/ws/jobs/${jobId}`;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        onEvent(JSON.parse(ev.data as string) as JobEvent);
      };
      ws.onerror = () => {
        if (!closed) onError(new Error("WebSocket error"));
      };
      ws.onclose = () => {
        closed = true;
      };
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return () => {
    closed = true;
    ws?.close();
  };
}

export async function ensureEngineRunning(): Promise<void> {
  try {
    await fetchHealth();
  } catch {
    throw new Error("API server is not reachable. Start the server with `npm run dev` from web/.");
  }
}

export function formatSyncTime(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export async function importSourceArchive(
  sourceId: number,
  archive: File,
): Promise<
  SourceSummary & {
    imported_files?: number;
    stl_count?: number;
    suggested_import_rules?: string[];
  }
> {
  const form = new FormData();
  form.append("file", archive);
  const res = await fetch(resolveEngineUrl(`/sources/${sourceId}/upload-zip`), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = `Upload failed: ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<
    SourceSummary & {
      imported_files?: number;
      stl_count?: number;
      suggested_import_rules?: string[];
    }
  >;
}

export async function importSourceFiles(
  sourceId: number,
  files: File[],
): Promise<
  SourceSummary & {
    imported_files?: number;
    stl_count?: number;
    suggested_import_rules?: string[];
  }
> {
  if (!files.length) throw new Error("Select at least one file to upload");
  const form = new FormData();
  const relativePaths = files.map(
    (file) =>
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name,
  );
  form.append("relative_paths", JSON.stringify(relativePaths));
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch(resolveEngineUrl(`/sources/${sourceId}/upload-files`), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = `Upload failed: ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<
    SourceSummary & {
      imported_files?: number;
      stl_count?: number;
      suggested_import_rules?: string[];
    }
  >;
}

export async function fetchSourceDocs(
  sourceId: number,
): Promise<Array<{ path: string; title: string }>> {
  const body = await engineFetch<{ docs: Array<{ path: string; title: string }> }>(
    `/sources/${sourceId}/docs`,
  );
  return body.docs;
}

export async function fetchSourceDocMarkdown(
  sourceId: number,
  docPath: string,
): Promise<string> {
  const body = await engineFetch<{ markdown: string }>(
    `/sources/${sourceId}/docs/${docPath}`,
  );
  return body.markdown;
}

export async function pickZipArchive(): Promise<File | null> {
  return pickZipArchiveFileWeb();
}

export function shortSha(sha: string | null): string {
  if (!sha) return "—";
  return sha.slice(0, 7);
}
