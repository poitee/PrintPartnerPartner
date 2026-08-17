/**
 * Profile library — read-only cards for the slicer profiles synced from the
 * shared config volumes by the server-side profile-sync watcher (chokidar).
 * Each card shows the key values a printer operator cares about at a glance
 * (material, layer height, temps) plus a staleness badge telling them which
 * slicer + version last wrote the file, and how long ago.
 */
import { useEffect, useState } from "react";
import { Layers, RefreshCw, Thermometer } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { fetchProfileLibrary, formatSyncTime, type ProfileLibraryRow } from "../../api/engine";

const SLICER_LABEL: Record<string, string> = {
  orca: "OrcaSlicer",
  prusa: "PrusaSlicer",
  bambu: "BambuStudio",
};

function slicerLabel(format: string | null): string {
  if (!format) return "PP native";
  return SLICER_LABEL[format] ?? format;
}

function staleness(row: ProfileLibraryRow): { label: string; variant: "success" | "muted" } {
  if (!row.lastSyncedAt) {
    return { label: "Not synced from a slicer", variant: "muted" };
  }
  const version = row.syncedFromSlicerVersion ? ` ${row.syncedFromSlicerVersion}` : "";
  const when = formatSyncTime(row.lastSyncedAt);
  return {
    label: `Last synced from ${slicerLabel(row.slicerFormat)}${version} · ${when}`,
    variant: "success",
  };
}

function flat(row: ProfileLibraryRow): Record<string, string> {
  if (!row.resolvedFlatConfig) return {};
  try {
    return JSON.parse(row.resolvedFlatConfig) as Record<string, string>;
  } catch {
    return {};
  }
}

function keyFacts(row: ProfileLibraryRow): { label: string; value: string }[] {
  const cfg = flat(row);
  const facts: { label: string; value: string }[] = [];
  if (row.kind === "process") {
    if (cfg.layer_height) facts.push({ label: "Layer height", value: `${cfg.layer_height} mm` });
    if (cfg.perimeters) facts.push({ label: "Perimeters", value: cfg.perimeters });
    if (cfg.fill_density || cfg.infill_density) {
      facts.push({ label: "Infill", value: cfg.fill_density ?? cfg.infill_density ?? "" });
    }
  } else if (row.kind === "filament") {
    if (cfg.nozzle_temperature || cfg.temperature) {
      facts.push({ label: "Nozzle", value: `${cfg.nozzle_temperature ?? cfg.temperature}°C` });
    }
    if (cfg.bed_temperature) facts.push({ label: "Bed", value: `${cfg.bed_temperature}°C` });
    if (row.materialType) facts.push({ label: "Material", value: row.materialType });
  } else {
    if (cfg.nozzle_diameter) facts.push({ label: "Nozzle Ø", value: `${cfg.nozzle_diameter} mm` });
    if (cfg.printer_model) facts.push({ label: "Model", value: cfg.printer_model });
  }
  return facts;
}

const KIND_LABEL: Record<ProfileLibraryRow["kind"], string> = {
  printer: "Printer",
  process: "Process",
  filament: "Filament",
};

function ProfileCard({ row }: { row: ProfileLibraryRow }) {
  const stale = staleness(row);
  const facts = keyFacts(row);
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">{row.name}</p>
          <p className="text-[11px] text-muted-foreground">{KIND_LABEL[row.kind]}</p>
        </div>
      </div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center gap-1 text-muted-foreground">
              {f.label === "Nozzle" || f.label === "Bed" ? (
                <Thermometer className="h-3 w-3 shrink-0" aria-hidden />
              ) : (
                <Layers className="h-3 w-3 shrink-0" aria-hidden />
              )}
              <span>
                {f.label}: <span className="text-foreground">{f.value}</span>
              </span>
            </div>
          ))}
        </dl>
      )}
      <Badge variant={stale.variant} className="w-fit text-[10.5px]">
        {stale.label}
      </Badge>
    </div>
  );
}

export default function ProfileLibraryPanel() {
  const [rows, setRows] = useState<ProfileLibraryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetchProfileLibrary()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load profile library");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (rows != null && rows.length === 0 && !error) return null;

  return (
    <Card className="border-border shadow-sm" data-testid="profile-library-panel">
      <CardHeader className="gap-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-[13.5px] font-semibold leading-snug">Profile library</CardTitle>
            <CardDescription className="text-[12.5px] leading-relaxed">
              Synced from the slicer GUIs — read-only. Save a profile in OrcaSlicer, PrusaSlicer, or
              BambuStudio and it appears here shortly after.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows == null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <ProfileCard key={`${row.kind}-${row.id}`} row={row} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
