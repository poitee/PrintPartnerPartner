import { basename, dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { JobSnapshot } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import { exportDownloadKey, safeDataDirPath } from "../lib/secure-path.js";
import { syncProjectById } from "./sources.js";
import { exportProfileStlPack } from "../services/export-stl-pack.js";
import { zipDirectoryToFile } from "../services/zip-dir.js";
import { exportProfileHtml } from "../services/export-html.js";
import { exportKitBundle, loadKitBundleBytes, parseKitBundleBuffer } from "../services/export-kit.js";
import { checkAllSourceUpdates } from "../services/source-update-check.js";
import { runExport3mfJob } from "../services/export-3mf-job.js";
import { runPackPreviewJob } from "../services/plate-workspace.js";

export type JobHandler = (
  jobId: string,
  emit: (event: Partial<JobSnapshot>) => void,
) => Promise<Record<string, unknown>>;

export type JobRunnerDeps = {
  getRepo: () => AppRepository;
  reposDir: string;
  exportsDir: string;
  dataDir: string;
};

export class InProcessJobRunner {
  private readonly jobs = new Map<string, JobSnapshot>();
  private readonly listeners = new Map<string, Set<(event: JobSnapshot) => void>>();

  constructor(private readonly deps: JobRunnerDeps) {}

  private get repo(): AppRepository {
    return this.deps.getRepo();
  }

  subscribe(jobId: string, listener: (event: JobSnapshot) => void): () => void {
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(listener);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(listener);
    };
  }

  private emit(jobId: string, patch: Partial<JobSnapshot>): void {
    const snap = this.jobs.get(jobId);
    if (!snap) return;
    Object.assign(snap, patch);
    for (const listener of this.listeners.get(jobId) ?? []) {
      listener({ ...snap });
    }
  }

  async start(kind: string, payload: Record<string, unknown>): Promise<string> {
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
    void this.runJob(jobId, kind, payload);
    return jobId;
  }

  private downloadUrlForPath(absolutePath: string): string | null {
    const key = exportDownloadKey(this.deps.dataDir, absolutePath);
    return key ? `/exports/${key}` : null;
  }

  private async runJob(jobId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
    this.emit(jobId, { status: "running", message: "Running…", progress: 10 });
    try {
      let result: Record<string, unknown>;
      if (kind === "sync") {
        result = await this.runSync(payload);
      } else if (kind === "recompute") {
        result = await this.runRecompute(payload);
      } else if (kind === "import-scan") {
        const projectId = Number(payload.project_id);
        result = await syncProjectById(this.repo, this.deps.reposDir, projectId);
      } else if (kind === "check-source-updates") {
        result = await checkAllSourceUpdates(this.repo);
      } else if (kind === "export-stl-pack") {
        result = await this.runExportStlPack(payload);
      } else if (kind === "export-checklist-html") {
        result = await this.runExportChecklistHtml(payload);
      } else if (kind === "export-kit-bundle") {
        result = await this.runExportKitBundle(payload);
      } else if (kind === "import-kit-bundle") {
        result = await this.runImportKitBundle(payload);
      } else if (kind === "export-3mf") {
        result = await this.runExport3mf(payload);
      } else if (kind === "pack-preview") {
        result = await this.runPackPreview(payload);
      } else {
        result = { stub: true, kind, payload };
      }
      this.emit(jobId, {
        status: "done",
        message: "Complete",
        progress: 100,
        result,
        error: null,
      });
    } catch (e) {
      this.emit(jobId, {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        progress: 100,
        error: e instanceof Error ? e.message : String(e),
        result: null,
      });
    }
  }

  private async runSync(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ids = Array.isArray(payload.project_ids)
      ? (payload.project_ids as number[])
      : this.repo.listProjectIds();
    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      results.push({ project_id: id, ...(await syncProjectById(this.repo, this.deps.reposDir, id)) });
    }
    return { synced: results.length, results };
  }

  private async runRecompute(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const apply_manifest = Boolean(payload.apply_manifest);
    return this.repo.recomputeProfile(profileId, { apply_manifest });
  }

  private async runExportStlPack(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const missingOnly = Boolean(payload.missing_only);
    const { name, parts, completedByMatchKey } = this.repo.buildMergePartsForProfile(profileId);
    const naming = this.repo.getGlobalNaming();
    const { rootPath, fileCounts, warnings } = exportProfileStlPack(name, parts, this.deps.exportsDir, {
      missingOnly,
      completedByMatchKey: missingOnly ? completedByMatchKey : undefined,
      roleOrder: naming.export_role_order,
    });
    const fileTotal = Object.values(fileCounts).reduce((a, b) => a + b, 0);

    // The export writes a directory tree; zip it so the web client can download
    // a single file (the /exports route only serves files, not directories).
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
    const { path, partCount, thumbCount } = exportProfileHtml(
      name,
      orderNumber,
      parts,
      this.deps.exportsDir,
      profileId,
      completedByMatchKey,
      thumbsDir,
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
    const path = exportKitBundle(this.repo, profileId, this.deps.exportsDir, includePrintProgress);
    return {
      path,
      download_url: this.downloadUrlForPath(path),
      profile_id: profileId,
    };
  }

  private async runExport3mf(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const profileId = Number(payload.profile_id);
    const result = runExport3mfJob(this.repo, profileId, this.deps.exportsDir, {
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
    });
  }

  private async runImportKitBundle(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let data: Record<string, unknown>;
    if (payload.bundle_b64) {
      const buf = Buffer.from(String(payload.bundle_b64), "base64");
      data = parseKitBundleBuffer(buf);
    } else {
      const path = String(payload.path ?? "");
      if (!path) throw new Error("path is required");
      const safe = safeDataDirPath(this.deps.dataDir, path);
      if (!safe) throw new Error("Kit path must be under the Print Partner data directory");
      data = loadKitBundleBytes(safe);
    }
    const result = this.repo.importKitBundle(data, (payload.new_name as string) ?? null);
    return {
      profile_id: result.profile_id,
      profile_name: result.profile_name,
      parts_imported: result.parts_imported,
      layers_imported: result.layers_imported,
      warnings: result.warnings,
    };
  }

  async get(jobId: string): Promise<JobSnapshot | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async cancel(jobId: string): Promise<boolean> {
    const snap = this.jobs.get(jobId);
    if (!snap || snap.status === "done" || snap.status === "error" || snap.status === "cancelled") {
      return false;
    }
    snap.status = "cancelled";
    snap.message = "Cancelled";
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
    const job_id = await jobs.start("sync", body);
    return { job_id };
  });

  app.post("/jobs/recompute", limited, async (request) => {
    const body = request.body as { profile_id?: number; apply_manifest?: boolean };
    const job_id = await jobs.start("recompute", {
      profile_id: body.profile_id,
      apply_manifest: body.apply_manifest ?? false,
    });
    return { job_id };
  });

  app.post("/jobs/import-scan", async (request) => {
    const body = request.body as { project_id?: number };
    const job_id = await jobs.start("import-scan", { project_id: body.project_id });
    return { job_id };
  });

  app.post("/jobs/check-source-updates", async () => {
    const job_id = await jobs.start("check-source-updates", {});
    return { job_id };
  });

  app.post("/jobs/export-stl-pack", limited, async (request) => {
    const body = request.body as { profile_id?: number; missing_only?: boolean };
    const job_id = await jobs.start("export-stl-pack", {
      profile_id: body.profile_id,
      missing_only: body.missing_only ?? false,
    });
    return { job_id };
  });

  app.post("/jobs/export-checklist-html", async (request) => {
    const body = request.body as { profile_id?: number };
    const job_id = await jobs.start("export-checklist-html", {
      profile_id: body.profile_id,
    });
    return { job_id };
  });

  app.post("/jobs/export-kit-bundle", limited, async (request) => {
    const body = request.body as { profile_id?: number; include_print_progress?: boolean };
    const job_id = await jobs.start("export-kit-bundle", {
      profile_id: body.profile_id,
      include_print_progress: body.include_print_progress ?? false,
    });
    return { job_id };
  });

  app.post("/jobs/import-kit-bundle", limited, async (request) => {
    const body = request.body as { path?: string; new_name?: string };
    const job_id = await jobs.start("import-kit-bundle", {
      path: body.path,
      new_name: body.new_name,
    });
    return { job_id };
  });

  app.post("/jobs/export-3mf", limited, async (request) => {
    const body = request.body as {
      profile_id?: number;
      layout_mode?: string;
      spacing_mm?: number;
      missing_only?: boolean;
      enabled_printer_ids?: string[];
    };
    const job_id = await jobs.start("export-3mf", {
      profile_id: body.profile_id,
      layout_mode: body.layout_mode ?? "per_plate",
      spacing_mm: body.spacing_mm ?? 4,
      missing_only: body.missing_only ?? false,
      enabled_printer_ids: body.enabled_printer_ids,
    });
    return { job_id };
  });

  app.post("/jobs/pack-preview", async (request) => {
    const body = request.body as {
      profile_id?: number;
      enabled_printer_ids?: string[];
      assignments?: Record<string, string>;
      auto_assign?: boolean;
      spacing_mm?: number;
    };
    const job_id = await jobs.start("pack-preview", {
      profile_id: body.profile_id,
      enabled_printer_ids: body.enabled_printer_ids,
      assignments: body.assignments,
      auto_assign: body.auto_assign ?? false,
      spacing_mm: body.spacing_mm,
    });
    return { job_id };
  });

  app.get("/jobs/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const snap = await jobs.get(id);
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
    void jobs.get(jobId).then((snap) => {
      if (snap) {
        socket.send(JSON.stringify(snap));
      }
    });
    const unsub = jobs.subscribe(jobId, (event) => {
      socket.send(JSON.stringify(event));
      if (event.status === "done" || event.status === "error" || event.status === "cancelled") {
        socket.close();
      }
    });
    socket.on("close", () => unsub());
  });
}

export function createJobRunner(getRepo: () => AppRepository, dataDir: string): InProcessJobRunner {
  return new InProcessJobRunner({
    getRepo,
    reposDir: join(dataDir, "repos"),
    exportsDir: join(dataDir, "exports"),
    dataDir,
  });
}
