import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, FolderGit2, MoreHorizontal, Search } from "lucide-react";
import {
  createSource,
  deleteSource,
  fetchSourceCategories,
  fetchSources,
  saveSourceCategories,
  bulkAssignSourceCategory,
  importReposTxt,
  importSourceArchive,
  importSourceFiles,
  pickLocalDirectory,
  pickLocalFiles,
  pickZipArchive,
  startCheckSourceUpdates,
  startImportScan,
  startSync,
  updateSource,
  waitForJobDone,
  type SourceSummary,
  type StlSearchHit,
} from "../api/engine";
import GitHubRefField, { type GithubRefType } from "../components/GitHubRefField";
import { useDateFormat } from "../context/DateFormatContext";
import { useJobContext } from "../context/JobContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useProfileSelection } from "../context/ProfileContext";
import {
  mapCopilotSourceTab,
  useCopilotUiOptional,
  type CopilotSourceTab,
} from "../context/CopilotUiContext";
import EmptyState from "../components/layout/EmptyState";
import DeskNextStep from "../components/layout/DeskNextStep";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import GlobalStlSearch from "../components/sources/GlobalStlSearch";
import LibraryCategoryRail, {
  type LibraryAddKind,
} from "../components/sources/LibraryCategoryRail";
import LibrarySourceCard from "../components/sources/LibrarySourceCard";
import BulkCategoryBar from "../components/sources/BulkCategoryBar";
import LibraryStaleBanner from "../components/sources/LibraryStaleBanner";
import SourceDetailSheet from "../components/sources/SourceDetailSheet";
import SourceCategoryAssignSubmenu from "../components/sources/SourceCategoryAssignSubmenu";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "../components/ui/input-group";
import { Field, FieldLabel } from "../components/ui/field";
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
import { deskNextStepLine } from "../lib/deskNextStep";
import {
  attachedSourceIds,
  buildLibraryCardMeta,
  pickCountsBySourceId,
} from "../lib/librarySourceMeta";
import {
  countSourcesByCategory,
  matchesSourceCategoryFilter,
  sourceCategoryLabel,
} from "../lib/sourceCategoryAssignment";
import { librarySourceDragId } from "../lib/sourceCategoryDnD";
import {
  applySelectionClick,
  isAllVisibleSelected,
  pruneSelectionToKnownIds,
  selectAllVisible,
  type SelectionModifiers,
} from "../lib/sourceSelection";
import {
  loadPersistedSourcesUi,
  savePersistedSourcesUi,
} from "../lib/persistedSourcesUi";
import { toastJobResult } from "../lib/jobToasts";
import { cn } from "../lib/utils";

type PendingOpenSource = {
  sourceName?: string;
  sourceId?: number;
  tab: CopilotSourceTab;
  path?: string | null;
  query?: string;
};

type WizardForm = {
  name: string;
  url: string;
  refType: GithubRefType;
  branch: string;
  tag: string;
  source_kind: SourceKind;
  category: string;
  pendingFiles: File[];
  pendingZip: File | null;
};

