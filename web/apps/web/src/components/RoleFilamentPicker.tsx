import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFilamentCatalog,
  fetchRoleFilaments,
  saveRoleFilament,
  DEFAULT_STL_NAMING_PROFILE,
  type FilamentCatalog,
  type RoleFilamentRow,
  type StlNamingRoleId,
} from "../api/engine";
import FilamentSwatch, { allCatalogColors } from "./FilamentSwatch";
import { Button } from "./ui/button";

const ROLE_LABELS = Object.fromEntries(
  DEFAULT_STL_NAMING_PROFILE.roles.map((r) => [r.id, r.label]),
) as Record<StlNamingRoleId, string>;

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [roleRows, cat] = await Promise.all([
        fetchRoleFilaments(profileId),
        fetchFilamentCatalog(),
      ]);
      setRows(roleRows);
      setCatalog(cat);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const colors = useMemo(() => allCatalogColors(catalog), [catalog]);

  const onPickCatalog = async (role: string, colorId: string) => {
    setSavingRole(role);
    try {
      const result = await saveRoleFilament(profileId, {
        role,
        filament_color_id: colorId || null,
        filament_custom_hex: null,
      });
      setRows(result.roles);
      if (result.updated === 0) {
        setLoadError("No included parts matched that role — run Update build first.");
      }
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
      });
      setRows(result.roles);
      if (result.updated === 0) {
        setLoadError("No included parts matched that role — run Update build first.");
      }
      onUpdated?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRole(null);
    }
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No included parts yet — update build first to assign colors by role.
      </p>
    );
  }

  return (
    <div className="role-filament-picker space-y-3">
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      <ul className="space-y-2">
        {rows.map((row) => {
          const label = ROLE_LABELS[row.role as StlNamingRoleId] ?? row.role;
          const busy = savingRole === row.role || disabled;
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
                {colors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.combo_label || c.display_name}
                  </option>
                ))}
              </select>
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
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void load()}>
        Refresh roles
      </Button>
    </div>
  );
}
