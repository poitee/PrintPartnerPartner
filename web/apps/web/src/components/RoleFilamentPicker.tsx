import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Download, RefreshCw, Search, Upload } from "lucide-react";
import {
  fetchFilamentCatalog,
  fetchRoleFilaments,
  fetchSpoolmanSpools,
  regeneratePlanThumbnails,
  saveRoleFilament,
  DEFAULT_STL_NAMING_PROFILE,
  type CatalogColor,
  type FilamentCatalog,
  type RoleFilamentRow,
  type SpoolmanSpoolRow,
  type StlNamingRoleId,
} from "../api/engine";
import {
  applyColorPreset,
  downloadColorPreset,
  parseColorPreset,
  pickColorPresetFile,
} from "../lib/colorPresets";
import { bumpThumbnailCache } from "../lib/thumbnailCache";
import {
  buildSpoolmanSpoolId,
  parseSpoolmanFilamentId,
  parseSpoolmanSpoolId,
} from "../lib/spoolmanIds";
import { isSpoolmanIntegrationConfigured } from "../hooks/useSpoolmanEnabled";
import { catalogColorGroups } from "./FilamentSwatch";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { filterFilamentSpools, formatSpoolOptionLabel } from "../lib/spoolPickerUtils";

const ROLE_LABELS = Object.fromEntries(
  DEFAULT_STL_NAMING_PROFILE.roles.map((r) => [r.id, r.label]),
) as Record<StlNamingRoleId, string>;

const DEFAULT_HEX = "#c41230";

type ColorGroup = { label: string; colors: CatalogColor[] };

type Props = {
  profileId: number;
  disabled?: boolean;
  /** Bump after Update build so roles/part counts reload. */
  refreshKey?: number;
  onUpdated?: () => void;
};

