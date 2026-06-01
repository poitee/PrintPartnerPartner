import { useCallback, useEffect, useState } from "react";
import {
  createCustomFilament,
  deleteCustomFilament,
  fetchCustomFilaments,
  fetchGitHubPatSettings,
  fetchSourceUpdateCheckSettings,
  openDataFolder,
  saveGitHubPat,
  saveSourceUpdateCheckInterval,
  startCheckSourceUpdates,
  type CustomFilament,
  type GitHubPatSettings,
} from "../api/engine";
import PageHeader from "../components/layout/PageHeader";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import { StlNamingSettingsCard } from "../components/settings/StlNamingEditor";
import SourceCategoryManager from "../components/sources/SourceCategoryManager";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import SupportCta from "../components/SupportCta";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

const UPDATE_INTERVAL_OPTIONS = [
  { value: "0", label: "Off (manual only)" },
  { value: "1", label: "Every hour" },
  { value: "6", label: "Every 6 hours" },
  { value: "24", label: "Every 24 hours" },
  { value: "168", label: "Weekly" },
] as const;

export default function SettingsPage() {
  const { health } = useEngineHealth();
  const { busy: updateBusy, message: updateMessage, runJob: runUpdateJob } =
    useJobRunner("source-updates");
  const [filaments, setFilaments] = useState<CustomFilament[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newFilamentName, setNewFilamentName] = useState("");
  const [newFilamentHex, setNewFilamentHex] = useState("#c41230");
  const [githubPat, setGithubPat] = useState<GitHubPatSettings | null>(null);
  const [patInput, setPatInput] = useState("");
  const [patMessage, setPatMessage] = useState<string | null>(null);
  const [deleteFilamentId, setDeleteFilamentId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [updateIntervalHours, setUpdateIntervalHours] = useState("24");
  const [updateIntervalSaving, setUpdateIntervalSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!health) return;
    try {
      const [filamentRows, patSettings, updateSettings] = await Promise.all([
        fetchCustomFilaments(),
        fetchGitHubPatSettings(),
        fetchSourceUpdateCheckSettings(),
      ]);
      setFilaments(filamentRows);
      setGithubPat(patSettings);
      setUpdateIntervalHours(String(updateSettings.interval_hours));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [health]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAddFilament = async () => {
    if (!newFilamentName.trim()) return;
    try {
      await createCustomFilament({
        display_name: newFilamentName.trim(),
        hex: newFilamentHex,
      });
      setNewFilamentName("");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDeleteFilament = async (id: string) => {
    setDeleting(true);
    setLoadError(null);
    try {
      await deleteCustomFilament(id);
      setDeleteFilamentId(null);
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const onSaveGitHubPat = async () => {
    setPatMessage(null);
    try {
      const saved = await saveGitHubPat(patInput);
      setGithubPat(saved);
      setPatInput("");
      setPatMessage(saved.configured ? "GitHub PAT saved." : "GitHub PAT cleared.");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const onUpdateIntervalChange = async (value: string) => {
    setUpdateIntervalHours(value);
    setUpdateIntervalSaving(true);
    setLoadError(null);
    try {
      const saved = await saveSourceUpdateCheckInterval(Number(value));
      setUpdateIntervalHours(String(saved.interval_hours));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateIntervalSaving(false);
    }
  };

  const onCheckSourceUpdatesNow = () => {
    void runUpdateJob(() => startCheckSourceUpdates());
  };

  const onClearGitHubPat = async () => {
    setPatMessage(null);
    try {
      const saved = await saveGitHubPat("");
      setGithubPat(saved);
      setPatInput("");
      setPatMessage("GitHub PAT cleared.");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const inputClass =
    "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs items={[{ label: "Settings" }]} />
      <PageHeader
        title="Settings"
        description="Custom filaments, STL naming, source categories, and optional GitHub token."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void openDataFolder()}>
              Open data folder
            </Button>
            <SupportCta size="sm" />
          </>
        }
      />

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {patMessage && <p className="text-sm text-muted-foreground">{patMessage}</p>}
      {updateMessage && <p className="text-sm text-muted-foreground">{updateMessage}</p>}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Source update checks</CardTitle>
          <CardDescription>
            Compare synced Git repos to their remotes without pulling. Badges appear on
            Sources when updates are available.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Check interval</span>
            <Select
              value={updateIntervalHours}
              onValueChange={(v) => void onUpdateIntervalChange(v)}
              disabled={!health || updateIntervalSaving || updateBusy}
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPDATE_INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            variant="secondary"
            onClick={onCheckSourceUpdatesNow}
            disabled={!health || updateBusy || updateIntervalSaving}
          >
            {updateBusy ? "Checking…" : "Check now"}
          </Button>
        </CardContent>
      </Card>

      <div id="source-categories">
        <SourceCategoryManager engineReady={Boolean(health)} />
      </div>

      <StlNamingSettingsCard engineReady={Boolean(health)} />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">GitHub personal access token</CardTitle>
          <CardDescription>
            Optional. Improves GitHub API rate limits when syncing private repos. Token is stored
            locally in the engine database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {githubPat?.configured && githubPat.masked && (
            <p className="text-sm text-muted-foreground">
              Configured: <code className="font-mono text-xs">{githubPat.masked}</code>
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Token</span>
            <input
              type="password"
              className={`${inputClass} w-full max-w-md`}
              autoComplete="off"
              placeholder={githubPat?.configured ? "Enter new token to replace" : "ghp_…"}
              value={patInput}
              onChange={(e) => setPatInput(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onSaveGitHubPat()}>Save token</Button>
            <Button
              variant="secondary"
              onClick={() => void onClearGitHubPat()}
              disabled={!githubPat?.configured}
            >
              Clear token
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Custom filaments</CardTitle>
          <CardDescription>
            Named colors appear in the filament picker when assigning parts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {filaments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom filaments yet.</p>
          ) : (
            <ul className="filament-list space-y-2">
              {filaments.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <span
                    className="swatch inline-block h-5 w-5 rounded border border-border"
                    style={{ backgroundColor: f.hex }}
                    title={f.hex}
                  />
                  <span className="text-sm">
                    {f.display_name}{" "}
                    <span className="text-muted-foreground">({f.hex})</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setDeleteFilamentId(f.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={inputClass}
              placeholder="Name"
              value={newFilamentName}
              onChange={(e) => setNewFilamentName(e.target.value)}
            />
            <input
              type="color"
              value={newFilamentHex}
              onChange={(e) => setNewFilamentHex(e.target.value)}
              title="Color"
            />
            <input
              className={`hex-input ${inputClass}`}
              value={newFilamentHex}
              onChange={(e) => setNewFilamentHex(e.target.value)}
            />
            <Button onClick={() => void onAddFilament()}>Add filament</Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={deleteFilamentId != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteFilamentId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove custom filament?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteFilamentId
              ? `Remove “${filaments.find((f) => f.id === deleteFilamentId)?.display_name ?? "this filament"}” from your custom colors?`
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setDeleteFilamentId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              disabled={deleting || deleteFilamentId == null}
              onClick={() => deleteFilamentId && void onDeleteFilament(deleteFilamentId)}
            >
              {deleting ? "Removing…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