const emptyForm = (categories: string[]): WizardForm => ({
  name: "",
  url: "",
  refType: "branch",
  branch: "main",
  tag: "",
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
  if (!matchesSourceCategoryFilter(source.category, categoryFilter)) {
    return false;
  }
  if (syncFilter === "synced" && !source.last_synced_at) return false;
  if (syncFilter === "unsynced" && source.last_synced_at) return false;
  if (platformFilter !== "all" && source.source_kind !== platformFilter) return false;
  return true;
}

export default function SourcesPage() {
  const location = useLocation();
  const copilot = useCopilotUiOptional();
  const { formatDate } = useDateFormat();
  const { health, error: healthError } = useEngineHealth();
  const { busy, runJob } = useJobRunner("sync");
  const { busy: updateBusy, runJob: runUpdateJob } = useJobRunner("source-updates");
  const { activeJobs } = useJobContext();
  const { review } = usePlanWorkspace();
  const { profiles, selectedProfileId } = useProfileSelection();
  const persistedUi = useMemo(() => loadPersistedSourcesUi(), []);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<WizardForm>(emptyForm([]));
  const [detailSource, setDetailSource] = useState<SourceSummary | null>(null);
  const [detailTab, setDetailTab] = useState<CopilotSourceTab>("docs");
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const [docsQuery, setDocsQuery] = useState<string | undefined>(undefined);
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
  const [stlInitialQuery, setStlInitialQuery] = useState("");
  const [stlSearchExpanded, setStlSearchExpanded] = useState(false);
  const [categoriesSheetOpen, setCategoriesSheetOpen] = useState(false);
  const [syncingSourceIds, setSyncingSourceIds] = useState<number[] | "all" | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(new Set());
  const selectionAnchorRef = useRef<number | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const importSharedBuild = useImportSharedBuild();
  const pendingOpenRef = useRef<PendingOpenSource | null>(null);
  const appliedIntentSeqRef = useRef(0);
  const openMissToastAtRef = useRef(0);
  const [pendingOpenTick, setPendingOpenTick] = useState(0);

  const queueOpenSource = useCallback((pending: PendingOpenSource) => {
    pendingOpenRef.current = pending;
    setPendingOpenTick((n) => n + 1);
  }, []);

  // Bootstrap from navigate state (one-shot).
  useEffect(() => {
    const state = location.state as {
      stlSearch?: boolean;
      stlQuery?: string;
      openSource?: {
        sourceName?: string;
        sourceId?: number;
        tab?: string;
        path?: string | null;
        query?: string;
      };
    } | null;
    if (state?.stlSearch) {
      setStlSearchFocus(true);
      setStlSearchExpanded(true);
      if (state.stlQuery) setStlInitialQuery(state.stlQuery);
      window.history.replaceState({}, document.title);
    }
    if (state?.openSource) {
      queueOpenSource({
        sourceName: state.openSource.sourceName,
        sourceId: state.openSource.sourceId,
        tab: mapCopilotSourceTab(state.openSource.tab),
        path: state.openSource.path,
        query: state.openSource.query,
      });
      // Clear route state only after we queue — apply when sources are ready.
      window.history.replaceState({}, document.title);
    }
  }, [location.state, queueOpenSource]);

  // Same-route re-opens via intentSeq (survives late-loaded sources).
  useEffect(() => {
    if (!copilot || copilot.intentSeq === 0) return;
    if (copilot.intentSeq === appliedIntentSeqRef.current) return;
    const intent = copilot.lastIntent;
    if (!intent) return;
    if (intent.kind === "open_source") {
      appliedIntentSeqRef.current = copilot.intentSeq;
      queueOpenSource({
        sourceName: intent.sourceName,
        sourceId: intent.sourceId,
        tab: mapCopilotSourceTab(intent.tab),
        path: intent.path,
        query: intent.query,
      });
    } else if (intent.kind === "focus_stl_search") {
      appliedIntentSeqRef.current = copilot.intentSeq;
      setStlSearchFocus(true);
      setStlSearchExpanded(true);
      if (intent.query) setStlInitialQuery(intent.query);
    }
  }, [copilot, copilot?.intentSeq, queueOpenSource]);

  // Apply pending open once the source list can resolve the target.
  useEffect(() => {
    const pending = pendingOpenRef.current;
    if (!pending || sources.length === 0) return;
    const source =
      (pending.sourceId != null
        ? sources.find((s) => s.id === pending.sourceId)
        : undefined) ??
      (pending.sourceName
        ? sources.find(
            (s) =>
              s.name === pending.sourceName ||
              s.name.toLowerCase() === pending.sourceName!.toLowerCase(),
          )
        : undefined);
    if (!source) {
      const now = Date.now();
      if (now - openMissToastAtRef.current > 4000) {
        openMissToastAtRef.current = now;
        toast.message(
          pending.sourceName
            ? `Source “${pending.sourceName}” not found yet`
            : "Source not found yet",
        );
      }
      return;
    }
    pendingOpenRef.current = null;
    setDetailSource(source);
    setDetailTab(pending.tab);
    setHighlightPath(pending.path ?? null);
    setDocsQuery(pending.query);
  }, [sources, pendingOpenTick]);

  // Hard timeout if the source name never resolves (clear leftover pending).
  useEffect(() => {
    if (pendingOpenTick === 0) return;
    if (!pendingOpenRef.current) return;
    const timer = window.setTimeout(() => {
      const leftover = pendingOpenRef.current;
      if (!leftover) return;
      pendingOpenRef.current = null;
      toast.message(
        leftover.sourceName
          ? `Source “${leftover.sourceName}” not found — check the name or add/sync it on Sources.`
          : "Source not found — check the name or add/sync it on Sources.",
      );
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [pendingOpenTick]);

  useEffect(() => {
    savePersistedSourcesUi({
      viewMode,
      categoryFilter,
      syncFilter,
      platformFilter,
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

  const onCategoriesReorder = useCallback(async (next: string[]) => {
    const previous = categories;
    setCategories(next);
    try {
      const saved = await saveSourceCategories(next);
      setCategories(saved);
    } catch (e) {
      setCategories(previous);
      toast.error(e instanceof Error ? e.message : "Could not reorder categories");
    }
  }, [categories]);

  const filtered = useMemo(
    () =>
      sources.filter((s) =>
        matchesFilters(s, search, categoryFilter, syncFilter, platformFilter),
      ),
    [sources, search, categoryFilter, syncFilter, platformFilter],
  );

  const visibleIds = useMemo(() => filtered.map((s) => s.id), [filtered]);

  // Drop selected ids that fall out of view (filtered away, deleted, etc.)
  // so the bulk bar never quietly acts on hidden sources.
  useEffect(() => {
    setSelectedSourceIds((prev) => {
      const pruned = pruneSelectionToKnownIds(prev, visibleIds);
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [visibleIds]);

  const onSourceSelectClick = useCallback(
    (sourceId: number, modifiers: SelectionModifiers) => {
      setSelectedSourceIds((prev) => {
        const { selection, anchorId } = applySelectionClick({
          selected: prev,
          anchorId: selectionAnchorRef.current,
          clickedId: sourceId,
          visibleIds,
          modifiers,
        });
        selectionAnchorRef.current = anchorId;
        return selection;
      });
    },
    [visibleIds],
  );

  const clearSelection = useCallback(() => {
    setSelectedSourceIds(new Set());
    selectionAnchorRef.current = null;
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedSourceIds(selectAllVisible(visibleIds));
  }, [visibleIds]);

  const bulkAssignCategory = async (category: string | null) => {
    const ids = Array.from(selectedSourceIds);
    if (ids.length === 0) return;
    setBulkAssigning(true);
    try {
      const result = await bulkAssignSourceCategory(ids, category);
      const updatedById = new Map(result.updated.map((s) => [s.id, s]));
      setSources((prev) => prev.map((s) => updatedById.get(s.id) ?? s));
      const label = category?.trim() ? category.trim() : "Uncategorised";
      if (result.failed > 0) {
        toast.error(
          `Moved ${result.succeeded}/${ids.length} source(s) to ${label}; ${result.failed} failed`,
        );
      } else {
        toast.success(`Moved ${result.succeeded} source(s) to ${label}`);
      }
      clearSelection();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkAssigning(false);
    }
  };

  const hasSyncedSources = sources.some((s) => Boolean(s.local_path));

  // Skeletons until the first fetch resolves; bail out if the engine is offline.
  const sourcesLoading = !sourcesLoaded && !healthError;

  const selectedPlan = profiles.find((p) => p.id === selectedProfileId) ?? null;
  const attachedIds = useMemo(() => attachedSourceIds(review), [review]);
  const pickCounts = useMemo(() => pickCountsBySourceId(review), [review]);
  const attachedCount = attachedIds.size;

  const sourcesByCategory = useMemo(
    () => countSourcesByCategory(sources),
    [sources],
  );

  const staleSources = useMemo(
    () => sources.filter((s) => s.update_status === "updates_available"),
    [sources],
  );
  const attachedStaleCount = useMemo(
    () => staleSources.filter((s) => attachedIds.has(s.id)).length,
    [staleSources, attachedIds],
  );

  const syncJob = activeJobs.find(
    (j) => j.kind === "sync" && (j.status === "running" || j.status === "pending"),
  );
  const syncProgress = syncJob?.progress ?? null;

  useEffect(() => {
    if (!busy) setSyncingSourceIds(null);
  }, [busy]);

  const headerSubtitle = useMemo(() => {
    const srcLabel = `${sources.length} source${sources.length === 1 ? "" : "s"}`;
    if (!selectedPlan || attachedCount === 0) return srcLabel;
    return `${srcLabel} · ${attachedCount} attached to ${selectedPlan.name}`;
  }, [sources.length, selectedPlan, attachedCount]);

  const libraryNextStep = deskNextStepLine("library", {
    sourceCount: sources.length,
  });

  const openDetail = (
    source: SourceSummary,
    tab: CopilotSourceTab = "docs",
    path: string | null = null,
  ) => {
    setDetailSource(source);
    setDetailTab(tab);
    setHighlightPath(path);
    setDocsQuery(undefined);
  };

  const onStlHit = (hit: StlSearchHit) => {
    const source = sources.find((s) => s.id === hit.source_id);
    if (source) openDetail(source, "rules", hit.relative_path);
  };

  const syncSources = (ids?: number[]) => {
    setSyncingSourceIds(ids && ids.length > 0 ? ids : "all");
    const label =
      ids?.length === 1
        ? "Source synced"
        : ids && ids.length > 1
          ? `Synced ${ids.length} sources`
          : "All sources synced";
    void runJob(
      () => startSync(ids),
      (snap) => {
        setSyncingSourceIds(null);
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

  const openAddWizard = (kind?: SourceKind) => {
    const next = emptyForm(categories);
    if (kind) next.source_kind = kind;
    setForm(next);
    setEditId(null);
    setWizardOpen(true);
  };

  const onLibraryAdd = (kind: LibraryAddKind) => {
    if (kind === "plan_bundle") {
      void importSharedBuild();
      return;
    }
    if (kind === "repos_txt") {
      setReposImportOpen(true);
      return;
    }
    openAddWizard(kind);
  };

  const onSeeStaleChanges = () => {
    const first = staleSources[0];
    if (first) {
      openDetail(first, "docs");
      return;
    }
    checkUpdates();
  };

  const openEditWizard = (s: SourceSummary) => {
    setForm({
      name: s.name,
      url: s.url,
      refType: s.tag ? "tag" : "branch",
      branch: s.branch || "main",
      tag: s.tag ?? "",
      source_kind: (s.source_kind as SourceKind) || "github",
      category: s.category ?? "",
      pendingFiles: [],
      pendingZip: null,
    });
    setEditId(s.id);
    setWizardOpen(true);
  };

  const assignSourceCategory = async (
    source: SourceSummary,
    category: string | null,
  ) => {
    const previous = source.category ?? null;
    const next = category?.trim() || null;
    if (previous === next) return;
    try {
      const updated = await updateSource(source.id, { category: next });
      setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setDetailSource((cur) => (cur?.id === updated.id ? updated : cur));
      toast.success(
        next
          ? `Moved “${updated.name}” to ${next}`
          : `Moved “${updated.name}” to Uncategorised`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
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
      if (form.source_kind === "github" && form.refType === "tag" && !form.tag.trim()) {
        throw new Error("Enter a tag or switch back to Branch.");
      }
      const refFields =
        form.source_kind === "github" && form.refType === "tag"
          ? { branch: form.branch.trim() || "main", tag: form.tag.trim() }
          : { branch: form.branch.trim() || "main", tag: null };
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
          ...refFields,
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
          ...refFields,
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

  const isSourceSyncing = (sourceId: number) => {
    if (!busy || syncingSourceIds == null) return false;
    if (syncingSourceIds === "all") return true;
    return syncingSourceIds.includes(sourceId);
  };

  const canUpload = (s: SourceSummary) =>
    s.source_kind === "local" ||
    s.source_kind === "archive" ||
    s.source_kind === "printables" ||
    s.source_kind === "makerworld";

  const runUpload = (s: SourceSummary) => {
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
  };

  const renderSourceCard = (s: SourceSummary) => {
    const syncing = isSourceSyncing(s.id);
    const meta = buildLibraryCardMeta({
      source: s,
      attached: attachedIds.has(s.id),
      pickCount: attachedIds.has(s.id) ? (pickCounts.get(s.id) ?? 0) : null,
      syncing,
      syncProgress: syncing ? syncProgress : null,
      formatDate,
    });
    return (
      <LibrarySourceCard
        key={s.id}
        source={s}
        meta={meta}
        categories={categories}
        busy={busy}
        onOpen={() => openDetail(s, "docs")}
        onEdit={() => openEditWizard(s)}
        onSync={s.source_kind === "github" ? () => syncSources([s.id]) : undefined}
        onUpload={canUpload(s) ? () => runUpload(s) : undefined}
        onDelete={() => setDeleteTarget(s)}
        onAssignCategory={(category) => void assignSourceCategory(s, category)}
        selected={selectedSourceIds.has(s.id)}
        onSelectClick={(mods) => onSourceSelectClick(s.id, mods)}
      />
    );
  };

  const renderSourceRow = (s: SourceSummary) => {
    const syncing = isSourceSyncing(s.id);
    const isSelected = selectedSourceIds.has(s.id);
    const meta = buildLibraryCardMeta({
      source: s,
      attached: attachedIds.has(s.id),
      pickCount: attachedIds.has(s.id) ? (pickCounts.get(s.id) ?? 0) : null,
      syncing,
      syncProgress: syncing ? syncProgress : null,
      formatDate,
    });
    return (
      <div
        key={s.id}
        draggable={!busy}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", librarySourceDragId(s.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        className={cn(
          "flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center",
          meta.borderTone === "update" && "border-amber-500/50",
          meta.borderTone === "syncing" && "border-sky-400/70",
          isSelected && "ring-2 ring-primary border-primary/60",
          !busy && "cursor-grab active:cursor-grabbing",
        )}
        title="Drag onto a category"
      >
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-primary"
          checked={isSelected}
          aria-label={`Select ${s.name}`}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation();
            onSourceSelectClick(s.id, {
              shiftKey: e.shiftKey,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
            });
          }}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={(e) => {
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              onSourceSelectClick(s.id, {
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
              });
              return;
            }
            openDetail(s, "docs");
          }}
        >
          <p className="font-medium">{s.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{meta.slug}</p>
          <p className="truncate text-xs text-muted-foreground">
            {sourceCategoryLabel(s.category)}
          </p>
        </button>
        <span className="text-xs text-muted-foreground">{meta.stateLabel}</span>
        <span className="font-mono text-xs font-medium tabular-nums">{meta.pickLabel}</span>
        <Badge variant="muted">{kindLabel(s.source_kind)}</Badge>
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
            <SourceCategoryAssignSubmenu
              categories={categories}
              current={s.category}
              onAssign={(category) => void assignSourceCategory(s, category)}
              disabled={busy}
            />
            {canUpload(s) && (
              <DropdownMenuItem onClick={() => runUpload(s)}>Upload files…</DropdownMenuItem>
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
  };

  return (
    <div className={detailSource != null ? "lg:pl-[min(42rem,100%)]" : undefined}>
      <RouteBreadcrumbs items={[{ label: "Library" }]} />

      <div className="-mx-1 overflow-hidden rounded-xl border border-border bg-background sm:-mx-0 lg:grid lg:min-h-[min(70vh,720px)] lg:grid-cols-[178px_minmax(0,1fr)]">
        <LibraryCategoryRail
          className="hidden lg:flex"
          categories={categories}
          sourcesByCategory={sourcesByCategory}
          totalCount={sources.length}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          onManageCategories={() => setCategoriesSheetOpen(true)}
          onCategoriesReorder={(next) => void onCategoriesReorder(next)}
          onDropSourceCategory={(sourceId, category) => {
            const source = sources.find((s) => s.id === sourceId);
            if (source) void assignSourceCategory(source, category);
          }}
          onAddSource={onLibraryAdd}
        />

        <div className="flex min-w-0 flex-col">
          <header className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3.5 sm:px-5">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">Library</h1>
              <p className="text-[12.5px] text-muted-foreground">{headerSubtitle}</p>
              <DeskNextStep className="mt-1">{libraryNextStep}</DeskNextStep>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-accent/60 sm:max-w-[230px] sm:flex-none"
                onClick={() => {
                  setStlSearchExpanded(true);
                  setStlSearchFocus(true);
                }}
              >
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">Search STLs everywhere</span>
                <kbd className="ml-auto hidden font-mono text-[10px] text-muted-foreground sm:inline">
                  ⌘K
                </kbd>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="min-h-9" disabled={!health}>
                    Add source
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-80" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openAddWizard("github")}>
                    GitHub repo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openAddWizard("local")}>
                    Local folder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openAddWizard("archive")}>
                    Zip upload
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openAddWizard("printables")}>
                    Printables
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openAddWizard("makerworld")}>
                    MakerWorld
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openAddWizard("self")}>
                    Another instance / URL
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void importSharedBuild()}>
                    Plan bundle…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="min-h-9" disabled={!health}>
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => syncSources()}
                    disabled={busy || updateBusy || sources.length === 0}
                  >
                    {busy ? "Syncing…" : "Sync all"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={checkUpdates}
                    disabled={busy || updateBusy || sources.length === 0}
                  >
                    {updateBusy ? "Checking…" : "Check updates"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void refresh()}
                    disabled={busy || updateBusy}
                  >
                    Refresh list
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
                  <DropdownMenuItem onClick={() => setCategoriesSheetOpen(true)}>
                    Manage categories…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-3 overflow-auto p-3.5 sm:px-5 sm:py-3.5">
            {(stlSearchExpanded || stlSearchFocus || stlInitialQuery) && (
              <GlobalStlSearch
                engineReady={Boolean(health)}
                hasSyncedSources={hasSyncedSources}
                onSelectHit={onStlHit}
                autoFocus={stlSearchFocus}
                initialQuery={stlInitialQuery}
              />
            )}

            {/* Mobile category chips when side rail is hidden */}
            <div className="flex gap-1.5 overflow-x-auto lg:hidden [-webkit-overflow-scrolling:touch]">
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                variant={categoryFilter === "all" ? "secondary" : "ghost"}
                onClick={() => setCategoryFilter("all")}
              >
                All ({sources.length})
              </Button>
              {categories.map((c) => (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  className="shrink-0"
                  variant={categoryFilter === c ? "secondary" : "ghost"}
                  onClick={() => setCategoryFilter(c)}
                >
                  {c}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                variant={categoryFilter === UNCategorized_FILTER ? "secondary" : "ghost"}
                onClick={() => setCategoryFilter(UNCategorized_FILTER)}
              >
                Uncategorised
              </Button>
            </div>

            <LibraryStaleBanner
              staleCount={staleSources.length}
              attachedStaleCount={attachedStaleCount}
              onSeeChanges={onSeeStaleChanges}
            />

            <BulkCategoryBar
              count={selectedSourceIds.size}
              categories={categories}
              busy={bulkAssigning}
              onAssign={(category) => void bulkAssignCategory(category)}
              onSelectAll={selectAllFiltered}
              allSelected={isAllVisibleSelected(selectedSourceIds, visibleIds)}
              onClear={clearSelection}
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
              hideCategoryPills
            />

            {(loadError || reposImportNote || reposImportSyncNote) && (
              <div className="space-y-1 text-sm">
                {loadError && <p className="text-destructive">{loadError}</p>}
                {reposImportNote && <p className="text-muted-foreground">{reposImportNote}</p>}
                {reposImportSyncNote && (
                  <p className="text-muted-foreground">{reposImportSyncNote}</p>
                )}
              </div>
            )}

            {sourcesLoading ? (
              viewMode === "grid" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div
                      key={i}
                      className="overflow-hidden rounded-lg border border-border bg-card"
                    >
                      <Skeleton className="h-16 w-full rounded-none" />
                      <div className="space-y-2 p-3">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-1 w-full" />
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
                description="Add a source to start the desk loop."
                action={{ label: "Add source", onClick: () => openAddWizard() }}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={FolderGit2}
                title="No sources match"
                description="Try clearing filters or search terms."
                action={{
                  label: "Clear filters",
                  onClick: () => {
                    setSearch("");
                    setCategoryFilter("all");
                    setSyncFilter("all");
                    setPlatformFilter("all");
                  },
                }}
              />
            ) : viewMode === "grid" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map(renderSourceCard)}
              </div>
            ) : (
              <div className="space-y-2">{filtered.map(renderSourceRow)}</div>
            )}
          </div>
        </div>
      </div>

      <input
        id="repos-txt-file-input"
        type="file"
        accept=".txt,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onReposFilePicked(e.target.files?.[0] ?? null)}
      />

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
                  <SelectValue placeholder={sourceCategoryLabel(null)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCategorized_FILTER}>
                    {sourceCategoryLabel(null)}
                  </SelectItem>
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
                  <Field>
                    <FieldLabel htmlFor="source-url">URL</FieldLabel>
                    <InputGroup className="mt-1">
                      <InputGroupAddon align="inline-start">
                        <InputGroupText>
                          {(form.url.match(/^(https?):\/\//i)?.[1]?.toLowerCase() ===
                          "http"
                            ? "http"
                            : "https") + "://"}
                        </InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        id="source-url"
                        value={form.url.replace(/^https?:\/\//i, "")}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            setForm((f) => ({ ...f, url: "" }));
                            return;
                          }
                          if (/^https?:\/\//i.test(raw)) {
                            setForm((f) => ({ ...f, url: raw }));
                            return;
                          }
                          const existing = form.url.match(/^(https?):\/\//i)?.[1];
                          const scheme =
                            existing?.toLowerCase() === "http" ? "http" : "https";
                          setForm((f) => ({ ...f, url: `${scheme}://${raw}` }));
                        }}
                        placeholder={
                          form.source_kind === "printables"
                            ? "www.printables.com/model/…"
                            : form.source_kind === "makerworld"
                              ? "makerworld.com/en/models/…"
                              : "github.com/org/repo.git"
                        }
                      />
                    </InputGroup>
                  </Field>
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
                  <GitHubRefField
                    url={form.url}
                    refType={form.refType}
                    branch={form.branch}
                    tag={form.tag}
                    onRefTypeChange={(refType) => setForm((f) => ({ ...f, refType }))}
                    onBranchChange={(branch) => setForm((f) => ({ ...f, branch }))}
                    onTagChange={(tag) => setForm((f) => ({ ...f, tag }))}
                  />
                )}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            {loadError && wizardOpen && (
              <p className="mr-auto self-center text-sm text-destructive">{loadError}</p>
            )}
            <Button variant="ghost" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveSource()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

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
            setDocsQuery(undefined);
          }
        }}
        initialTab={detailTab}
        highlightPath={highlightPath}
        docsQuery={docsQuery}
        busy={busy}
        categories={categories}
        onEdit={openEditWizard}
        onDelete={setDeleteTarget}
        onAssignCategory={(source, category) =>
          void assignSourceCategory(source, category)
        }
        onSaveRules={() => {}}
        runImportScan={(sourceId) => {
          void runJob(
            () => startImportScan(sourceId),
            () => {},
          );
        }}
      />
    </div>
  );
}