function normalizeHex(hex: string): string | null {
  const m = hex.trim().replace(/^#?/, "");
  if (/^[0-9a-fA-F]{6}$/.test(m)) return `#${m.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(m)) {
    return `#${m
      .split("")
      .map((c) => c + c)
      .join("")
      .toLowerCase()}`;
  }
  return null;
}

type RoleColorRowProps = {
  row: RoleFilamentRow;
  label: string;
  busy: boolean;
  colorGroups: ColorGroup[];
  spoolmanConfigured: boolean;
  roleSpools: SpoolmanSpoolRow[];
  selectedSpoolId?: number;
  onPickCatalog: (colorId: string) => void | Promise<void>;
  onPickCustomHex: (hex: string) => void | Promise<void>;
  onPickSpool: (spoolId: string) => void | Promise<void>;
};

function RoleColorRow({
  row,
  label,
  busy,
  colorGroups,
  spoolmanConfigured,
  roleSpools,
  selectedSpoolId,
  onPickCatalog,
  onPickCustomHex,
  onPickSpool,
}: RoleColorRowProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hexDraft, setHexDraft] = useState(row.filament_hex?.slice(0, 7) ?? DEFAULT_HEX);

  // Keep the custom-hex draft in sync when the saved color changes.
  useEffect(() => {
    setHexDraft(row.filament_hex?.slice(0, 7) ?? DEFAULT_HEX);
  }, [row.filament_hex]);

  const swatchHex = row.filament_hex ?? null;
  const hasColor = Boolean(row.filament_color_id || row.filament_custom_hex);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return colorGroups;
    return colorGroups
      .map((g) => ({
        label: g.label,
        colors: g.colors.filter((c) =>
          `${c.display_name} ${c.combo_label} ${c.product_line}`.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.colors.length > 0);
  }, [colorGroups, query]);

  const applyCustomHex = (hex: string) => {
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    void onPickCustomHex(normalized);
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            className="flex flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            aria-label={`Change ${label} color`}
          >
            <span
              className="h-8 w-8 shrink-0 rounded-md border border-border shadow-sm"
              style={{
                backgroundColor: swatchHex ?? "transparent",
                backgroundImage: swatchHex
                  ? undefined
                  : "repeating-conic-gradient(var(--muted, #e5e7eb) 0% 25%, transparent 0% 50%)",
                backgroundSize: swatchHex ? undefined : "10px 10px",
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {row.part_count} part{row.part_count === 1 ? "" : "s"}
                </span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {row.filament_display || (hasColor ? swatchHex : "No color set")}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-3">
            <p className="text-sm font-medium">Set {label} color</p>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Custom color</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
                  value={normalizeHex(hexDraft) ?? DEFAULT_HEX}
                  onChange={(e) => {
                    setHexDraft(e.target.value);
                    applyCustomHex(e.target.value);
                  }}
                  aria-label={`Custom color for ${label}`}
                />
                <Input
                  value={hexDraft}
                  onChange={(e) => setHexDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyCustomHex(hexDraft);
                  }}
                  onBlur={() => applyCustomHex(hexDraft)}
                  placeholder="#RRGGBB"
                  className="h-9 font-mono"
                  aria-label={`Hex value for ${label}`}
                />
              </div>
            </div>

            {spoolmanConfigured && roleSpools.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Physical spool</p>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={selectedSpoolId != null ? String(selectedSpoolId) : ""}
                  onChange={(e) => void onPickSpool(e.target.value)}
                  aria-label={`Physical spool for ${label}`}
                >
                  <option value="">Any spool (inventory summary)</option>
                  {roleSpools.map((spool) => (
                    <option key={spool.id} value={String(spool.id)}>
                      {formatSpoolOptionLabel(spool)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="relative mb-2">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search catalog colors…"
                  className="h-9 pl-8"
                  aria-label="Search catalog colors"
                />
              </div>
              <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                {filteredGroups.length === 0 && (
                  <p className="text-xs text-muted-foreground">No colors match “{query}”.</p>
                )}
                {filteredGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <div className="grid grid-cols-7 gap-1.5">
                      {group.colors.map((c) => {
                        const active = row.filament_color_id === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            title={c.combo_label || c.display_name}
                            aria-label={c.combo_label || c.display_name}
                            onClick={() => {
                              void onPickCatalog(c.id);
                              setOpen(false);
                            }}
                            className={`relative flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition-transform hover:scale-110 ${
                              active ? "border-foreground ring-2 ring-ring" : "border-border"
                            }`}
                            style={{ backgroundColor: c.hex }}
                          >
                            {active && (
                              <Check className="h-3.5 w-3.5 text-white mix-blend-difference" aria-hidden />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasColor}
                onClick={() => {
                  void onPickCatalog("");
                  setOpen(false);
                }}
              >
                Clear color
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </li>
  );
}

export default function RoleFilamentPicker({
  profileId,
  disabled,
  refreshKey = 0,
  onUpdated,
}: Props) {
  const [rows, setRows] = useState<RoleFilamentRow[]>([]);
  const [catalog, setCatalog] = useState<FilamentCatalog | null>(null);
  const [spools, setSpools] = useState<SpoolmanSpoolRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"import" | "regenerate" | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [roleRows, cat] = await Promise.all([
        fetchRoleFilaments(profileId),
        fetchFilamentCatalog(),
      ]);
      setRows(roleRows);
      setCatalog(cat);
      const integrationId = cat.default_spoolman_integration_id?.trim();
      if (integrationId && isSpoolmanIntegrationConfigured(cat)) {
        try {
          setSpools(await fetchSpoolmanSpools(integrationId));
        } catch {
          setSpools([]);
        }
      } else {
        setSpools([]);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const colorGroups = useMemo(() => catalogColorGroups(catalog), [catalog]);

  const onPickCatalog = async (role: string, colorId: string) => {
    setSavingRole(role);
    try {
      const result = await saveRoleFilament(profileId, {
        role,
        filament_color_id: colorId || null,
        filament_custom_hex: null,
        spoolman_spool_id: null,
      });
      setRows(result.roles);
      bumpThumbnailCache();
      if (result.updated === 0) {
        toast.message(
          `Saved ${ROLE_LABELS[role as StlNamingRoleId] ?? role} color — applies when parts with that role are included.`,
        );
      }
      onUpdated?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRole(null);
    }
  };

  const onPickSpool = async (row: RoleFilamentRow, spoolId: string) => {
    const parsed = parseSpoolmanFilamentId(row.filament_color_id ?? "");
    if (!parsed) return;
    setSavingRole(row.role);
    try {
      const spoolman_spool_id = spoolId
        ? buildSpoolmanSpoolId(parsed.integrationId, Number(spoolId))
        : null;
      const result = await saveRoleFilament(profileId, {
        role: row.role,
        filament_color_id: row.filament_color_id,
        spoolman_spool_id,
      });
      setRows(result.roles);
      onUpdated?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRole(null);
    }
  };

  const onPickCustomHex = async (role: string, hex: string) => {
    setSavingRole(role);
    try {
      const result = await saveRoleFilament(profileId, {
        role,
        filament_color_id: null,
        filament_custom_hex: hex || null,
        spoolman_spool_id: null,
      });
      setRows(result.roles);
      bumpThumbnailCache();
      if (result.updated === 0) {
        toast.message(`Saved ${ROLE_LABELS[role as StlNamingRoleId] ?? role} custom color.`);
      }
      onUpdated?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRole(null);
    }
  };

  const onSaveColors = () => {
    if (rows.length === 0) {
      setLoadError("No colors to save yet — assign role colors first.");
      return;
    }
    downloadColorPreset(rows);
    toast.success("Saved colors to print-partner-colors.json");
  };

  const onImportColors = async () => {
    setLoadError(null);
    const file = await pickColorPresetFile();
    if (!file) return;
    setBusyAction("import");
    try {
      const preset = await parseColorPreset(file);
      const applied = await applyColorPreset(profileId, preset);
      await load();
      bumpThumbnailCache();
      onUpdated?.();
      toast.success(`Imported colors for ${applied} role${applied === 1 ? "" : "s"}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const onRegenerateThumbnails = async () => {
    setLoadError(null);
    setBusyAction("regenerate");
    try {
      const { cleared } = await regeneratePlanThumbnails(profileId);
      bumpThumbnailCache();
      onUpdated?.();
      toast.success(
        cleared > 0 ? `Regenerating thumbnails (${cleared} cleared)` : "Thumbnails refreshed",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const spoolmanConfigured = isSpoolmanIntegrationConfigured(catalog);

  const spoolmanHint = useMemo(() => {
    if (!catalog?.default_spoolman_integration_id) return null;
    const spoolmanCount = catalog.spoolman_colors?.length ?? 0;
    if (spoolmanCount > 0) return null;
    if (catalog.spoolman_error) {
      return `Spoolman: ${catalog.spoolman_error}`;
    }
    if (catalog.spoolman_status === "disabled") {
      return "Spoolman integration is disabled — enable it in Settings → Integrations.";
    }
    return "Spoolman is enabled but returned no filaments — use Test connection in Settings (check base URL is reachable from the server, not localhost from Docker).";
  }, [catalog]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading role colors…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No included parts yet — pick STL files above and run <strong>Update build</strong> to
        assign colors by role.
      </p>
    );
  }

  return (
    <div className="role-filament-picker space-y-3">
      {spoolmanHint && <p className="text-sm text-muted-foreground">{spoolmanHint}</p>}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <ul className="space-y-2">
        {rows.map((row) => {
          const label = ROLE_LABELS[row.role as StlNamingRoleId] ?? row.role;
          const filamentParsed = parseSpoolmanFilamentId(row.filament_color_id ?? "");
          const roleSpools = filamentParsed
            ? filterFilamentSpools(spools, filamentParsed.filamentId)
            : [];
          const selectedSpoolId = parseSpoolmanSpoolId(row.spoolman_spool_id ?? "")?.spoolId;
          return (
            <RoleColorRow
              key={row.role}
              row={row}
              label={label}
              busy={savingRole === row.role || Boolean(disabled)}
              colorGroups={colorGroups}
              spoolmanConfigured={spoolmanConfigured}
              roleSpools={roleSpools}
              selectedSpoolId={selectedSpoolId}
              onPickCatalog={(colorId) => onPickCatalog(row.role, colorId)}
              onPickCustomHex={(hex) => onPickCustomHex(row.role, hex)}
              onPickSpool={(spoolId) => onPickSpool(row, spoolId)}
            />
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="mr-auto text-xs text-muted-foreground">
          Click a role to change its color.
        </span>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onSaveColors}>
          <Download className="h-4 w-4" aria-hidden />
          Save colors
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busyAction !== null}
          onClick={() => void onImportColors()}
        >
          <Upload className="h-4 w-4" aria-hidden />
          {busyAction === "import" ? "Importing…" : "Import colors"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || busyAction !== null}
          onClick={() => void onRegenerateThumbnails()}
          title="Clear cached thumbnails so updated colors re-render"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {busyAction === "regenerate" ? "Regenerating…" : "Regenerate thumbnails"}
        </Button>
      </div>
    </div>
  );
}
