import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import { checkAppUpdate, resetAppUpdateCheckCache } from "../services/app-update-check.js";
import {
  DEFAULT_NAMING_PROFILE,
  mergeNamingProfiles,
  namingProfileFromDict,
  parseSourceNamingMetadata,
  previewParse,
  resolveNamingProfile,
  parseProjectMetadata,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { loadFilamentCatalog } from "../services/filament-catalog.js";
import {
  addCustomFilament,
  deleteCustomFilament,
  listCustomFilaments,
} from "../services/custom-filaments.js";
import { getIntegrationConfig } from "../integrations/store.js";
import {
  listSpoolmanFilaments,
  spoolmanFilamentToCatalogColor,
} from "../integrations/spoolman-client.js";

type RouteDeps = { repo: AppRepository; dataDir: string; config?: ServerConfig };

export async function registerSettingsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/settings/update-check", async (request) => {
    if (!deps.config) {
      return {
        enabled: false,
        update_available: false,
        current_version: "unknown",
        latest_version: null,
        release_url: null,
        release_notes_url: null,
        deploy_mode: "self-host" as const,
        checked_at: null,
      };
    }
    const query = request.query as { refresh?: string };
    if (query.refresh === "1") {
      resetAppUpdateCheckCache();
    }
    return checkAppUpdate(deps.config);
  });

  app.get("/settings/source-categories", async () => ({
    categories: deps.repo.getSourceCategories(),
  }));

  app.put("/settings/source-categories", async (request, reply) => {
    try {
      const body = request.body as { categories?: string[] };
      return { categories: deps.repo.saveSourceCategories(body.categories ?? []) };
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/settings/stl-naming", async () => ({
    profile: deps.repo.getGlobalNaming(),
  }));

  app.put("/settings/stl-naming", async (request, reply) => {
    try {
      const body = request.body as { profile?: typeof DEFAULT_NAMING_PROFILE };
      const profile = deps.repo.saveGlobalNaming(body.profile ?? DEFAULT_NAMING_PROFILE);
      return { profile };
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/settings/stl-naming/preview", async (request, reply) => {
    try {
      const body = request.body as {
        relative_path?: string;
        profile?: Partial<typeof DEFAULT_NAMING_PROFILE>;
      };
      const globalProfile = deps.repo.getGlobalNaming();
      const merged = body.profile
        ? mergeNamingProfiles(globalProfile, body.profile)
        : globalProfile;
      const profile = namingProfileFromDict(merged);
      return previewParse(String(body.relative_path ?? ""), profile);
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/settings/github-pat", async () => ({
    configured: Boolean(deps.repo.getSetting("github_pat")),
    masked: null,
  }));

  app.put("/settings/github-pat", async (request) => {
    const body = request.body as { token?: string };
    if (body.token) deps.repo.setSetting("github_pat", body.token);
    return {
      configured: Boolean(deps.repo.getSetting("github_pat")),
      masked: body.token ? "****" : null,
    };
  });

  app.get("/settings/source-update-check", async () => ({
    interval_hours: Number(deps.repo.getSetting("source_update_check_hours", "24")),
  }));
}

export async function registerSourceNamingRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/sources/:id/naming", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    const globalProfile = deps.repo.getGlobalNaming();
    const metadata = parseProjectMetadata(row.metadataJson);
    const { useDefaults, override } = parseSourceNamingMetadata(metadata);
    const effective = resolveNamingProfile(globalProfile, metadata);
    return {
      use_defaults: useDefaults,
      override,
      effective: effective.toDict(),
    };
  });
}

export async function registerStubRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/settings/spoolman-default", async () => ({
    integration_id: deps.repo.getSetting("default_spoolman_integration_id") || null,
  }));

  app.put("/settings/spoolman-default", async (request, reply) => {
    const body = request.body as { integration_id?: string | null };
    const raw = body.integration_id?.trim() ?? "";
    if (!raw) {
      deps.repo.setSetting("default_spoolman_integration_id", "");
      return { integration_id: null };
    }
    const item = getIntegrationConfig(deps.repo, raw);
    if (!item || item.type !== "spoolman") {
      return reply.status(400).send({ detail: "integration_id must be a Spoolman connector" });
    }
    deps.repo.setSetting("default_spoolman_integration_id", raw);
    return { integration_id: raw };
  });

  app.get("/filaments/catalog", async (request) => {
    const catalog = loadFilamentCatalog();
    const custom = listCustomFilaments(deps.dataDir).map((f) => ({
      id: f.id,
      display_name: f.display_name,
      product_line: f.product_line,
      hex: f.hex,
      combo_label: f.combo_label,
      swatch_url: "",
    }));

    const query = request.query as { spoolman_integration_id?: string };
    const defaultId = deps.repo.getSetting("default_spoolman_integration_id") || null;
    const integrationId = query.spoolman_integration_id?.trim() || defaultId || "";
    let spoolman_colors: ReturnType<typeof spoolmanFilamentToCatalogColor>[] = [];
    let spoolman_status: "ok" | "empty" | "error" | "disabled" | "not_found" | undefined;
    let spoolman_error: string | null = null;

    if (integrationId) {
      const integration = getIntegrationConfig(deps.repo, integrationId);
      if (!integration) {
        spoolman_status = "not_found";
        spoolman_error = "Spoolman integration not found";
      } else if (integration.type !== "spoolman") {
        spoolman_status = "error";
        spoolman_error = "Selected integration is not a Spoolman connector";
      } else if (integration.config.enabled === false) {
        spoolman_status = "disabled";
        spoolman_error = "Spoolman integration is disabled in Settings";
      } else {
        try {
          const filaments = await listSpoolmanFilaments(integration.config);
          spoolman_colors = filaments.map((f) =>
            spoolmanFilamentToCatalogColor(integration.id, f),
          );
          if (filaments.length === 0) {
            spoolman_status = "empty";
            spoolman_error =
              "Spoolman returned no filament types — add filaments in Spoolman (spools alone are not listed here)";
          } else {
            spoolman_status = "ok";
          }
        } catch (e) {
          spoolman_status = "error";
          spoolman_error = e instanceof Error ? e.message : String(e);
          request.log.warn({ err: e, integrationId }, "Spoolman catalog fetch failed");
          spoolman_colors = [];
        }
      }
    }

    return {
      ...catalog,
      custom_colors: custom,
      spoolman_colors,
      default_spoolman_integration_id: defaultId,
      ...(spoolman_status ? { spoolman_status } : {}),
      ...(spoolman_error ? { spoolman_error } : {}),
    };
  });

  app.get("/filaments/custom", async () => ({ filaments: listCustomFilaments(deps.dataDir) }));

  app.post("/filaments/custom", async (request, reply) => {
    try {
      const body = request.body as { display_name?: string; hex?: string; product_line?: string };
      return addCustomFilament(deps.dataDir, {
        display_name: String(body.display_name ?? ""),
        hex: String(body.hex ?? ""),
        product_line: body.product_line,
      });
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete("/filaments/custom/:id", async (request, reply) => {
    try {
      deleteCustomFilament(deps.dataDir, decodeURIComponent((request.params as { id: string }).id));
      return reply.status(204).send();
    } catch (e) {
      return reply.status(404).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/help/workflow", async () => "Print Partner web — self-host workflow guide.");
}
