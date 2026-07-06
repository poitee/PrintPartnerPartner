import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { AppRepository } from "../db/repository.js";
import {
  DATE_FORMAT_DEFAULT,
  DATE_FORMAT_PRESETS,
  type DateFormatId,
} from "@print-partner/contracts";
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
import { trimmedString } from "../lib/secure-path.js";
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

  app.get("/settings/date-format", async () => ({
    format: (deps.repo.getSetting("date_format") as DateFormatId | null) ?? DATE_FORMAT_DEFAULT,
  }));

  app.put("/settings/date-format", async (request, reply) => {
    const body = request.body as { format?: string };
    const format = body.format ?? "";
    if (!DATE_FORMAT_PRESETS.some((p) => p.id === format)) {
      return reply.status(400).send({ detail: "format must be one of the supported date formats" });
    }
    deps.repo.setSetting("date_format", format);
    return { format: format as DateFormatId };
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

  app.get("/settings/auto-recompute", async () => ({
    enabled: deps.repo.getSetting("auto_recompute", "1") !== "0",
  }));

  app.put("/settings/auto-recompute", async (request) => {
    const body = request.body as { enabled?: boolean };
    deps.repo.setSetting("auto_recompute", body.enabled === false ? "0" : "1");
    return { enabled: body.enabled !== false };
  });
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
    const body = request.body as { integration_id?: unknown };
    const raw = trimmedString(body.integration_id);
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

    const query = request.query as { spoolman_integration_id?: unknown };
    const defaultId = deps.repo.getSetting("default_spoolman_integration_id") || null;
    const integrationId = trimmedString(query.spoolman_integration_id) || defaultId || "";
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

  app.get("/help/workflow", async () => WORKFLOW_GUIDE);
}

const WORKFLOW_GUIDE = `# Print Partner workflow

Print Partner helps you manage **layered STL kits** — a base repo plus add-on repos — through a four-step pipeline: **Sources → Build → Review → Checkoff**. Plan management (create, rename, duplicate, delete) lives outside that pipeline — use the header **Create build** button, the **Manage builds** panel on Build, or the **Builds** page in the sidebar.

## Managing builds

Before you configure files and colors, create or select a **build plan**:

- **Header** — **Create build** (+ icon on mobile) and the plan picker (search, rename, duplicate, delete).
- **Build page** — collapsible **Manage builds** panel with the active-build dropdown and full CRUD.
- **Builds page** (sidebar under Settings) — same plan manager, always expanded.

The active plan is shared across Build, Review, and Checkoff. Switch plans in the header picker or **Manage builds** without reconfiguring each step separately.

## 1. Sources

Register GitHub repos, local folders, or zip archives. Assign **categories**, set **import rules** (which folders contain STLs), and **sync** to download files. The source library shows sync status and **update available** badges when upstream repos change. Use the global STL search box to find files by name or path across every synced repo.

## 2. Build

Open **Build** for the active plan:

- **Manage builds** — create or switch plans (see above).
- **Attach sources** — set a base layer and optional add-on layers from your source library.
- **Pick STL files** — expand each source card, check files or folders to include; selections save automatically.
- **Role filament colors** — assign a color per role (primary, accent, clear, opaque); previews update automatically on Build, Review, and Checkoff.
- **Kit manifest options** — apply stack presets and variant picks on the base source card when manifests are configured.
- **Update build** — recomputes parts from your file picks. A **stale build** banner appears when sources or selections changed; click **Update build** or enable **auto-recompute stale builds** in Settings.
- **Docs** — read synced repo README and Markdown inline from each source card.
- **Share build** — export a \`.print-partner-kit\` zip to share plan config (not STLs).
- **Export STLs** — export from Build or Review, grouped by color only or color + source directory.

## 3. Review

Confirm a **validation summary** grouped by role and filament. Browse the full included-parts list with **3D STL previews**, edit quantities, and fix issues (cards link back to Build when needed). **Export STLs** writes parts organized by role and folder structure.

## 4. Checkoff

Track **per-unit print progress** on the shop floor (saved per plan). Filter to missing or done parts, print an HTML checklist, and **Export missing STLs** for the next print batch. On-scroll **3D thumbnails** render client-side for each part.

## Tips

- **⌘K / Ctrl+K** — command palette for sync, recompute, exports, navigation, and **Manage builds**.
- **Theme** — light, dark, or system via the sidebar or header; the left sidebar can be **collapsed** to an icon rail (toggle at the bottom).
- **Progress widget** — the sidebar shows a first-run checklist until you complete Sources through Checkoff once; it then hides automatically.
- **Save / Import colors** — export role colors as JSON on Build; **Advanced** menu has reset and thumbnail recovery options.
- **Share build** — export plan config as a \`.print-partner-kit\` zip (not STLs).
- **Spoolman** — connect in Settings → Integrations for live filament inventory on Build and spool weights in Review / Checkoff. See the Spoolman integration doc in the repo.
- **API** — OpenAPI at \`/api/v1/openapi.json\` for automation; optional API key in self-host mode.
`;
