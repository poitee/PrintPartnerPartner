import type { AppRepository } from "../db/repository.js";
import { loadKitCatalog } from "./kit-catalog.js";

type StackPreset = {
  base: string;
  addon_sources: string[];
  default_selections: Record<string, string>;
};

type CatalogBase = { source_name: string };
type CatalogAddonCategory = { rule?: string; sources: Array<{ name: string }> };

function catalogCategoryForSource(
  catalog: Record<string, unknown>,
  sourceName: string,
): string | null {
  const cats = catalog.addon_categories as Record<string, CatalogAddonCategory> | undefined;
  if (!cats) return null;
  for (const [catId, cat] of Object.entries(cats)) {
    if (cat.sources?.some((s) => s.name === sourceName)) return catId;
  }
  return null;
}

function projectIdByName(repo: AppRepository, name: string): number | null {
  const source = repo.listSources().find((s) => s.name === name);
  return source?.id ?? null;
}

export function applyStackPresetToProfile(
  repo: AppRepository,
  profileId: number,
  presetId: string,
): {
  profile_id: number;
  preset_id: string;
  missing_sources: string[];
  layers: ReturnType<AppRepository["getProfileLayers"]>;
  selections: Record<string, string>;
} {
  const catalog = loadKitCatalog() as Record<string, unknown>;
  const presets = catalog.stack_presets as Record<string, StackPreset> | undefined;
  const preset = presets?.[presetId];
  if (!preset) throw new Error(`Unknown stack preset: ${presetId}`);

  const bases = catalog.bases as Record<string, CatalogBase> | undefined;
  const baseDef = bases?.[preset.base];
  if (!baseDef) throw new Error(`Unknown catalog base: ${preset.base}`);

  const missing: string[] = [];
  const baseProjectId = projectIdByName(repo, baseDef.source_name);
  if (baseProjectId == null) {
    throw new Error(`Sync ${baseDef.source_name} on Sources before applying this preset.`);
  }

  repo.setBaseLayer(profileId, baseProjectId);
  let layers = repo.getProfileLayers(profileId);
  const addonLayers = () => layers.filter((l) => l.layer_type !== "base");

  for (const sourceName of preset.addon_sources) {
    const projectId = projectIdByName(repo, sourceName);
    if (projectId == null) {
      missing.push(sourceName);
      continue;
    }
    const categoryId = catalogCategoryForSource(catalog, sourceName);
    if (categoryId) {
      const cats = catalog.addon_categories as Record<string, CatalogAddonCategory>;
      const catRule = cats[categoryId]?.rule ?? "pick_one";
      const names = new Set(cats[categoryId]?.sources.map((s) => s.name) ?? []);
      const existing = addonLayers().find(
        (l) => l.project_name && names.has(l.project_name),
      );
      if (catRule === "pick_one") {
        let keeperId = existing?.id;
        if (existing) {
          if (existing.project_id !== projectId) {
            repo.replaceLayer(existing.id, projectId);
            layers = repo.getProfileLayers(profileId);
          }
        } else {
          repo.addAddonLayer(profileId, projectId);
          layers = repo.getProfileLayers(profileId);
          keeperId = layers.find((l) => l.project_id === projectId)?.id;
        }
        for (const layer of addonLayers()) {
          if (keeperId != null && layer.id === keeperId) continue;
          if (layer.project_name && names.has(layer.project_name)) {
            repo.removeLayer(layer.id);
            layers = repo.getProfileLayers(profileId);
          }
        }
      } else if (!addonLayers().some((l) => l.project_id === projectId)) {
        repo.addAddonLayer(profileId, projectId);
        layers = repo.getProfileLayers(profileId);
      }
    } else if (!addonLayers().some((l) => l.project_id === projectId)) {
      repo.addAddonLayer(profileId, projectId);
      layers = repo.getProfileLayers(profileId);
    }
  }

  return {
    profile_id: profileId,
    preset_id: presetId,
    missing_sources: missing,
    layers,
    selections: { ...preset.default_selections },
  };
}
