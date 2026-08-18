import { basename, dirname, join } from "node:path";
import { rmSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { DATE_FORMAT_DEFAULT, type DateFormatId, type JobSnapshot } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import { exportDownloadKey, tenantExportDirectory } from "../lib/secure-path.js";
import { syncProjectById } from "./sources.js";
import {
  exportProfileStlPack,
  exportStlPackJobMessage,
  type StlPackGroupBy,
} from "../services/export-stl-pack.js";
import { zipDirectoryToFile } from "../services/zip-dir.js";
import { exportProfileHtml } from "../services/export-html.js";
import { exportKitBundle } from "../services/export-kit.js";
import { checkAllSourceUpdates } from "../services/source-update-check.js";
import { runExport3mfJob } from "../services/export-3mf-job.js";
import { runPackPreviewJob } from "../services/plate-workspace.js";
import { dispatchWebhooks } from "../services/webhook-store.js";
import { getRequestTenantId, tenantStorage } from "../middleware/tenant-context.js";
import { extractPendingPdfsForSource } from "../services/source-docs-index.js";
import { parseCheckoffUnits, parseUnlabeledNames } from "../services/printer-checkoff.js";
import { sendProblem } from "../lib/api-error.js";
import { getIntegrationAdapter } from "../integrations/registry.js";
import { getIntegrationConfig } from "../integrations/store.js";
import { loadFleet } from "../services/printer-fleet.js";
import { parsePrinterUploadMultipart } from "../services/printer-upload-multipart.js";
import { runPrinterUploadJob } from "../services/printer-upload-job.js";
import { reconcileSendQueueJobResult } from "../services/printer-send-queue.js";
import { runAutoSliceJob, autoSliceJobMessage } from "../services/auto-slice-job.js";

export type JobHandler = (
  jobId: string,
  emit: (event: Partial<JobSnapshot>) => void,
) => Promise<Record<string, unknown>>;

export type JobRunnerDeps = {
  getRepo: () => AppRepository;
  reposDir: string;
  exportsDir: string;
  dataDir: string;
  sourceDocsMaxBytes?: number;
};

export type JobListFilters = {
  status?: string;
  since?: string;
  profile_id?: number;
};

type JobMeta = {
  payload: Record<string, unknown>;
  tenantId: string;
  updatedAt: number;
};

export const COMPLETED_JOB_MAX = 1_000;
export const COMPLETED_JOB_GLOBAL_MAX = 10_000;
export const COMPLETED_JOB_RETENTION_MS = 24 * 60 * 60 * 1_000;
const EMPTY_TENANT_JOB_BUCKET = Symbol("empty-tenant-job-bucket");

export type JobRunnerOptions = {
  completedJobMax?: number;
  completedJobGlobalMax?: number;
  completedJobRetentionMs?: number;
};

export class InProcessJobRunner {
  private readonly jobs = new Map<string, JobSnapshot>();
  private readonly jobMeta = new Map<string, JobMeta>();
  private readonly listeners = new Map<string, Set<(event: JobSnapshot) => void>>();
  private readonly completedJobMax: number;
  private readonly completedJobGlobalMax: number;
  private readonly completedJobRetentionMs: number;

  constructor(
    private readonly deps: JobRunnerDeps,
    options: JobRunnerOptions = {},
  ) {
    this.completedJobMax = Math.max(
      1,
      Math.trunc(options.completedJobMax ?? COMPLETED_JOB_MAX),
    );
    this.completedJobGlobalMax = Math.max(
      1,
      Math.trunc(options.completedJobGlobalMax ?? COMPLETED_JOB_GLOBAL_MAX),
    );
    this.completedJobRetentionMs = Math.max(
      1,
      Math.trunc(options.completedJobRetentionMs ?? COMPLETED_JOB_RETENTION_MS),
    );
  }

  private get repo(): AppRepository {
    return this.deps.getRepo();
  }

  /** Used by multipart job routes that need to persist artifacts before start(). */
  getExportsDir(tenantId = getRequestTenantId()): string {
    return tenantExportDirectory(this.deps.exportsDir, tenantId);
  }

  getRepo(): AppRepository {
    return this.deps.getRepo();
  }

  subscribe(
    jobId: string,
    tenantId: string,
    listener: (event: JobSnapshot) => void,
  ): (() => void) | null {
    if (!this.isOwnedBy(jobId, tenantId)) return null;
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(listener);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(listener);
    };
  }

  private isOwnedBy(jobId: string, tenantId: string): boolean {
    return this.jobMeta.get(jobId)?.tenantId === tenantId;
  }

  private isTerminal(snapshot: JobSnapshot): boolean {
    return (
      snapshot.status === "done" ||
      snapshot.status === "error" ||
      snapshot.status === "cancelled"
    );
  }

  private deleteJob(jobId: string): void {
    this.jobs.delete(jobId);
    this.jobMeta.delete(jobId);
    this.listeners.delete(jobId);
  }

  private pruneCompletedJobs(now = Date.now()): void {
    const completed = [...this.jobs.entries()]
      .filter(([, snapshot]) => this.isTerminal(snapshot))
      .map(([jobId]) => {
        const meta = this.jobMeta.get(jobId);
        return {
          jobId,
          tenantId: meta?.tenantId,
          updatedAt: meta?.updatedAt ?? 0,
        };
      })
      .sort((a, b) => a.updatedAt - b.updatedAt);

    for (const item of completed) {
      if (now - item.updatedAt >= this.completedJobRetentionMs) {
        this.deleteJob(item.jobId);
      }
    }

    const retainedByTenant = new Map<string | symbol, typeof completed>();
    for (const item of completed) {
      if (!this.jobs.has(item.jobId)) continue;
      const tenantBucket = item.tenantId || EMPTY_TENANT_JOB_BUCKET;
      const retained = retainedByTenant.get(tenantBucket) ?? [];
      retained.push(item);
      retainedByTenant.set(tenantBucket, retained);
    }
    for (const retained of retainedByTenant.values()) {
      while (retained.length > this.completedJobMax) {
        this.deleteJob(retained.shift()!.jobId);
      }
    }

    const retainedGlobally = completed.filter((item) => this.jobs.has(item.jobId));
    while (retainedGlobally.length > this.completedJobGlobalMax) {
      this.deleteJob(retainedGlobally.shift()!.jobId);
    }
  }

  private touchMeta(jobId: string): void {
    const meta = this.jobMeta.get(jobId);
    if (meta) meta.updatedAt = Date.now();
  }

  private emit(jobId: string, patch: Partial<JobSnapshot>): void {
    const snap = this.jobs.get(jobId);
    if (!snap) return;
    Object.assign(snap, patch);
    this.touchMeta(jobId);
    const event = { ...snap, updated_at: new Date().toISOString() } as JobSnapshot & {
      updated_at?: string;
    };
    for (const listener of this.listeners.get(jobId) ?? []) {
      listener(event);
    }
    if (event.status === "done" || event.status === "error") {
      void dispatchWebhooks(this.repo, event.status === "done" ? "job.done" : "job.error", {
        job_id: event.job_id,
        kind: event.kind,
        status: event.status,
        result: event.result,
        error: event.error,
      });
      // Fire plan.exported for any export job that completes successfully.
      const EXPORT_KINDS = new Set([
        "export-stl-pack",
        "export-checklist-html",
        "export-kit-bundle",
        "export-3mf",
      ]);
      if (event.status === "done" && EXPORT_KINDS.has(event.kind)) {
        const meta = this.jobMeta.get(jobId);
        void dispatchWebhooks(this.repo, "plan.exported", {
          job_id: event.job_id,
          kind: event.kind,
          profile_id: meta?.payload.profile_id ?? null,
          download_url: (event.result as Record<string, unknown> | null)?.download_url ?? null,
        });
      }
      this.pruneCompletedJobs();
    }
  }

  async start(
    kind: string,
    payload: Record<string, unknown>,
    tenantId = "default",
  ): Promise<string> {
    this.pruneCompletedJobs();
    const jobId = crypto.randomUUID();
    const snap: JobSnapshot = {
      job_id: jobId,
      kind,
      status: "pending",
      message: "Queued",
      progress: 0,
      result: null,
      error: null,
    };
    this.jobs.set(jobId, snap);
    this.jobMeta.set(jobId, {
      payload: { ...payload, _tenant_id: tenantId },
      tenantId,
      updatedAt: Date.now(),
    });
    // Defer so the HTTP response for job_id can flush before CPU-heavy sync work runs.
    setImmediate(() => {
      void this.runJob(jobId, kind, { ...payload, _tenant_id: tenantId });
    });
    return jobId;
  }

  listJobs(
    filters: JobListFilters = {},
    tenantId: string,
  ): Array<JobSnapshot & { updated_at?: string }> {
    this.pruneCompletedJobs();
    let items = [...this.jobs.entries()]
      .filter(([jobId]) => this.isOwnedBy(jobId, tenantId))
      .map(([jobId, snap]) => {
        const meta = this.jobMeta.get(jobId);
        return {
          ...snap,
          updated_at: meta ? new Date(meta.updatedAt).toISOString() : undefined,
        };
      });
    if (filters.status) {
      items = items.filter((j) => j.status === filters.status);
    }
    if (filters.since) {
      const sinceMs = Date.parse(filters.since);
      if (!Number.isNaN(sinceMs)) {
        items = items.filter((j) => {
          const ts = j.finished_at
            ? Date.parse(j.finished_at)
            : j.updated_at
              ? Date.parse(j.updated_at)
              : NaN;
          return !Number.isNaN(ts) && ts >= sinceMs;
        });
      }
    }
    if (filters.profile_id != null) {
      items = items.filter((j) => {
        const payload = this.jobMeta.get(j.job_id)?.payload;
        return Number(payload?.profile_id) === filters.profile_id;
      });
    }
    return items.sort((a, b) => {
      const ta = a.finished_at
        ? Date.parse(a.finished_at)
        : a.updated_at
          ? Date.parse(a.updated_at)
          : 0;
      const tb = b.finished_at
        ? Date.parse(b.finished_at)
        : b.updated_at
          ? Date.parse(b.updated_at)
          : 0;
      return tb - ta;
    });
  }

  private downloadUrlForPath(absolutePath: string): string | null {
    const key = exportDownloadKey(this.deps.dataDir, getRequestTenantId(), absolutePath);
    return key ? `/exports/${key}` : null;
  }

  private async runJob(jobId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
    const tenantId = String(payload._tenant_id ?? "default");
    await tenantStorage.run(tenantId, async () => {
      this.emit(jobId, { status: "running", message: "Running…", progress: 10 });
      try {
        let result: Record<string, unknown>;
        if (kind === "sync") {
          result = await this.runSync(jobId, payload);
        } else if (kind === "recompute") {
          result = await this.runRecompute(payload);
        } else if (kind === "import-scan") {
          const projectId = Number(payload.project_id);
          result = await syncProjectById(this.repo, this.deps.reposDir, projectId, undefined, {
            maxDocsBytes: this.deps.sourceDocsMaxBytes,
            onProgress: (patch) => this.emit(jobId, patch),
            enqueuePdfExtract: (pid) =>
              this.start("extract-source-docs", { project_id: pid }, tenantId),
          });
        } else if (kind === "extract-source-docs") {
          result = await this.runExtractSourceDocs(jobId, payload);
        } else if (kind === "check-source-updates") {
          result = await checkAllSourceUpdates(this.repo);
        } else if (kind === "export-stl-pack") {
          result = await this.runExportStlPack(payload);
        } else if (kind === "export-checklist-html") {
          result = await this.runExportChecklistHtml(payload);
        } else if (kind === "export-kit-bundle") {
          result = await this.runExportKitBundle(payload);
        } else if (kind === "export-3mf") {
          result = await this.runExport3mf(payload);
        } else if (kind === "pack-preview") {
          result = await this.runPackPreview(payload);
        } else if (kind === "printer-upload") {
          result = await this.runPrinterUpload(jobId, payload);
        } else if (kind === "auto-slice") {
          result = await this.runAutoSlice(jobId, payload);
        } else {
          result = { stub: true, kind, payload };
        }
        const doneMessage =
          kind === "export-stl-pack"
            ? exportStlPackJobMessage(result)
            : kind === "printer-upload" && typeof result.message === "string"
              ? result.message
              : kind === "auto-slice"
                ? autoSliceJobMessage(result)
                : kind === "sync" && Number(result.failed ?? 0) > 0
              ? `Synced ${result.synced ?? 0}, ${result.failed} failed — check Settings → GitHub PAT if rate-limited`
              : "Complete";
        this.emit(jobId, {
          status: "done",
          message: doneMessage,
          progress: 100,
          result,
          error: null,
          finished_at: new Date().toISOString(),
        });
        if (kind === "printer-upload") {
          reconcileSendQueueJobResult(this.repo, jobId, {
            ok: true,
            message: doneMessage,
          });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        try {
          this.emit(jobId, {
            status: "error",
            message: errMsg,
            progress: 100,
            error: errMsg,
            result: null,
            finished_at: new Date().toISOString(),
          });
        } catch {
          // Best-effort: if the repo/db connection is already gone (e.g. test
          // teardown raced a still-running background job), there's nothing
          // more we can do to report the failure — swallow rather than
          // surface an unhandled rejection.
        }
        // Reconcile outside the emit try block so an emit failure cannot leave
        // a printer-upload stuck in "sending".
        if (kind === "printer-upload") {
          try {
            reconcileSendQueueJobResult(this.repo, jobId, {
              ok: false,
              message: errMsg,
            });
          } catch {
            // Same teardown race as above.
          }
        }
      }
    });
  }

  private async runSync(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ids = Array.isArray(payload.project_ids)
      ? (payload.project_ids as number[])
      : this.repo.listProjectIds();
    const tenantId = String(payload._tenant_id ?? "default");
    const results: Array<Record<string, unknown>> = [];
    const failures: Array<{ project_id: number; name: string | null; error: string }> = [];
    const hasPat = Boolean(this.repo.getSetting("github_pat")?.trim());
    if (!hasPat && ids.length > 10) {
      this.emit(jobId, {
        message:
          "No GitHub PAT configured — unauthenticated API limit is 60/hour. Add a token in Settings → GitHub PAT for bulk sync.",
        progress: 2,
      });
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const row = this.repo.getProjectRow(id);
      this.emit(jobId, {
        message: `Syncing ${row?.name ?? `source ${id}`} (${i + 1}/${ids.length})`,
        progress: Math.round((i / Math.max(ids.length, 1)) * 90),
      });
      try {
        results.push({
          project_id: id,
          ...(await syncProjectById(this.repo, this.deps.reposDir, id, undefined, {
            maxDocsBytes: this.deps.sourceDocsMaxBytes,
            onProgress: (patch) => this.emit(jobId, patch),
            enqueuePdfExtract: (pid) =>
              this.start("extract-source-docs", { project_id: pid }, tenantId),
          })),
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const isRateLimit = /rate limit exceeded/i.test(errMsg);
        const friendly = isRateLimit
          ? `${errMsg} Add a GitHub PAT in Settings to raise the limit from 60/hour to 5,000/hour.`
          : errMsg;
        failures.push({ project_id: id, name: row?.name ?? null, error: friendly });
        if (isRateLimit) {
          // Remaining sources will also fail without a PAT — stop early.
          for (let j = i + 1; j < ids.length; j++) {
            const skipped = this.repo.getProjectRow(ids[j]!);
            failures.push({
              project_id: ids[j]!,
              name: skipped?.name ?? null,
              error: "Skipped — GitHub API rate limit exceeded. Add a PAT in Settings and retry.",
            });
          }
          break;
        }
        // Continue with other sources (bad branch / missing repo should not abort the whole batch).
        continue;
      }
    }
    if (results.length === 0 && failures.length > 0) {
      throw new Error(failures.map((f) => `${f.name ?? f.project_id}: ${f.error}`).join("; "));
    }
    return { synced: results.length, failed: failures.length, results, failures };
  }

  private async runExtractSourceDocs(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const projectId = Number(payload.project_id);
    const row = this.repo.getProjectRow(projectId);
    if (!row?.localPath) throw new Error("Source has no local path");
    this.emit(jobId, { message: "Extracting PDF text…", progress: 15 });
    const result = await extractPendingPdfsForSource(this.repo, projectId, row.localPath, {
      onProgress: (msg, progress) => this.emit(jobId, { message: msg, progress }),
    });
    return { project_id: projectId, ...result };
  }

  private async runRecompute(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const apply_manifest = Boolean(payload.apply_manifest);
    return this.repo.recomputeProfile(profileId, { apply_manifest });
  }

  private async runExportStlPack(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const missingOnly = Boolean(payload.missing_only);
    const groupBy: StlPackGroupBy = payload.group_by === "color" ? "color" : "color_dir";
    const { name, parts, completedByMatchKey } = this.repo.buildMergePartsForProfile(profileId);
    const naming = this.repo.getGlobalNaming();
    const { rootPath, fileCounts, warnings } = exportProfileStlPack(name, parts, this.getExportsDir(), {
      missingOnly,
      completedByMatchKey: missingOnly ? completedByMatchKey : undefined,
      roleOrder: naming.export_role_order,
      groupBy,
    });
    const fileTotal = Object.values(fileCounts).reduce((a, b) => a + b, 0);

    let downloadUrl: string | null = null;
    if (fileTotal > 0) {
      const zipPath = join(dirname(rootPath), `${basename(rootPath)}.zip`);
      try {
        zipDirectoryToFile(rootPath, zipPath);
        downloadUrl = this.downloadUrlForPath(zipPath);
      } catch {
        downloadUrl = null;
      }
    }

    return {
      root_path: rootPath,
      download_url: downloadUrl,
      file_counts: fileCounts,
      zip_counts: fileCounts,
      warnings,
      missing_only: missingOnly,
      file_total: fileTotal,
    };
  }

  private async runExportChecklistHtml(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const { name, orderNumber, parts, completedByMatchKey } =
      this.repo.buildMergePartsForProfile(profileId);
    const thumbsDir = join(this.deps.dataDir, "thumbs");
    const dateFormat = (this.repo.getSetting("date_format") as DateFormatId | null) ?? DATE_FORMAT_DEFAULT;
    const { path, partCount, thumbCount } = exportProfileHtml(
      name,
      orderNumber,
      parts,
      this.getExportsDir(),
      profileId,
      completedByMatchKey,
      thumbsDir,
      dateFormat,
    );
    return {
      path,
      download_url: this.downloadUrlForPath(path),
      part_count: partCount,
      thumb_count: thumbCount,
    };
  }

  private async runExportKitBundle(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const includePrintProgress = Boolean(payload.include_print_progress);
    const path = exportKitBundle(this.repo, profileId, this.getExportsDir(), includePrintProgress);
    return {
      path,
      download_url: this.downloadUrlForPath(path),
      profile_id: profileId,
    };
  }

  private async runExport3mf(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Yield once more so concurrent health checks / requests can run before STL packing.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const profileId = Number(payload.profile_id);
    const result = runExport3mfJob(this.repo, profileId, this.getExportsDir(), {
      layout_mode: String(payload.layout_mode ?? "per_plate"),
      spacing_mm: Number(payload.spacing_mm ?? 4),
      missing_only: Boolean(payload.missing_only),
      enabled_printer_ids: Array.isArray(payload.enabled_printer_ids)
        ? (payload.enabled_printer_ids as string[])
        : undefined,
    });
    return {
      primary_path: result.primary_path,
      download_url: this.downloadUrlForPath(result.primary_path),
      paths: result.paths.map((p) => ({
        path: p,
        download_url: this.downloadUrlForPath(p),
      })),
      object_count: result.object_count,
      plate_count: result.plate_count,
      warnings: result.warnings,
      printer_summaries: result.printer_summaries,
    };
  }

  private async runPackPreview(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    return runPackPreviewJob(this.repo, profileId, {
      enabled_printer_ids: Array.isArray(payload.enabled_printer_ids)
        ? (payload.enabled_printer_ids as string[])
        : undefined,
      assignments: payload.assignments as Record<string, string> | undefined,
      auto_assign: Boolean(payload.auto_assign),
      spacing_mm: payload.spacing_mm != null ? Number(payload.spacing_mm) : undefined,
      grouping_strategy: payload.grouping_strategy === "height_band" ? "height_band" : undefined,
    });
  }

  private async runPrinterUpload(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const profileRaw = payload.profile_id;
    const profileId =
      typeof profileRaw === "number"
        ? profileRaw
        : typeof profileRaw === "string" && profileRaw.trim()
          ? Number(profileRaw)
          : undefined;
    return runPrinterUploadJob(
      this.repo,
      {
        printer_id: String(payload.printer_id ?? ""),
        artifact_path: String(payload.artifact_path ?? ""),
        filename: String(payload.filename ?? "print.gcode"),
        start: Boolean(payload.start),
        host_name: typeof payload.host_name === "string" ? payload.host_name : undefined,
        profile_id:
          typeof profileId === "number" && Number.isInteger(profileId) && profileId > 0
            ? profileId
            : undefined,
        checkoff_units: Array.isArray(payload.checkoff_units)
          ? parseCheckoffUnits(payload.checkoff_units)
          : undefined,
        unlabeled_names: (() => {
          const names = parseUnlabeledNames(payload.unlabeled_names);
          return names.length ? names : undefined;
        })(),
        upload_job_id: jobId,
      },
      (patch) => this.emit(jobId, patch),
    );
  }

  async get(jobId: string, tenantId: string): Promise<JobSnapshot | null> {
    this.pruneCompletedJobs();
    if (!this.isOwnedBy(jobId, tenantId)) return null;
    return this.jobs.get(jobId) ?? null;
  }

  /** Wait until a job reaches a terminal status (or timeout). */
  async waitForTerminal(
    jobId: string,
    timeoutMs = 120_000,
    tenantId = getRequestTenantId(),
  ): Promise<JobSnapshot> {
    return new Promise<JobSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub?.();
        reject(new Error(`Job ${jobId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const unsub = this.subscribe(jobId, tenantId, (event) => {
        if (this.isTerminal(event)) {
          clearTimeout(timer);
          unsub?.();
          resolve(event);
        }
      });
      if (!unsub) {
        clearTimeout(timer);
        reject(new Error(`Job ${jobId} not found`));
        return;
      }
      // Close race: job may have finished between start and subscribe.
      const existing = this.jobs.get(jobId);
      if (existing && this.isTerminal(existing)) {
        clearTimeout(timer);
        unsub();
        resolve(existing);
      }
    });
  }

  private async runAutoSlice(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const result = await runAutoSliceJob(
      this.repo,
      this.getExportsDir(),
      {
        profile_id: profileId,
        layout_mode: typeof payload.layout_mode === "string" ? payload.layout_mode : "per_plate",
        spacing_mm: payload.spacing_mm != null ? Number(payload.spacing_mm) : undefined,
        missing_only: Boolean(payload.missing_only),
        enabled_printer_ids: Array.isArray(payload.enabled_printer_ids)
          ? (payload.enabled_printer_ids as string[])
          : undefined,
        timeout_s: payload.timeout_s != null ? Number(payload.timeout_s) : undefined,
      },
      (patch) => this.emit(jobId, patch),
    );
    return {
      profile_id: profileId,
      ok: result.ok,
      plate_count: result.plate_count,
      attempted_count: result.attempted_count,
      failed_count: result.failed_count,
      gcode_paths: result.gcode_paths.map((p) => ({
        path: p,
        download_url: this.downloadUrlForPath(p),
      })),
      plates: result.plates.map((pl) => ({
        printer_id: pl.printer_id,
        printer_name: pl.printer_name,
        plate_index: pl.plate_index,
        slicer: pl.slicer,
        status: pl.status,
        gcode_path: pl.gcode_path,
        thumbnail_path: pl.thumbnail_path,
        error: pl.error,
        error_code: pl.error_code,
        stderr: pl.stderr,
        exit_code: pl.exit_code,
        settings_keys: pl.settings_keys,
        download_url: pl.gcode_path ? this.downloadUrlForPath(pl.gcode_path) : null,
        thumbnail_url: pl.thumbnail_path ? this.downloadUrlForPath(pl.thumbnail_path) : null,
      })),
      warnings: result.warnings,
    };
  }

  async cancel(jobId: string, tenantId: string): Promise<boolean> {
    if (!this.isOwnedBy(jobId, tenantId)) return false;
    const snap = this.jobs.get(jobId);
    if (!snap || snap.status === "done" || snap.status === "error" || snap.status === "cancelled") {
      return false;
    }
    snap.status = "cancelled";
    snap.message = "Cancelled";
    snap.finished_at = new Date().toISOString();
    this.touchMeta(jobId);
    this.pruneCompletedJobs();
    return true;
  }
}

export async function registerJobRoutes(
  app: FastifyInstance,
  jobs: InProcessJobRunner,
  _config?: { deployMode?: string },
): Promise<void> {
  const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.post("/jobs/sync", limited, async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const job_id = await jobs.start("sync", body, request.tenantId);
    return { job_id };
  });

  app.post("/jobs/recompute", limited, async (request, reply) => {
    const body = request.body as { profile_id?: number; apply_manifest?: boolean };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "recompute",
      {
        profile_id: body.profile_id,
        apply_manifest: body.apply_manifest ?? false,
      },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/import-scan", async (request) => {
    const body = request.body as { project_id?: number };
    const job_id = await jobs.start("import-scan", { project_id: body.project_id }, request.tenantId);
    return { job_id };
  });

  app.post("/jobs/check-source-updates", async (request) => {
    const job_id = await jobs.start("check-source-updates", {}, request.tenantId);
    return { job_id };
  });

  app.post("/jobs/extract-source-docs", async (request) => {
    const body = request.body as { project_id?: number };
    const job_id = await jobs.start(
      "extract-source-docs",
      { project_id: body.project_id },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/export-stl-pack", limited, async (request, reply) => {
    const body = request.body as {
      profile_id?: number;
      missing_only?: boolean;
      group_by?: string;
    };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "export-stl-pack",
      {
        profile_id: body.profile_id,
        missing_only: body.missing_only ?? false,
        group_by: body.group_by === "color" ? "color" : "color_dir",
      },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/export-checklist-html", async (request, reply) => {
    const body = request.body as { profile_id?: number };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "export-checklist-html",
      { profile_id: body.profile_id },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/export-kit-bundle", limited, async (request, reply) => {
    const body = request.body as { profile_id?: number; include_print_progress?: boolean };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "export-kit-bundle",
      {
        profile_id: body.profile_id,
        include_print_progress: body.include_print_progress ?? false,
      },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/export-3mf", limited, async (request, reply) => {
    const body = request.body as {
      profile_id?: number;
      layout_mode?: string;
      spacing_mm?: number;
      missing_only?: boolean;
      enabled_printer_ids?: string[];
    };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "export-3mf",
      {
        profile_id: body.profile_id,
        layout_mode: body.layout_mode ?? "per_plate",
        spacing_mm: body.spacing_mm ?? 4,
        missing_only: body.missing_only ?? false,
        enabled_printer_ids: body.enabled_printer_ids,
      },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/auto-slice", limited, async (request, reply) => {
    const body = request.body as {
      profile_id?: number;
      spacing_mm?: number;
      missing_only?: boolean;
      enabled_printer_ids?: string[];
      timeout_s?: number;
    };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "auto-slice",
      {
        profile_id: body.profile_id,
        // Auto-slice always exports one 3MF per plate; a zip would be
        // unsliceable by the sidecar.
        layout_mode: "per_plate",
        spacing_mm: body.spacing_mm ?? 4,
        missing_only: body.missing_only ?? false,
        enabled_printer_ids: body.enabled_printer_ids,
        timeout_s: body.timeout_s,
      },
      request.tenantId,
    );
    return { job_id };
  });

  app.post("/jobs/pack-preview", async (request, reply) => {
    const body = request.body as {
      profile_id?: number;
      enabled_printer_ids?: string[];
      assignments?: Record<string, string>;
      auto_assign?: boolean;
      spacing_mm?: number;
      grouping_strategy?: string;
    };
    if (!body.profile_id || !jobs.getRepo().getProfile(body.profile_id)) {
      return sendProblem(reply, 404, "Not Found", "Profile not found");
    }
    const job_id = await jobs.start(
      "pack-preview",
      {
        profile_id: body.profile_id,
        enabled_printer_ids: body.enabled_printer_ids,
        assignments: body.assignments,
        auto_assign: body.auto_assign ?? false,
        spacing_mm: body.spacing_mm,
        grouping_strategy: body.grouping_strategy,
      },
      request.tenantId,
    );
    return { job_id };
  });

  app.post(
    "/jobs/printer-upload",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      let artifactPath: string | null = null;

      try {
        const parsed = await parsePrinterUploadMultipart(request, {
          exportsDir: jobs.getExportsDir(request.tenantId),
        });
        if (!parsed.ok) {
          return sendProblem(
            reply,
            parsed.error.status,
            parsed.error.title,
            parsed.error.detail,
          );
        }

        const {
          printer_id: printerId,
          start,
          filename: baseName,
          artifact_path,
          profile_id: profileId,
          checkoff_units_raw: checkoffUnitsRaw,
          unlabeled_names_raw: unlabeledNamesRaw,
        } = parsed.value;
        artifactPath = artifact_path;

        const checkoff_units = parseCheckoffUnits(checkoffUnitsRaw);
        const unlabeledParsed = parseUnlabeledNames(unlabeledNamesRaw);
        const unlabeled_names = unlabeledParsed.length ? unlabeledParsed : undefined;
        // GRE-232: Send must bind to a plan (active spine). No plan → reject.
        if (profileId == null) {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            "Pick a plan to bind this send (profile_id required)",
          );
        }
        if (!jobs.getRepo().getProfile(profileId)) {
          return sendProblem(reply, 404, "Not Found", "Profile not found");
        }

        const repo = jobs.getRepo();
        const machine = loadFleet(repo).find((m) => m.id === printerId);
        if (!machine) {
          return sendProblem(reply, 404, "Not Found", "Fleet printer not found");
        }
        const integrationId = machine.integration_id?.trim();
        if (!integrationId) {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            "Printer is not linked to a host. Link a Moonraker or PrusaLink host in Settings.",
          );
        }
        const integration = getIntegrationConfig(repo, integrationId);
        if (!integration) {
          return sendProblem(reply, 400, "Bad Request", "Linked printer host was not found");
        }
        if (integration.type !== "moonraker" && integration.type !== "prusalink") {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            `Upload is not supported for ${integration.type}`,
          );
        }

        if (start) {
          const adapter = getIntegrationAdapter(integration.type);
          let hostState: string = "unknown";
          try {
            const status = adapter?.getStatus
              ? await adapter.getStatus(integration.config)
              : { state: "unknown" as const };
            hostState = status.state;
          } catch {
            hostState = "offline";
          }
          if (hostState !== "idle" && hostState !== "complete") {
            return sendProblem(
              reply,
              409,
              "Conflict",
              `Printer is ${hostState} — wait for Idle or queue for idle`,
            );
          }
        }

        const job_id = await jobs.start(
          "printer-upload",
          {
            printer_id: printerId,
            artifact_path: artifactPath,
            filename: baseName,
            start,
            host_name: integration.name,
            profile_id: profileId,
            checkoff_units,
            unlabeled_names,
          },
          request.tenantId,
        );
        artifactPath = null;
        return { job_id };
      } finally {
        if (artifactPath) {
          try {
            rmSync(artifactPath, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    },
  );

  app.get("/jobs/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const snap = await jobs.get(id, request.tenantId);
    if (!snap) return reply.status(404).send({ detail: "Job not found" });
    return snap;
  });
}

export function registerJobWebSocket(
  app: FastifyInstance,
  jobs: InProcessJobRunner,
): void {
  app.get("/ws/jobs/:jobId", { websocket: true }, (socket, request) => {
    const jobId = (request.params as { jobId: string }).jobId;
    void jobs.get(jobId, request.tenantId).then((snap) => {
      if (!snap) {
        socket.close(1008, "Job not found");
        return;
      }
      socket.send(JSON.stringify(snap));
      if (snap.status === "done" || snap.status === "error" || snap.status === "cancelled") {
        socket.close();
        return;
      }
      const unsub = jobs.subscribe(jobId, request.tenantId, (event) => {
        socket.send(JSON.stringify(event));
        if (event.status === "done" || event.status === "error" || event.status === "cancelled") {
          socket.close();
        }
      });
      socket.on("close", () => unsub?.());
    });
  });
}

export function createJobRunner(
  getRepo: () => AppRepository,
  dataDir: string,
  options?: { sourceDocsMaxBytes?: number },
): InProcessJobRunner {
  const maxDocs =
    options?.sourceDocsMaxBytes ??
    (() => {
      const raw = Number(process.env.SOURCE_DOCS_MAX_BYTES ?? 1024 * 1024 * 1024);
      return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1024 * 1024 * 1024;
    })();
  return new InProcessJobRunner({
    getRepo,
    reposDir: join(dataDir, "repos"),
    exportsDir: join(dataDir, "exports"),
    dataDir,
    sourceDocsMaxBytes: maxDocs,
  });
}
