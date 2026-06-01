import type { KitCatalog } from "../api/engine";

function presetLabel(groupId: string): string {
  return groupId.replace(/_/g, " ");
}

/** Kit tagging stored under metadata.kit on a source. */
export type SourceKitTag = {
  addon_category?: string | null;
  compatible_bases?: string[];
};

export type SourceKitMetadata = {
  kit?: SourceKitTag;
};

export function readSourceKitTag(
  metadata: Record<string, unknown> | null | undefined,
): SourceKitTag {
  if (!metadata || typeof metadata !== "object") return {};
  const kit = metadata.kit;
  if (!kit || typeof kit !== "object") return {};
  const row = kit as Record<string, unknown>;
  const addon_category =
    typeof row.addon_category === "string" ? row.addon_category : null;
  const compatible_bases = Array.isArray(row.compatible_bases)
    ? row.compatible_bases.filter((b): b is string => typeof b === "string")
    : [];
  return { addon_category, compatible_bases };
}

export function mergeSourceKitMetadata(
  existing: Record<string, unknown> | null | undefined,
  tag: SourceKitTag,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" ? { ...existing } : {};
  const kit: SourceKitTag = { ...tag };
  if (kit.addon_category == null || kit.addon_category === "") {
    delete kit.addon_category;
  }
  if (!kit.compatible_bases?.length) {
    delete kit.compatible_bases;
  }
  if (!kit.addon_category && !kit.compatible_bases?.length) {
    const { kit: _removed, ...rest } = base as Record<string, unknown> & {
      kit?: unknown;
    };
    void _removed;
    return rest;
  }
  return { ...base, kit };
}

export type CatalogSourceSuggestion = {
  role: "base" | "addon";
  kit: SourceKitTag;
};

/** Suggest role + kit tags when source name matches kit catalog. */
export function suggestFromCatalog(
  sourceName: string,
  catalog: KitCatalog | null,
): CatalogSourceSuggestion | null {
  if (!catalog || !sourceName.trim()) return null;

  for (const base of Object.values(catalog.bases)) {
    if (base.source_name === sourceName) {
      return { role: "base", kit: {} };
    }
  }

  for (const [catId, cat] of Object.entries(catalog.addon_categories)) {
    const entry = cat.sources.find((s) => s.name === sourceName);
    if (entry) {
      return {
        role: "addon",
        kit: {
          addon_category: catId,
          compatible_bases: entry.compatible_bases ?? [],
        },
      };
    }
  }
  return null;
}

/** @deprecated use suggestFromCatalog */
export function suggestKitTagFromCatalog(
  sourceName: string,
  catalog: KitCatalog | null,
): SourceKitTag | null {
  const hit = suggestFromCatalog(sourceName, catalog);
  return hit?.role === "addon" ? hit.kit : null;
}

export function catalogCategoryLabel(
  _catalog: KitCatalog | null,
  categoryId: string | null | undefined,
): string | null {
  if (!categoryId) return null;
  return presetLabel(categoryId) ?? categoryId.replace(/_/g, " ");
}

export function catalogBaseLabel(
  catalog: KitCatalog | null,
  baseId: string,
): string {
  return catalog?.bases[baseId]?.label ?? baseId;
}

/** Catalog source names (bases + addon repos) missing from synced sources. */
export function catalogOrphanSourceNames(
  catalog: KitCatalog,
  syncedNames: Set<string>,
): string[] {
  const names: string[] = [];
  for (const base of Object.values(catalog.bases)) {
    if (!syncedNames.has(base.source_name)) names.push(base.source_name);
  }
  for (const cat of Object.values(catalog.addon_categories)) {
    for (const src of cat.sources) {
      if (!syncedNames.has(src.name)) names.push(src.name);
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export type SourceCategoryInfo = {
  categoryId: string | null;
  categoryLabel: string | null;
  replacesSlot: string | null;
  replacesHint: string | null;
};

function slotLabel(_catalog: KitCatalog | null, slotId: string): string {
  return (presetLabel(slotId) ?? slotId.replace(/_/g, " ")).toLowerCase();
}

/** Resolve addon category + replacement hint from metadata or kit catalog. */
export function resolveSourceCategory(
  sourceName: string,
  metadata: Record<string, unknown> | null | undefined,
  catalog: KitCatalog | null,
): SourceCategoryInfo {
  const tag = readSourceKitTag(metadata);
  let categoryId = tag.addon_category ?? null;

  if (!categoryId && catalog) {
    for (const [catId, cat] of Object.entries(catalog.addon_categories)) {
      if (cat.sources.some((s) => s.name === sourceName)) {
        categoryId = catId;
        break;
      }
    }
  }

  if (!categoryId || !catalog) {
    return {
      categoryId,
      categoryLabel: categoryId ? catalogCategoryLabel(catalog, categoryId) : null,
      replacesSlot: null,
      replacesHint: null,
    };
  }

  const cat = catalog.addon_categories[categoryId];
  const replacesSlot = cat?.replaces_slot ?? null;
  const replacesHint = replacesSlot
    ? `Replaces stock ${slotLabel(catalog, replacesSlot)}`
    : null;

  return {
    categoryId,
    categoryLabel: presetLabel(categoryId) ?? categoryId.replace(/_/g, " "),
    replacesSlot,
    replacesHint,
  };
}

export function sourceNameFromLayer(sourceLayer: string | null | undefined): string | null {
  if (!sourceLayer) return null;
  const parts = sourceLayer.split(":");
  if (parts.length < 2) return null;
  return parts.slice(1).join(":");
}
