import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchFilamentCatalog,
  fetchRoleFilaments,
  fetchSpoolmanSpools,
  regeneratePlanThumbnails,
  saveRoleFilament,
  DEFAULT_STL_NAMING_PROFILE,
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
import FilamentSwatch, { catalogColorGroups } from "./FilamentSwatch";
import { Button } from "./ui/button";
import { filterFilamentSpools, formatSpoolOptionLabel } from "../lib/spoolPickerUtils";

const ROLE_LABELS = Object.fromEntries(
  DEFAULT_STL_NAMING_PROFILE.roles.map((r) => [r.id, r.label]),
) as Record<StlNamingRoleId, string>;

function formatSpoolOption(spool: SpoolmanSpoolRow): string {
  return formatSpoolOptionLabel(spool);
}

type Props = {
  profileId: number;
  disabled?: boolean;
  /** Bump after Update build so roles/part counts reload. */
  refreshKey?: number;
  onUpdated?: () => void;
};

export default function RoleFilamentPicker({
  profileId,
  disabled,
  refreshKey = 0,
  onUpdated,
}: Props) {
  const [rows, setRows] = useState<RoleFilamentRow[]>([]);
  const [catalog, setCatalog] = useState<FilamentCatalog | null>(null);
  const [spools, setSpools] = useState<SpoolmanSpoolRow[]>([]);
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
        cleared > 0
          ? `Regenerating thumbnails (${cleared} cleared)`
          : "Thumbnails refreshed",
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

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading role colors…
      </p>
    );
  }

  return (
    <div className="role-filament-picker space-y-3">
      {spoolmanHint && (
        <p className="text-sm text-muted-foreground">{spoolmanHint}</p>
      )}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      <ul className="space-y-2">
        {rows.map((row) => {
          const label = ROLE_LABELS[row.role as StlNamingRoleId] ?? row.role;
          const busy = savingRole === row.role || disabled;
          const filamentParsed = parseSpoolmanFilamentId(row.filament_color_id ?? "");
          const roleSpools = filamentParsed
            ? filterFilamentSpools(spools, filamentParsed.filamentId)
            : [];
          const selectedSpoolId = parseSpoolmanSpoolId(row.spoolman_spool_id ?? "")?.spoolId;
          return (
            <li
              key={row.role}
              className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <FilamentSwatch hex={row.filament_hex} label={row.filament_display || label} />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {row.part_count} part{row.part_count === 1 ? "" : "s"}
                </span>
              </div>
              <select
                className="min-h-10 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2 text-base sm:min-w-[10rem] sm:py-1 sm:text-sm"
                value={row.filament_color_id ?? ""}
                disabled={busy || !catalog}
                onChange={(e) => void onPickCatalog(row.role, e.target.value)}
                aria-label={`Catalog color for ${label}`}
              >
                <option value="">Custom / unset catalog</option>
                {colorGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.colors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.combo_label || c.display_name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {spoolmanConfigured && filamentParsed && roleSpools.length > 0 && (
                <select
                  className="min-h-10 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2 text-base sm:min-w-[10rem] sm:py-1 sm:text-sm"
                  value={selectedSpoolId != null ? String(selectedSpoolId) : ""}
                  disabled={busy}
                  onChange={(e) => void onPickSpool(row, e.target.value)}
                  aria-label={`Physical spool for ${label}`}
                >
                  <option value="">Any spool (inventory summary)</option>
                  {roleSpools.map((spool) => (
                    <option key={spool.id} value={String(spool.id)}>
                      {formatSpoolOption(spool)}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="color"
                className="h-11 w-12 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5 sm:h-8 sm:w-10"
                defaultValue={row.filament_hex?.slice(0, 7) ?? "#c41230"}
                key={`${row.role}-${row.filament_hex ?? "none"}-${row.filament_color_id ?? ""}`}
                disabled={busy}
                title={`Custom hex for ${label}`}
                onBlur={(e) => void onPickCustomHex(row.role, e.target.value)}
              />
              {row.filament_display && (
                <span className="text-xs text-muted-foreground">{row.filament_display}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void load()}>
          Refresh roles
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || rows.length === 0}
          onClick={onSaveColors}
        >
          Save colors
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || busyAction !== null}
          onClick={() => void onImportColors()}
        >
          {busyAction === "import" ? "Importing…" : "Import colors"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || busyAction !== null}
          onClick={() => void onRegenerateThumbnails()}
          title="Clear cached thumbnails so colors regenerate"
        >
          {busyAction === "regenerate" ? "Regenerating…" : "Regenerate thumbnails"}
        </Button>
      </div>
    </div>
  );
}
