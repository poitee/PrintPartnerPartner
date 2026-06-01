import {
  addProfileAddonLayer,
  deleteProfileLayer,
  fetchPlanLayers,
  replaceProfileLayer,
  savePlanKitManifest,
  setProfileBaseLayer,
  type KitCatalog,
  type KitCatalogStackPreset,
  type KitManifest,
  type ProfileLayer,
  type SourceSummary,
} from "../api/engine";

/** Which addon category a synced source name belongs to (first match). */
function catalogCategoryForSource(
  catalog: KitCatalog,
  sourceName: string,
): string | null {
  for (const [catId, cat] of Object.entries(catalog.addon_categories)) {
    if (cat.sources.some((s) => s.name === sourceName)) return catId;
  }
  return null;
}

/** Addon layer whose project matches a source listed under the category. */
function findAddonLayerForCategory(
  categoryId: string,
  catalog: KitCatalog,
  addonLayers: ProfileLayer[],
): ProfileLayer | null {
  const cat = catalog.addon_categories[categoryId];
  if (!cat) return null;
  const names = new Set(cat.sources.map((s) => s.name));
  return (
    addonLayers.find((l) => l.project_name != null && names.has(l.project_name)) ?? null
  );
}

export type ApplyStackPresetResult = {
  layers: ProfileLayer[];
  kit: KitManifest;
  missingSources: string[];
};

export type ApplyStackPresetDeps = {
  profileId: number;
  preset: KitCatalogStackPreset;
  catalog: KitCatalog;
  sources: SourceSummary[];
  currentLayers: ProfileLayer[];
  currentKit: KitManifest | null;
};

/** Resolve catalog base id to synced project id. */
export function resolveBaseProjectId(
  catalog: KitCatalog,
  baseId: string,
  sources: SourceSummary[],
): number | null {
  const baseDef = catalog.bases[baseId];
  if (!baseDef) return null;
  const synced = sources.find((s) => s.name === baseDef.source_name);
  return synced?.id ?? null;
}

/** Resolve source name to synced project id. */
export function resolveSourceProjectId(
  sourceName: string,
  sources: SourceSummary[],
): number | null {
  const synced = sources.find((s) => s.name === sourceName);
  return synced?.id ?? null;
}

function emptyKit(current: KitManifest | null): KitManifest {
  return {
    name: current?.name ?? null,
    layers: current?.layers ?? [],
    selections: {},
    include: current?.include ?? [],
    exclude: current?.exclude ?? [],
    replacements: current?.replacements ?? {},
    choice_tree: current?.choice_tree ?? [],
  };
}

/**
 * Apply a stack preset using existing layer endpoints:
 * PUT /layers/base, POST /layers, savePlanKitManifest for selections.
 */
export async function applyStackPreset(
  deps: ApplyStackPresetDeps,
): Promise<ApplyStackPresetResult> {
  const { profileId, preset, catalog, sources, currentKit } = deps;
  const missingSources: string[] = [];

  const baseProjectId = resolveBaseProjectId(catalog, preset.base, sources);
  if (baseProjectId == null) {
    const baseDef = catalog.bases[preset.base];
    missingSources.push(baseDef?.source_name ?? preset.base);
    throw new Error(
      `Sync ${baseDef?.source_name ?? preset.base} on Sources before applying this preset.`,
    );
  }

  let layers = await setProfileBaseLayer(profileId, baseProjectId);
  const addonLayers = () => layers.filter((l) => l.layer_type !== "base");

  for (const sourceName of preset.addon_sources) {
    const projectId = resolveSourceProjectId(sourceName, sources);
    if (projectId == null) {
      missingSources.push(sourceName);
      continue;
    }

    const categoryId = catalogCategoryForSource(catalog, sourceName);
    if (categoryId) {
      const catRule = catalog.addon_categories[categoryId]?.rule ?? "pick_one";
      const existing = findAddonLayerForCategory(categoryId, catalog, addonLayers());
      if (catRule === "pick_one") {
        let keeperId = existing?.id;
        if (existing) {
          if (existing.project_id !== projectId) {
            layers = await replaceProfileLayer(profileId, existing.id, projectId);
          }
        } else {
          layers = await addProfileAddonLayer(profileId, projectId);
          keeperId = layers.find((l) => l.project_id === projectId)?.id;
        }
        for (const layer of addonLayers()) {
          if (keeperId != null && layer.id === keeperId) continue;
          const layerCat = layer.project_name
            ? catalogCategoryForSource(catalog, layer.project_name)
            : null;
          if (layerCat === categoryId) {
            await deleteProfileLayer(profileId, layer.id);
            layers = await fetchPlanLayers(profileId);
          }
        }
      } else if (!addonLayers().some((l) => l.project_id === projectId)) {
        layers = await addProfileAddonLayer(profileId, projectId);
      }
    } else if (!addonLayers().some((l) => l.project_id === projectId)) {
      layers = await addProfileAddonLayer(profileId, projectId);
    }
  }

  const nextSelections = { ...(currentKit?.selections ?? {}), ...preset.default_selections };
  const kit: KitManifest = {
    ...(currentKit ?? emptyKit(currentKit)),
    selections: nextSelections,
  };
  await savePlanKitManifest(profileId, kit);

  return { layers, kit, missingSources };
}

/** Catalog base id for a synced source name, if any. */
export function catalogBaseIdForSource(
  catalog: KitCatalog,
  sourceName: string,
): string | null {
  for (const [id, base] of Object.entries(catalog.bases)) {
    if (base.source_name === sourceName) return id;
  }
  return null;
}
