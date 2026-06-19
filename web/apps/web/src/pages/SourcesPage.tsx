import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { FolderGit2, MoreHorizontal, ArrowDownCircle, CheckCircle2 } from "lucide-react";
import {
  createSource,
  deleteSource,
  fetchSourceCategories,
  fetchSources,
  formatSyncTime,
  importReposTxt,
  importSourceArchive,
  importSourceFiles,
  pickLocalDirectory,
  pickLocalFiles,
  pickZipArchive,
  shortSha,
  startCheckSourceUpdates,
  startImportScan,
  startSync,
  updateSource,
  waitForJobDone,
  type SourceSummary,
  type StlSearchHit,
} from "../api/engine";
import GitHubBranchField from "../components/GitHubBranchField";
import EmptyState from "../components/layout/EmptyState";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import SourceCardCover from "../components/SourceCardCover";
import GlobalStlSearch from "../components/sources/GlobalStlSearch";
import SourceDetailSheet from "../components/sources/SourceDetailSheet";
import SourceCategorySheet from "../components/sources/SourceCategorySheet";
import SourcesToolbar, {
  type SourceViewMode,
  type SyncFilter,
} from "../components/sources/SourcesToolbar";
import { kindLabel, type SourceKind } from "../components/sources/sourceLabels";
import { UNCategorized_FILTER } from "../components/sources/sourceLabels";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useImportSharedBuild } from "../hooks/useImportSharedBuild";
import {
  Card,
  CardContent,
} from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import {
  loadPersistedSourcesUi,
  savePersistedSourcesUi,
} from "../lib/persistedSourcesUi";
import { toastJobResult } from "../lib/jobToasts";

type WizardForm = {
  name: string;
  url: string;
  branch: string;
  source_kind: SourceKind;
  category: string;
  pendingFiles: File[];
  pendingZip: File | null;
};

const emptyForm = (categories: string[]): WizardForm => ({
  name: "",
  url: "",
  branch: "main",
  source_kind: "github",
  category: categories[0] ?? "",
  pendingFiles: [],
  pendingZip: null,
});

