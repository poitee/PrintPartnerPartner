/** Configurable STL filename naming rules (ported from Python stl_naming.py). */

export const STL_NAMING_DEFAULTS_KEY = "stl_naming_defaults";

export const CANONICAL_ROLE_IDS = new Set(["primary", "accent", "clear", "opaque"]);

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

export type StlNamingProfileDict = {
  roles: StlNamingRole[];
  quantity: { regex: string; default: number };
  slug: { strip_markers: boolean; strip_quantity: boolean };
  folder_rules: StlNamingFolderRule[];
  export_role_order: StlNamingRoleId[];
};

export const DEFAULT_NAMING_PROFILE: StlNamingProfileDict = {
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

export type NamingProfile = {
  roles: readonly StlNamingRole[];
  quantityRegex: string;
  quantityDefault: number;
  slugStripMarkers: boolean;
  slugStripQuantity: boolean;
  folderRules: readonly StlNamingFolderRule[];
  exportRoleOrder: readonly StlNamingRoleId[];
  quantityRe: RegExp;
  markerRoleMap: ReadonlyArray<readonly [string, StlNamingRoleId]>;
  rolePrefixRes: readonly RegExp[];
  quantityStripRe: RegExp | null;
  toDict(): StlNamingProfileDict;
};

function compileQuantityStrip(quantityRegex: string): RegExp | null {
  let strip = quantityRegex.trim();
  if (!strip) return null;
  strip = strip.replace(/\(\?P<\w+>/g, "(");
  strip = strip.replace(/\(\?:/g, "(");
  strip = strip.replace(/\([^?][^)]*\)/, "[0-9]+");
  strip = strip.replace(/\\\.stl\$/, "$");
  strip = strip.replace(/\.stl$/i, "$");
  try {
    return new RegExp(strip, "i");
  } catch {
    return null;
  }
}

function buildProfile(data: StlNamingProfileDict): NamingProfile {
  const roles = data.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error("roles must be a non-empty list");
  }

  for (const role of roles) {
    if (!CANONICAL_ROLE_IDS.has(role.id)) {
      throw new Error(`invalid role id: ${role.id}`);
    }
  }
  if (!roles.some((r) => r.id === "primary")) {
    throw new Error("roles must include primary");
  }

  const quantityRegex = data.quantity.regex.trim();
  if (!quantityRegex) throw new Error("quantity.regex is required");

  let quantityRe: RegExp;
  try {
    quantityRe = new RegExp(quantityRegex, "i");
  } catch (e) {
    throw new Error(`quantity.regex is invalid: ${e}`, { cause: e });
  }
  const groups = quantityRegex.match(/\((?!\?:)/g);
  if (!groups || groups.length !== 1) {
    throw new Error("quantity.regex must contain exactly one capture group");
  }

  const quantityDefault = Math.max(1, Math.floor(data.quantity.default ?? 1));

  const markerPairs: Array<[string, StlNamingRoleId]> = [];
  const prefixRes: RegExp[] = [];
  for (const role of roles) {
    for (const marker of role.markers) {
      if (!marker.trim()) continue;
      markerPairs.push([marker, role.id]);
      try {
        prefixRes.push(new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
      } catch {
        /* skip invalid marker regex */
      }
    }
  }
  markerPairs.sort((a, b) => b[0].length - a[0].length);

  const exportOrder = data.export_role_order.map((x) => x.toLowerCase() as StlNamingRoleId);
  if (
    exportOrder.length !== CANONICAL_ROLE_IDS.size ||
    new Set(exportOrder).size !== CANONICAL_ROLE_IDS.size ||
    !exportOrder.every((id) => CANONICAL_ROLE_IDS.has(id))
  ) {
    throw new Error("export_role_order must list each role id exactly once");
  }

  const profile: NamingProfile = {
    roles,
    quantityRegex,
    quantityDefault,
    slugStripMarkers: data.slug.strip_markers ?? true,
    slugStripQuantity: data.slug.strip_quantity ?? true,
    folderRules: data.folder_rules ?? [],
    exportRoleOrder: exportOrder,
    quantityRe,
    markerRoleMap: markerPairs,
    rolePrefixRes: prefixRes,
    quantityStripRe: compileQuantityStrip(quantityRegex),
    toDict() {
      return {
        roles: [...this.roles],
        quantity: { regex: this.quantityRegex, default: this.quantityDefault },
        slug: {
          strip_markers: this.slugStripMarkers,
          strip_quantity: this.slugStripQuantity,
        },
        folder_rules: [...this.folderRules],
        export_role_order: [...this.exportRoleOrder],
      };
    },
  };
  return profile;
}

let defaultProfile: NamingProfile | null = null;

export function getDefaultNamingProfile(): NamingProfile {
  if (!defaultProfile) {
    defaultProfile = buildProfile(structuredClone(DEFAULT_NAMING_PROFILE));
  }
  return defaultProfile;
}

export function resetDefaultNamingProfileCache(): void {
  defaultProfile = null;
}

export function validateNamingProfile(data: unknown): StlNamingProfileDict {
  if (!data || typeof data !== "object") throw new Error("profile must be an object");
  return buildProfile(data as StlNamingProfileDict).toDict();
}

export function namingProfileFromDict(data: StlNamingProfileDict): NamingProfile {
  return buildProfile(validateNamingProfile(data));
}

export function mergeNamingProfiles(
  base: StlNamingProfileDict,
  override: Partial<StlNamingProfileDict>,
): StlNamingProfileDict {
  const merged = structuredClone(base) as StlNamingProfileDict;
  if (override.roles) {
    const byId = new Map(merged.roles.map((r) => [r.id, { ...r }]));
    for (const item of override.roles) {
      const prev = byId.get(item.id) ?? { id: item.id, label: item.id, markers: [] };
      byId.set(item.id, {
        ...prev,
        ...item,
        markers: item.markers ?? prev.markers,
      });
    }
    merged.roles = [...byId.values()];
  }
  if (override.quantity) {
    merged.quantity = { ...merged.quantity, ...override.quantity };
  }
  if (override.slug) {
    merged.slug = { ...merged.slug, ...override.slug };
  }
  if (override.folder_rules) merged.folder_rules = override.folder_rules;
  if (override.export_role_order) merged.export_role_order = override.export_role_order;
  return validateNamingProfile(merged);
}

export function parseSourceNamingMetadata(
  metadata: Record<string, unknown> | null | undefined,
): { useDefaults: boolean; override: Partial<StlNamingProfileDict> } {
  if (!metadata) return { useDefaults: true, override: {} };
  const naming = metadata.naming;
  if (!naming || typeof naming !== "object") return { useDefaults: true, override: {} };
  const n = naming as Record<string, unknown>;
  const useDefaults = n.use_defaults !== false;
  const override =
    n.override && typeof n.override === "object"
      ? (n.override as Partial<StlNamingProfileDict>)
      : {};
  return { useDefaults, override };
}

export function resolveNamingProfile(
  globalDict: StlNamingProfileDict,
  metadata: Record<string, unknown> | null | undefined,
): NamingProfile {
  const { useDefaults, override } = parseSourceNamingMetadata(metadata);
  if (useDefaults) return namingProfileFromDict(globalDict);
  if (Object.keys(override).length > 0) {
    return namingProfileFromDict(mergeNamingProfiles(globalDict, override));
  }
  return namingProfileFromDict(globalDict);
}
