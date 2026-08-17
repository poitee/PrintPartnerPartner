import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  createSlicerInstance,
  deleteSlicerInstance,
  fetchSlicerInstances,
  seedDefaultSlicerInstances,
  updateSlicerInstance,
  type SlicerDialect,
  type SlicerInstance,
  type SlicerInstanceKind,
} from "../../api/engine";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type SlicersSettingsCardProps = {
  engineReady: boolean;
};

const PRESET_KINDS: Array<{ kind: Exclude<SlicerInstanceKind, "custom">; label: string }> = [
  { kind: "orca", label: "OrcaSlicer" },
  { kind: "prusa", label: "PrusaSlicer" },
  { kind: "bambu", label: "BambuStudio" },
];

function defaultDialect(kind: SlicerInstanceKind): SlicerDialect {
  if (kind === "prusa") return "prusa_ini";
  if (kind === "bambu") return "bambu_json";
  return "orca_json";
}

export default function SlicersSettingsCard({ engineReady }: SlicersSettingsCardProps) {
  const [instances, setInstances] = useState<SlicerInstance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<SlicerInstanceKind>("orca");
  const [draftDialect, setDraftDialect] = useState<SlicerDialect>("orca_json");
  const [draftGuiUrl, setDraftGuiUrl] = useState("");
  const [draftWatchPath, setDraftWatchPath] = useState("");

  const refresh = useCallback(async () => {
    if (!engineReady) return;
    try {
      setInstances(await fetchSlicerInstances());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = async (row: SlicerInstance, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updateSlicerInstance(row.id, { enabled });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveField = async (
    row: SlicerInstance,
    patch: Partial<{ name: string; gui_url: string; watch_path: string; dialect: SlicerDialect }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await updateSlicerInstance(row.id, patch);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (row: SlicerInstance) => {
    if (!window.confirm(`Delete slicer “${row.name}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSlicerInstance(row.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async () => {
    const name = draftName.trim() || PRESET_KINDS.find((p) => p.kind === draftKind)?.label || "Slicer";
    setBusy(true);
    setError(null);
    try {
      await createSlicerInstance({
        name,
        kind: draftKind,
        dialect: draftKind === "custom" ? draftDialect : defaultDialect(draftKind),
        gui_url: draftGuiUrl.trim(),
        watch_path: draftWatchPath.trim(),
        enabled: true,
      });
      setDraftName("");
      setDraftGuiUrl("");
      setDraftWatchPath("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSeed = async () => {
    setBusy(true);
    setError(null);
    try {
      await seedDefaultSlicerInstances();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="slicers" className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Slicers</CardTitle>
        <CardDescription>
          Register slicer GUIs and profile watch paths. Profile sync and Export links use enabled
          instances. Restart the server after changing watch paths so sync picks them up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {instances.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No slicer instances yet.</p>
            <Button type="button" size="sm" onClick={() => void onSeed()} disabled={busy || !engineReady}>
              Seed defaults (Orca / Prusa / Bambu)
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {instances.map((row) => (
              <li key={row.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="h-8 max-w-[12rem]"
                    defaultValue={row.name}
                    disabled={busy}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== row.name) void onSaveField(row, { name: next });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{row.kind}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Enabled</span>
                    <Switch
                      checked={row.enabled}
                      disabled={busy}
                      onCheckedChange={(v) => void onToggle(row, v)}
                    />
                    {row.gui_url ? (
                      <Button variant="outline" size="sm" asChild className="gap-1">
                        <a href={row.gui_url} target="_blank" rel="noreferrer noopener">
                          Open GUI
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onDelete(row)}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">GUI URL</span>
                    <Input
                      className="h-8"
                      defaultValue={row.gui_url}
                      disabled={busy}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== row.gui_url) void onSaveField(row, { gui_url: next });
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">Watch path</span>
                    <Input
                      className="h-8 font-mono"
                      defaultValue={row.watch_path}
                      disabled={busy}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== row.watch_path) void onSaveField(row, { watch_path: next });
                      }}
                    />
                  </label>
                </div>
                {row.kind === "custom" ? (
                  <label className="block max-w-xs space-y-1 text-xs">
                    <span className="text-muted-foreground">Dialect</span>
                    <Select
                      value={row.dialect}
                      onValueChange={(v) => void onSaveField(row, { dialect: v as SlicerDialect })}
                      disabled={busy}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="orca_json">orca_json</SelectItem>
                        <SelectItem value="bambu_json">bambu_json</SelectItem>
                        <SelectItem value="prusa_ini">prusa_ini</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                ) : (
                  <p className="text-xs text-muted-foreground">Dialect: {row.dialect}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <p className="text-sm font-medium">Add slicer</p>
          <div className="flex flex-wrap gap-2">
            <Select
              value={draftKind}
              onValueChange={(v) => {
                const kind = v as SlicerInstanceKind;
                setDraftKind(kind);
                setDraftDialect(defaultDialect(kind));
              }}
            >
              <SelectTrigger className="h-8 w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_KINDS.map((p) => (
                  <SelectItem key={p.kind} value={p.kind}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-8 max-w-[12rem]"
              placeholder="Name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <Input
              className="h-8 max-w-[14rem]"
              placeholder="GUI URL"
              value={draftGuiUrl}
              onChange={(e) => setDraftGuiUrl(e.target.value)}
            />
            <Input
              className="h-8 max-w-[16rem] font-mono"
              placeholder="Watch path"
              value={draftWatchPath}
              onChange={(e) => setDraftWatchPath(e.target.value)}
            />
            {draftKind === "custom" ? (
              <Select
                value={draftDialect}
                onValueChange={(v) => setDraftDialect(v as SlicerDialect)}
              >
                <SelectTrigger className="h-8 w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="orca_json">orca_json</SelectItem>
                  <SelectItem value="bambu_json">bambu_json</SelectItem>
                  <SelectItem value="prusa_ini">prusa_ini</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            <Button type="button" size="sm" className="gap-1" disabled={busy || !engineReady} onClick={() => void onAdd()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