function matchesFilters(
  source: SourceSummary,
  search: string,
  categoryFilter: string,
  syncFilter: SyncFilter,
  platformFilter: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (q) {
    const hay = `${source.name} ${source.url}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (categoryFilter === UNCategorized_FILTER) {
    if (source.category) return false;
  } else if (categoryFilter !== "all" && source.category !== categoryFilter) {
    return false;
  }
  if (syncFilter === "synced" && !source.last_synced_at) return false;
  if (syncFilter === "unsynced" && source.last_synced_at) return false;
  if (platformFilter !== "all" && source.source_kind !== platformFilter) return false;
  return true;
}

function UpdateStatusBadge({ status }: { status?: SourceSummary["update_status"] }) {
  if (status === "updates_available") {
    return (
      <Badge variant="warning" icon={ArrowDownCircle}>
        Update available
      </Badge>
    );
  }
  if (status === "up_to_date") {
    return (
      <Badge variant="success" icon={CheckCircle2}>
        Up to date
      </Badge>
    );
  }
  return null;
}

export default function SourcesPage() {
  const location = useLocation();
  const { health, error: healthError } = useEngineHealth();
  const { busy, runJob } = useJobRunner("sync");
  const { busy: updateBusy, runJob: runUpdateJob } = useJobRunner("source-updates");
  const persistedUi = useMemo(() => loadPersistedSourcesUi(), []);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<WizardForm>(emptyForm([]));
  const [detailSource, setDetailSource] = useState<SourceSummary | null>(null);
  const [detailTab, setDetailTab] = useState<"docs" | "rules" | "naming">("docs");
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reposImportNote, setReposImportNote] = useState<string | null>(null);
  const [reposImportOpen, setReposImportOpen] = useState(false);
  const [reposImportText, setReposImportText] = useState("");
  const [reposImportBusy, setReposImportBusy] = useState(false);
  const [reposImportSyncAfter, setReposImportSyncAfter] = useState(true);
  const [reposImportSyncNote, setReposImportSyncNote] = useState<string | null>(null);
  const [search, setSearch] = useState(persistedUi.search ?? "");
  const [categoryFilter, setCategoryFilter] = useState(persistedUi.categoryFilter);
  const [syncFilter, setSyncFilter] = useState<SyncFilter>(persistedUi.syncFilter);
  const [platformFilter, setPlatformFilter] = useState(persistedUi.platformFilter);
  const [viewMode, setViewMode] = useState<SourceViewMode>(persistedUi.viewMode);
  const searchSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stlSearchFocus, setStlSearchFocus] = useState(false);
  const [categoriesSheetOpen, setCategoriesSheetOpen] = useState(false);
  const importSharedBuild = useImportSharedBuild();

  useEffect(() => {
    const state = location.state as { stlSearch?: boolean } | null;
    if (state?.stlSearch) {
      setStlSearchFocus(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    savePersistedSourcesUi({
      viewMode,
      categoryFilter,
      syncFilter,
      platformFilter,
      search,
    });
  }, [viewMode, categoryFilter, syncFilter, platformFilter]);

  useEffect(() => {
    if (searchSaveTimer.current) clearTimeout(searchSaveTimer.current);
    searchSaveTimer.current = setTimeout(() => {
      savePersistedSourcesUi({
        viewMode,
        categoryFilter,
        syncFilter,
        platformFilter,
        search,
      });
    }, 300);
    return () => {
      if (searchSaveTimer.current) clearTimeout(searchSaveTimer.current);
    };
  }, [search, viewMode, categoryFilter, syncFilter, platformFilter]);

  const refresh = useCallback(async () => {
    if (!health) return;
    setLoadError(null);
    try {
      const [rows, cats] = await Promise.all([
        fetchSources(),
        fetchSourceCategories(),
      ]);
      setSources(rows);
      setCategories(cats);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesLoaded(true);
    }
  }, [health]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      sources.filter((s) =>
        matchesFilters(s, search, categoryFilter, syncFilter, platformFilter),
      ),
    [sources, search, categoryFilter, syncFilter, platformFilter],
  );

  const hasSyncedSources = sources.some((s) => Boolean(s.local_path));

  // Skeletons until the first fetch resolves; bail out if the engine is offline.
  const sourcesLoading = !sourcesLoaded && !healthError;

  const openDetail = (
    source: SourceSummary,
    tab: "docs" | "rules" = "docs",
    path: string | null = null,
  ) => {
    setDetailSource(source);
    setDetailTab(tab);
    setHighlightPath(path);
  };

  const onStlHit = (hit: StlSearchHit) => {
    const source = sources.find((s) => s.id === hit.source_id);
    if (source) openDetail(source, "rules", hit.relative_path);
  };

  const syncSources = (ids?: number[]) => {
    const label =
      ids?.length === 1
        ? "Source synced"
        : ids && ids.length > 1
          ? `Synced ${ids.length} sources`
          : "All sources synced";
    void runJob(
      () => startSync(ids),
      (snap) => {
        void refresh();
        toastJobResult(snap, label, "Sync failed");
      },
    );
  };

  const checkUpdates = () => {
    void runUpdateJob(
      () => startCheckSourceUpdates(),
      (snap) => {
        void refresh();
        toastJobResult(snap, "Update check finished", "Update check failed");
      },
    );
  };

  const openAddWizard = () => {
    setForm(emptyForm(categories));
    setEditId(null);
    setWizardOpen(true);
  };

  const openEditWizard = (s: SourceSummary) => {
    setForm({
      name: s.name,
      url: s.url,
      branch: s.branch || "main",
      source_kind: (s.source_kind as SourceKind) || "github",
      category: s.category ?? "",
      pendingFiles: [],
      pendingZip: null,
    });
    setEditId(s.id);
    setWizardOpen(true);
  };

  const uploadPendingContent = async (
    sourceId: number,
    kind: SourceKind,
    pendingFiles: File[],
    pendingZip: File | null,
  ) => {
    if (kind === "local") {
      if (pendingFiles.length === 0) {
        throw new Error("Select STL files or a folder to upload.");
      }
      const result = await importSourceFiles(sourceId, pendingFiles);
      toast.success(
        `Uploaded ${result.imported_files ?? pendingFiles.length} file(s)` +
          (result.stl_count != null ? ` (${result.stl_count} STL)` : ""),
      );
      return;
    }

    const needsZip =
      kind === "archive" || kind === "printables" || kind === "makerworld";
    if (!needsZip) return;

    const zip = pendingZip ?? (await pickZipArchive());
    if (!zip) {
      throw new Error(
        kind === "archive"
          ? "A ZIP archive is required for this source."
          : "Upload the model archive you downloaded from the site.",
      );
    }
    const result = await importSourceArchive(sourceId, zip);
    toast.success(
      `Uploaded archive` +
        (result.stl_count != null ? ` (${result.stl_count} STL files)` : ""),
    );
  };

  const saveSource = async () => {
    setLoadError(null);
    try {
      const category = form.category.trim() || null;
      if (editId == null) {
        if (
          (form.source_kind === "printables" || form.source_kind === "makerworld") &&
          !form.url.trim()
        ) {
          throw new Error("Enter the model page URL from Printables or MakerWorld.");
        }
        const created = await createSource({
          name: form.name.trim(),
          url: form.url.trim(),
          branch: form.branch.trim() || "main",
          source_kind: form.source_kind,
          category,
        });
        await uploadPendingContent(
          created.id,
          form.source_kind,
          form.pendingFiles,
          form.pendingZip,
        );
        setWizardOpen(false);
        await refresh();
        if (created.source_kind === "github") syncSources([created.id]);
      } else {
        await updateSource(editId, {
          name: form.name.trim(),
          url: form.url.trim(),
          branch: form.branch.trim(),
          source_kind: form.source_kind,
          category,
        });
        if (form.pendingFiles.length > 0 || form.pendingZip) {
          await uploadPendingContent(
            editId,
            form.source_kind,
            form.pendingFiles,
            form.pendingZip,
          );
        }
        setWizardOpen(false);
        await refresh();
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setLoadError(null);
    try {
      await deleteSource(deleteTarget.id);
      if (detailSource?.id === deleteTarget.id) setDetailSource(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const syncSourceIdsSequential = async (
    entries: Array<{ source_id: number; name: string }>,
  ) => {
    const failures: string[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const { source_id: id, name } = entries[i];
      setReposImportSyncNote(`Syncing ${i + 1}/${entries.length}: ${name}…`);
      try {
        const jobId = await startSync([id]);
        const snap = await waitForJobDone(jobId);
        if (snap.status === "error") {
          failures.push(`${name}: ${snap.message || "sync failed"}`);
        }
      } catch (e) {
        failures.push(
          `${name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (failures.length > 0) {
      setReposImportSyncNote(
        `Sync finished with ${failures.length} failure(s): ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`,
      );
    } else if (entries.length > 0) {
      setReposImportSyncNote(`Synced ${entries.length} new source(s).`);
    }
  };

  const runReposImport = async (text: string) => {
    setReposImportBusy(true);
    setReposImportNote(null);
    setReposImportSyncNote(null);
    try {
      const result = await importReposTxt({ text });
      const skipped =
        result.skipped > 0
          ? ` Skipped ${result.skipped} line(s) without URL${result.skipped_names.length ? `: ${result.skipped_names.join(", ")}` : ""}.`
          : "";
      const importMsg = `Imported ${result.created} new and updated ${result.updated} source(s).${skipped}`;
      setReposImportNote(importMsg);
      toast.success(importMsg.trim());
      const newSources = result.results
        .filter((r) => r.action === "created" && r.source_id != null)
        .map((r) => ({ source_id: r.source_id as number, name: r.name }));
      setReposImportOpen(false);
      setReposImportText("");
      await refresh();
      if (reposImportSyncAfter && newSources.length > 0) {
        await syncSourceIdsSequential(newSources);
        await refresh();
      }
    } catch (e) {
      setReposImportNote(e instanceof Error ? e.message : String(e));
    } finally {
      setReposImportBusy(false);
    }
  };

  const onReposFilePicked = (file: File | null) => {
    if (!file) return;
    void file.text().then((text) => {
      setReposImportText(text);
      setReposImportOpen(true);
    });
  };

  const renderSourceCard = (s: SourceSummary) => (
    <Card key={s.id} className="overflow-hidden shadow-none">
      <SourceCardCover sourceId={s.id} name={s.name} sourceKind={s.source_kind} />
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{s.name}</h3>
            <p className="text-xs text-muted-foreground">{kindLabel(s.source_kind)}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="Source actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openDetail(s, "docs")}>Open</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEditWizard(s)}>Edit</DropdownMenuItem>
              {(s.source_kind === "local" ||
                s.source_kind === "archive" ||
                s.source_kind === "printables" ||
                s.source_kind === "makerworld") && (
                <DropdownMenuItem
                  onClick={() => {
                    void (async () => {
                      try {
                        if (s.source_kind === "local") {
                          const files = await pickLocalFiles();
                          if (!files.length) return;
                          await importSourceFiles(s.id, files);
                        } else {
                          const zip = await pickZipArchive();
                          if (!zip) return;
                          await importSourceArchive(s.id, zip);
                        }
                        await refresh();
                        toast.success("Upload complete");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      }
                    })();
                  }}
                >
                  Upload files…
                </DropdownMenuItem>
              )}
              {s.source_kind === "github" && (
                <DropdownMenuItem onClick={() => syncSources([s.id])} disabled={busy}>
                  Sync
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteTarget(s)}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap gap-1">
          {s.category ? (
            <Badge variant="default">{s.category}</Badge>
          ) : (
            <Badge variant="muted">Uncategorized</Badge>
          )}
          <Badge variant="muted">{formatSyncTime(s.last_synced_at)}</Badge>
          {s.last_commit_sha && (
            <Badge variant="muted">{shortSha(s.last_commit_sha)}</Badge>
          )}
          <UpdateStatusBadge status={s.update_status} />
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => openDetail(s, "docs")}
        >
          Open
        </Button>
      </CardContent>
    </Card>
  );

  const renderSourceRow = (s: SourceSummary) => (
    <div
      key={s.id}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{s.name}</p>
        <p className="text-xs text-muted-foreground">
          {kindLabel(s.source_kind)} · {formatSyncTime(s.last_synced_at)}
        </p>
      </div>
      {s.category ? (
        <Badge variant="default">{s.category}</Badge>
      ) : (
        <Badge variant="muted">Uncategorized</Badge>
      )}
      <UpdateStatusBadge status={s.update_status} />
      <Button size="sm" variant="secondary" onClick={() => openDetail(s, "docs")}>
        Open
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="Source actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEditWizard(s)}>Edit</DropdownMenuItem>
          {(s.source_kind === "local" ||
            s.source_kind === "archive" ||
            s.source_kind === "printables" ||
            s.source_kind === "makerworld") && (
            <DropdownMenuItem
              onClick={() => {
                void (async () => {
                  try {
                    if (s.source_kind === "local") {
                      const files = await pickLocalFiles();
                      if (!files.length) return;
                      await importSourceFiles(s.id, files);
                    } else {
                      const zip = await pickZipArchive();
                      if (!zip) return;
                      await importSourceArchive(s.id, zip);
                    }
                    await refresh();
                    toast.success("Upload complete");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                })();
              }}
            >
              Upload files…
            </DropdownMenuItem>
          )}
          {s.source_kind === "github" && (
            <DropdownMenuItem onClick={() => syncSources([s.id])} disabled={busy}>
              Sync
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDeleteTarget(s)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <RouteBreadcrumbs items={[{ label: "Sources" }]} />
      <PageHeader
        icon={FolderGit2}
        accent
        title="Sources"
        description="Register repos, sync local trees, and choose import folders for each build."
        actions={
          <PageHeaderActions>
            <Button
              className="min-h-10 w-full sm:w-auto"
              onClick={openAddWizard}
              disabled={!health}
            >
              Add source
            </Button>
            <Button
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => void importSharedBuild()}
              disabled={!health}
            >
              Import shared build…
            </Button>
            <Button
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => syncSources()}
              disabled={busy || updateBusy || !health || sources.length === 0}
            >
              {busy ? "Syncing…" : "Sync all"}
            </Button>
            <Button
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={checkUpdates}
              disabled={busy || updateBusy || !health || sources.length === 0}
            >
              {updateBusy ? "Checking…" : "Check updates"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="col-span-2 min-h-10 w-full sm:col-span-1 sm:w-auto"
                  disabled={!health}
                >
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => void refresh()}
                  disabled={busy || updateBusy || !health}
                >
                  Refresh list
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setReposImportOpen(true)}>
                  Import repos.txt…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    document.getElementById("repos-txt-file-input")?.click();
                  }}
                >
                  Choose repos.txt file…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCategoriesSheetOpen(true)}>
                  Manage categories…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </PageHeaderActions>
        }
      />

      <input
        id="repos-txt-file-input"
        type="file"
        accept=".txt,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onReposFilePicked(e.target.files?.[0] ?? null)}
      />

      <GlobalStlSearch
        engineReady={Boolean(health)}
        hasSyncedSources={hasSyncedSources}
        onSelectHit={onStlHit}
        autoFocus={stlSearchFocus}
      />

      <SourcesToolbar
        search={search}
        onSearchChange={setSearch}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        categories={categories}
        syncFilter={syncFilter}
        onSyncFilterChange={setSyncFilter}
        platformFilter={platformFilter}
        onPlatformFilterChange={setPlatformFilter}
        sources={sources}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onManageCategories={() => setCategoriesSheetOpen(true)}
      />

      {(loadError || reposImportNote || reposImportSyncNote) && (
        <div className="mb-4 space-y-1 text-sm">
          {loadError && <p className="text-destructive">{loadError}</p>}
          {reposImportNote && <p className="text-muted-foreground">{reposImportNote}</p>}
          {reposImportSyncNote && <p className="text-muted-foreground">{reposImportSyncNote}</p>}
        </div>
      )}

      <Dialog open={reposImportOpen} onOpenChange={setReposImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import repos.txt</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            One repo per line: <code className="font-mono">name,url,branch</code> or a GitHub URL.
          </p>
          <textarea
            className="min-h-40 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            value={reposImportText}
            onChange={(e) => setReposImportText(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={reposImportSyncAfter}
              onChange={(e) => setReposImportSyncAfter(e.target.checked)}
              disabled={reposImportBusy}
            />
            Sync after import (new GitHub sources only)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReposImportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reposImportBusy || !reposImportText.trim()}
              onClick={() => void runReposImport(reposImportText)}
            >
              {reposImportBusy ? "Importing…" : "Import"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId == null ? "Add source" : "Edit source"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="source-name">Name</Label>
              <Input
                id="source-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Platform</Label>
              <Select
                value={form.source_kind}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, source_kind: v as SourceKind }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      "github",
                      "local",
                      "printables",
                      "makerworld",
                      "self",
                      "archive",
                    ] as SourceKind[]
                  ).map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={form.category || UNCategorized_FILTER}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    category: v === UNCategorized_FILTER ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCategorized_FILTER}>Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.source_kind === "local" ? (
              <div className="space-y-2 md:col-span-2">
                <Label>STL files</Label>
                <p className="text-xs text-muted-foreground">
                  Files upload to the server when you save. Pick a folder or select multiple
                  STL files from your computer.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const files = await pickLocalDirectory();
                      if (files.length > 0) {
                        setForm((f) => ({ ...f, pendingFiles: files, pendingZip: null }));
                      }
                    }}
                  >
                    Browse folder…
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const files = await pickLocalFiles();
                      if (files.length > 0) {
                        setForm((f) => ({
                          ...f,
                          pendingFiles: [...f.pendingFiles, ...files],
                          pendingZip: null,
                        }));
                      }
                    }}
                  >
                    Add STL files…
                  </Button>
                  {form.pendingFiles.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setForm((f) => ({ ...f, pendingFiles: [] }))}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {form.pendingFiles.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {form.pendingFiles.length} file
                    {form.pendingFiles.length === 1 ? "" : "s"} selected
                  </p>
                )}
              </div>
            ) : form.source_kind === "archive" ? (
              <div className="space-y-2 md:col-span-2">
                <Label>ZIP archive</Label>
                <p className="text-xs text-muted-foreground">
                  Upload a ZIP containing STL files when you save.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const zip = await pickZipArchive();
                      if (zip) setForm((f) => ({ ...f, pendingZip: zip, pendingFiles: [] }));
                    }}
                  >
                    {form.pendingZip ? "Change ZIP…" : "Choose ZIP…"}
                  </Button>
                  {form.pendingZip && (
                    <span className="truncate text-xs text-muted-foreground">
                      {form.pendingZip.name}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="source-url">URL</Label>
                  <Input
                    id="source-url"
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder={
                      form.source_kind === "printables"
                        ? "https://www.printables.com/model/…"
                        : form.source_kind === "makerworld"
                          ? "https://makerworld.com/en/models/…"
                          : "https://github.com/org/repo.git"
                    }
                  />
                </div>
                {(form.source_kind === "printables" ||
                  form.source_kind === "makerworld") && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Model archive (ZIP)</Label>
                    <p className="text-xs text-muted-foreground">
                      Download the model archive from the site, then attach it here. The web app
                      uploads the ZIP to your server — it does not fetch from Printables directly.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          const zip = await pickZipArchive();
                          if (zip) setForm((f) => ({ ...f, pendingZip: zip, pendingFiles: [] }));
                        }}
                      >
                        {form.pendingZip ? "Change ZIP…" : "Choose ZIP…"}
                      </Button>
                      {form.pendingZip && (
                        <span className="truncate text-xs text-muted-foreground">
                          {form.pendingZip.name}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {form.source_kind === "github" && (
                  <GitHubBranchField
                    url={form.url}
                    branch={form.branch}
                    onBranchChange={(branch) => setForm((f) => ({ ...f, branch }))}
                  />
                )}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            {loadError && wizardOpen && (
              <p className="mr-auto text-sm text-destructive self-center">{loadError}</p>
            )}
            <Button variant="ghost" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveSource()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {sourcesLoading ? (
        viewMode === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
                <Skeleton className="aspect-[2/1] w-full rounded-none" />
                <div className="space-y-3 p-4">
                  <Skeleton className="h-5 w-2/3" />
                  <div className="flex gap-1">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        )
      ) : sources.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No sources yet"
          description="Add a GitHub repo, local folder, or Printables/MakerWorld URL to get started."
          action={{ label: "Add source", onClick: openAddWizard }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No sources match"
          description="Try clearing filters or search terms."
          action={{ label: "Clear filters", onClick: () => {
            setSearch("");
            setCategoryFilter("all");
            setSyncFilter("all");
            setPlatformFilter("all");
          }}}
        />
      ) : viewMode === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(renderSourceCard)}
        </div>
      ) : (
        <div className="space-y-2">{filtered.map(renderSourceRow)}</div>
      )}

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove source?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget
              ? `“${deleteTarget.name}” will be removed from Print Partner. Synced files on disk are not deleted.`
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "Removing…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SourceCategorySheet
        open={categoriesSheetOpen}
        onOpenChange={setCategoriesSheetOpen}
        engineReady={Boolean(health)}
        onCategoriesChanged={(cats) => {
          setCategories(cats);
        }}
      />

      <SourceDetailSheet
        source={detailSource}
        open={detailSource != null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSource(null);
            setHighlightPath(null);
          }
        }}
        initialTab={detailTab}
        highlightPath={highlightPath}
        busy={busy}
        onEdit={openEditWizard}
        onDelete={setDeleteTarget}
        onSaveRules={() => {}}
        runImportScan={(sourceId) => {
          void runJob(
            () => startImportScan(sourceId),
            () => {},
          );
        }}
      />
    </>
  );
}
