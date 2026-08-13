import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Hammer, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import StaleBuildBanner from "../components/StaleBuildBanner";
import MergeConflictBanner from "../components/MergeConflictBanner";
import BuildSourcesPanel from "../components/build/BuildSourcesPanel";
import BuildRecipePanel from "../components/build/BuildRecipePanel";
import PlanRolesCard from "../components/build/PlanRolesCard";
import PlanWarningsCard from "../components/build/PlanWarningsCard";
import EmptyState from "../components/layout/EmptyState";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import KitManifestOptions from "../components/KitManifestOptions";
import SourceCategorySheet from "../components/sources/SourceCategorySheet";
import SourceFilePickerCard from "../components/SourceFilePickerCard";
import ShareImportSetupPanel, {
  type UnmatchedSource,
} from "../components/share/ShareImportSetupPanel";
import type { KitImportJobResult } from "../api/engine";
import { Badge } from "../components/ui/badge";
import { Combobox } from "../components/ui/combobox";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  addProfileAddonLayer,
  deleteProfileLayer,
  fetchAutoRecomputeSettings,
  fetchPlanLayers,
  fetchSources,
  fetchStlNaming,
  replaceProfileLayer,
  setProfileBaseLayer,
  startRecompute,
  type ProfileLayer,
  type RoleFilamentRow,
  type SourceSummary,
  DEFAULT_STL_NAMING_PROFILE,
  type StlNamingProfile,
} from "../api/engine";
import { buildRoute, exportRoute, libraryRoute } from "../lib/routes";
import { groupMergeConflictsByFilename } from "../lib/mergeConflictGroups";
import { takeKitImportResult } from "../lib/kitImportStash";
import { buildPlanWarningLines, planHeaderSubtitle } from "../lib/planWarnings";
import { useProfileSelection } from "../context/ProfileContext";
import { usePlanActions } from "../context/PlanActionsContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import { useCopilotUiOptional } from "../context/CopilotUiContext";
import { useAutoRecompute } from "../hooks/useAutoRecompute";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import { layersEqual } from "../lib/planDataStable";
import { meshColorForStlPath } from "../lib/rolePreviewColor";

type BuildLocationState = {
  kitImport?: KitImportJobResult;
  focusKit?: {
    groupId?: string;
    stlFilter?: string;
    sourceName?: string;
    sourceId?: number;
  };
};

type KitFocusState = {
  groupId?: string;
  stlFilter?: string;
  sourceName?: string;
  sourceId?: number;
  seq: number;
};

export default function BuildPage() {
  return <BuildPageContent />;
}

function BuildPageContent() {
  const location = useLocation();
  const { health } = useEngineHealth();
  const { selectedProfileId, reloadProfiles, profiles } = useProfileSelection();
  const { openCreatePlan, openRenamePlan, openDuplicatePlan, openDeletePlan } =
    usePlanActions();
  const { invalidate: bumpPlanRevision, review, invalidate: reloadReview } = usePlanWorkspace();
  const { busy, runJob } = useJobRunner("recompute");
  const copilot = useCopilotUiOptional();
  const pendingConflictCheckRef = useRef(false);
  const appliedIntentSeqRef = useRef(0);
  const previousSelectedProfileIdRef = useRef<number | null | undefined>(undefined);

  const [layers, setLayers] = useState<ProfileLayer[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addonSourceId, setAddonSourceId] = useState("");
  const [pendingBaseSourceId, setPendingBaseSourceId] = useState("");
  const [kitImportSetup, setKitImportSetup] = useState<KitImportJobResult | null>(null);
  const [categoriesSheetOpen, setCategoriesSheetOpen] = useState(false);
  const [filamentRefreshKey, setFilamentRefreshKey] = useState(0);
  const [autoRecomputeEnabled, setAutoRecomputeEnabled] = useState(true);
  const [roleFilaments, setRoleFilaments] = useState<RoleFilamentRow[]>([]);
  const [namingProfile, setNamingProfile] = useState<StlNamingProfile>(DEFAULT_STL_NAMING_PROFILE);
  const [kitFocus, setKitFocus] = useState<KitFocusState | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const buildStale = selectedProfile?.build_stale ?? false;

  const mergeConflicts = useMemo(
    () => review?.issues.filter((i) => i.code === "merge_conflict") ?? [],
    [review],
  );
  const mergeConflictGroups = useMemo(
    () => groupMergeConflictsByFilename(mergeConflicts),
    [mergeConflicts],
  );

  useEffect(() => {
    if (!pendingConflictCheckRef.current || !review) return;
    pendingConflictCheckRef.current = false;
    if (mergeConflicts.length > 0) {
      toast.warning(
        `Build updated with ${mergeConflicts.length} duplicate part conflict${
          mergeConflicts.length === 1 ? "" : "s"
        } — resolve on Review.`,
      );
    }
  }, [review, mergeConflicts.length]);

  useEffect(() => {
    if (!health?.ok) return;
    void fetchAutoRecomputeSettings()
      .then((s) => setAutoRecomputeEnabled(s.enabled))
      .catch(() => {});
    void fetchStlNaming()
      .then(setNamingProfile)
      .catch(() => {});
  }, [health?.ok]);

  const resolvePreviewMeshColor = useCallback(
    (relativePath: string) => meshColorForStlPath(relativePath, namingProfile, roleFilaments),
    [namingProfile, roleFilaments],
  );

  const onRoleFilamentsUpdated = useCallback(async () => {
    await bumpPlanRevision();
    setFilamentRefreshKey((k) => k + 1);
  }, [bumpPlanRevision]);

  useEffect(() => {
    const state = location.state as BuildLocationState | null;
    if (state?.kitImport) {
      setKitImportSetup(state.kitImport);
      window.history.replaceState({}, document.title);
      return;
    }
    if (state?.focusKit) {
      setKitFocus({
        groupId: state.focusKit.groupId,
        stlFilter: state.focusKit.stlFilter,
        sourceName: state.focusKit.sourceName,
        sourceId: state.focusKit.sourceId,
        seq: Date.now(),
      });
      window.history.replaceState({}, document.title);
      return;
    }
    // Fall back to the sessionStorage stash in case location.state was dropped
    // by an intervening navigation (e.g. ?profile= URL sync).
    if (selectedProfileId != null) {
      const stashed = takeKitImportResult(selectedProfileId);
      if (stashed) setKitImportSetup(stashed);
    }
  }, [location.state, selectedProfileId]);

  // Same-route re-opens via intentSeq (survives late-loaded layers).
  useEffect(() => {
    if (!copilot || copilot.intentSeq === 0) return;
    if (copilot.intentSeq === appliedIntentSeqRef.current) return;
    const intent = copilot.lastIntent;
    if (!intent || intent.kind !== "focus_kit_option") return;
    appliedIntentSeqRef.current = copilot.intentSeq;
    setKitFocus({
      groupId: intent.groupId,
      stlFilter: intent.stlFilter,
      sourceName: intent.sourceName,
      sourceId: intent.sourceId,
      seq: copilot.intentSeq,
    });
  }, [copilot, copilot?.intentSeq]);

  useEffect(() => {
    if (!kitFocus) return;
    const bits = [
      kitFocus.groupId ? `option “${kitFocus.groupId}”` : null,
      kitFocus.stlFilter ? `STL filter “${kitFocus.stlFilter}”` : null,
    ].filter(Boolean);
    if (bits.length) toast.message(`Build · ${bits.join(" · ")}`);
  }, [kitFocus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps -- toast once per focus seq

  const loadProfileData = useCallback(async (profileId: number) => {
    setLoadError(null);
    try {
      const [layerRows, sourceRows] = await Promise.all([
        fetchPlanLayers(profileId),
        fetchSources(),
      ]);
      setLayers((prev) => (layersEqual(prev, layerRows) ? prev : layerRows));
      setSources(sourceRows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const previousId = previousSelectedProfileIdRef.current;
    const profileChanged = previousId !== undefined && previousId !== selectedProfileId;
    previousSelectedProfileIdRef.current = selectedProfileId;

    if (selectedProfileId == null) {
      setLayers([]);
      setAddonSourceId("");
      setPendingBaseSourceId("");
      setKitFocus(null);
      setRoleFilaments([]);
      return;
    }
    // Reset kit/layer UI only when the profile id actually changes (not on first mount),
    // so nav/intent kitFocus set earlier in the same commit is preserved.
    if (profileChanged) {
      setLayers([]);
      setAddonSourceId("");
      setPendingBaseSourceId("");
      setKitFocus(null);
      setRoleFilaments([]);
      setLoadError(null);
    }

    let cancelled = false;
    void (async () => {
      try {
        const [layerRows, sourceRows] = await Promise.all([
          fetchPlanLayers(selectedProfileId),
          fetchSources(),
        ]);
        if (cancelled) return;
        setLayers((prev) => (layersEqual(prev, layerRows) ? prev : layerRows));
        setSources(sourceRows);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProfileId]);

  const baseLayer = useMemo(
    () => layers.find((l) => l.layer_type === "base") ?? null,
    [layers],
  );
  const addonLayers = useMemo(
    () => layers.filter((l) => l.layer_type !== "base"),
    [layers],
  );

  const attachedSourceIds = useMemo(() => {
    const ids = new Set<number>();
    for (const layer of layers) {
      if (layer.project_id != null) ids.add(layer.project_id);
    }
    return ids;
  }, [layers]);

  const addonSourceOptions = useMemo(
    () => sources.filter((s) => !attachedSourceIds.has(s.id)),
    [sources, attachedSourceIds],
  );

  const baseSourceOptions = useMemo(
    () => sources.map((s) => ({ value: String(s.id), label: s.name })),
    [sources],
  );

  const addonComboboxOptions = useMemo(
    () => addonSourceOptions.map((s) => ({ value: String(s.id), label: s.name })),
    [addonSourceOptions],
  );

  useEffect(() => {
    if (addonSourceId && !addonSourceOptions.some((s) => String(s.id) === addonSourceId)) {
      setAddonSourceId("");
    }
  }, [addonSourceId, addonSourceOptions]);

  const sourceById = useMemo(() => {
    const map = new Map<number, SourceSummary>();
    for (const s of sources) map.set(s.id, s);
    return map;
  }, [sources]);

  const sourceCardLayers = useMemo(() => {
    const rows: Array<{
      key: string;
      layer: ProfileLayer;
      sourceId: number;
      sourceName: string;
      layerType: "base" | "addon";
    }> = [];
    if (baseLayer?.project_id != null) {
      rows.push({
        key: `base-${baseLayer.id}`,
        layer: baseLayer,
        sourceId: baseLayer.project_id,
        sourceName: baseLayer.project_name ?? "base",
        layerType: "base",
      });
    }
    for (const layer of addonLayers) {
      if (layer.project_id == null) continue;
      rows.push({
        key: `addon-${layer.id}`,
        layer,
        sourceId: layer.project_id,
        sourceName: layer.project_name ?? "addon",
        layerType: "addon",
      });
    }
    return rows;
  }, [baseLayer, addonLayers]);

  const needsBaseSource = baseLayer?.project_id == null;

  const { flushAll: flushImportRules } = useImportRulesSaveRegistry();
  const { flushAll: flushKitManifest } = useKitManifestSaveRegistry();

  const flushPendingSaves = useCallback(async () => {
    await Promise.all([flushImportRules(), flushKitManifest()]);
  }, [flushImportRules, flushKitManifest]);

  useAutoRecompute({
    profileId: selectedProfileId,
    stale: buildStale,
    enabled: autoRecomputeEnabled,
    beforeRecompute: flushPendingSaves,
    onDone: () => {
      bumpPlanRevision();
      setFilamentRefreshKey((k) => k + 1);
      if (selectedProfileId != null) void loadProfileData(selectedProfileId);
      void reloadProfiles();
    },
  });

  useEffect(() => {
    return () => {
      void flushPendingSaves();
    };
  }, [flushPendingSaves]);

  const openAssistant = () => {
    window.dispatchEvent(new Event("pp-open-assistant"));
  };

  const attachedSources = useMemo(
    () =>
      sourceCardLayers
        .map((row) => sourceById.get(row.sourceId))
        .filter((s): s is SourceSummary => s != null),
    [sourceCardLayers, sourceById],
  );

  const partCount =
    selectedProfile?.part_count ?? review?.totals.included_parts ?? 0;

  const planWarnings = buildPlanWarningLines({
    buildStale,
    attachedSources,
    review,
    roleFilaments,
  });

  const headerSubtitle = planHeaderSubtitle({
    profile: selectedProfile,
    sourceCount: sourceCardLayers.length,
    partCount,
  });

  const onUpdateBuild = async () => {
    if (selectedProfileId == null) return;
    try {
      await flushPendingSaves();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    void runJob(
      () => startRecompute(selectedProfileId, { apply_manifest: true }),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Update build failed");
          return;
        }
        pendingConflictCheckRef.current = true;
        bumpPlanRevision();
        setFilamentRefreshKey((k) => k + 1);
        void loadProfileData(selectedProfileId);
        void reloadProfiles();
        void reloadReview();
      },
      { profileId: selectedProfileId },
    );
  };

  const onChangeLayerProject = async (layer: ProfileLayer, projectId: number) => {
    if (selectedProfileId == null) return;
    try {
      if (layer.layer_type === "base") {
        await setProfileBaseLayer(selectedProfileId, projectId);
      } else {
        await replaceProfileLayer(selectedProfileId, layer.id, projectId);
      }
      await loadProfileData(selectedProfileId);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRemoveLayer = async (layer: ProfileLayer) => {
    if (selectedProfileId == null) return;
    try {
      await deleteProfileLayer(selectedProfileId, layer.id);
      await loadProfileData(selectedProfileId);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAddAddon = async () => {
    if (selectedProfileId == null || !addonSourceId) return;
    try {
      await addProfileAddonLayer(selectedProfileId, Number(addonSourceId));
      setAddonSourceId("");
      await loadProfileData(selectedProfileId);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSetBaseSource = async () => {
    if (selectedProfileId == null || !pendingBaseSourceId) return;
    try {
      await setProfileBaseLayer(selectedProfileId, Number(pendingBaseSourceId));
      setPendingBaseSourceId("");
      await loadProfileData(selectedProfileId);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs items={[{ label: "Plan", to: buildRoute(selectedProfileId) }]} />
      <PageHeader
        icon={Hammer}
        accent
        title="Plan"
        description={headerSubtitle}
        actions={
          <PageHeaderActions>
            <Button
              className="min-h-10 w-full sm:w-auto"
              onClick={() => void onUpdateBuild()}
              disabled={selectedProfileId == null || busy || !health}
            >
              {busy ? "Rebuilding…" : "Rebuild plan"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-10 w-10"
                  disabled={selectedProfileId == null || !health}
                  aria-label="Plan actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={openDuplicatePlan}
                  disabled={selectedProfileId == null}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={openRenamePlan}
                  disabled={selectedProfileId == null}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={openDeletePlan}
                  disabled={selectedProfileId == null}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </PageHeaderActions>
        }
      />

      {selectedProfileId != null && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Export STLs and Share live on{" "}
          <Link
            to={exportRoute(selectedProfileId)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Export
          </Link>
          .
        </p>
      )}

      <StaleBuildBanner stale={buildStale} busy={busy} onUpdate={() => void onUpdateBuild()} />

      {!buildStale && mergeConflicts.length > 0 && (
        <MergeConflictBanner
          conflictCount={mergeConflicts.length}
          groupedByFilename={mergeConflictGroups}
          profileId={selectedProfileId}
        />
      )}

      {!health ? null : profiles.length === 0 ? (
        <EmptyState
          icon={Hammer}
          title="No plan yet"
          description="Use Create plan in the sidebar (or the + button on mobile) to create a plan, then attach sources and pick STL files below."
          action={{
            label: "Create plan",
            onClick: openCreatePlan,
          }}
        />
      ) : selectedProfileId == null ? (
        <EmptyState
          icon={Hammer}
          title="Select a plan"
          description="Choose a plan in the sidebar plan picker (or the mobile plan switcher in the header)."
        />
      ) : null}

      {kitImportSetup &&
        ((kitImportSetup.unmatched_sources?.length ?? 0) > 0 ||
          (kitImportSetup.warnings?.length ?? 0) > 0) && (
          <ShareImportSetupPanel
            unmatchedSources={(kitImportSetup.unmatched_sources ?? []) as UnmatchedSource[]}
            warnings={kitImportSetup.warnings ?? []}
            profileId={kitImportSetup.profile_id}
            onDismiss={() => setKitImportSetup(null)}
            onSourcesChanged={() => {
              if (selectedProfileId != null) void loadProfileData(selectedProfileId);
            }}
          />
        )}

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {selectedProfileId != null && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PlanRolesCard
              profileId={selectedProfileId}
              disabled={!health || busy}
              refreshKey={filamentRefreshKey}
              onRolesChange={setRoleFilaments}
              onUpdated={onRoleFilamentsUpdated}
            />
            <PlanWarningsCard warnings={planWarnings} onAskAssistant={openAssistant} />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Attached sources
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <BuildSourcesPanel
                  profileId={selectedProfileId}
                  layers={layers}
                  onLayersChange={setLayers}
                  disabled={!health || busy}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategoriesSheetOpen(true)}
                >
                  Categories…
                </Button>
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline"
                  onClick={() => setAttachOpen((v) => !v)}
                >
                  Attach another
                </button>
                <Button variant="link" className="h-auto p-0 text-xs" asChild>
                  <Link to={libraryRoute()}>Library</Link>
                </Button>
              </div>
            </div>

            {needsBaseSource && (
              <Card className="border-dashed">
                <CardHeader className="p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge variant="base" icon={Layers}>
                      base
                    </Badge>
                    <div className="min-w-0 flex-1 space-y-1">
                      <CardTitle className="text-sm">Choose base source</CardTitle>
                      <CardDescription className="text-xs">
                        Pick the main kit project for this plan before adding addons or importing
                        files.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 p-4 pt-0">
                  <Combobox
                    value={pendingBaseSourceId || null}
                    onValueChange={setPendingBaseSourceId}
                    disabled={!health || selectedProfileId == null}
                    placeholder="Choose base source…"
                    searchPlaceholder="Search sources…"
                    emptyText="No sources match."
                    options={baseSourceOptions}
                  />
                  <Button
                    size="sm"
                    onClick={() => void onSetBaseSource()}
                    disabled={!pendingBaseSourceId || selectedProfileId == null || !health}
                  >
                    Set base source
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-col gap-2">
              {sourceCardLayers.map((row, index) => {
                const focusMatchesSource =
                  kitFocus != null &&
                  ((kitFocus.sourceId != null && kitFocus.sourceId === row.sourceId) ||
                    (kitFocus.sourceName != null &&
                      kitFocus.sourceName.toLowerCase() === row.sourceName.toLowerCase()) ||
                    (kitFocus.sourceId == null &&
                      kitFocus.sourceName == null &&
                      (Boolean(kitFocus.groupId) || Boolean(kitFocus.stlFilter)) &&
                      row.layerType === "base"));
                return (
                  <SourceFilePickerCard
                    key={row.key}
                    sourceId={row.sourceId}
                    sourceName={row.sourceName}
                    layerType={row.layerType}
                    source={sourceById.get(row.sourceId) ?? null}
                    allSources={sources}
                    disabled={!health || busy}
                    defaultExpanded={index === 0 && Boolean(kitFocus)}
                    forceExpanded={focusMatchesSource}
                    stlFilter={focusMatchesSource ? kitFocus?.stlFilter ?? null : null}
                    stlFilterFocusSeq={focusMatchesSource ? kitFocus?.seq ?? 0 : 0}
                    onChangeSource={(projectId) => void onChangeLayerProject(row.layer, projectId)}
                    onRemove={
                      row.layerType === "addon"
                        ? () => void onRemoveLayer(row.layer)
                        : undefined
                    }
                    expandedExtra={
                      row.layerType === "base" ? (
                        <KitManifestOptions
                          profileId={selectedProfileId}
                          baseSourceName={row.sourceName}
                          buildStale={buildStale}
                          disabled={!health || busy}
                          compact
                          focusGroupId={kitFocus?.groupId ?? null}
                          focusSeq={kitFocus?.seq ?? 0}
                        />
                      ) : undefined
                    }
                    meshColorForPath={resolvePreviewMeshColor}
                  />
                );
              })}
            </div>

            {(attachOpen || addonSourceId) && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Combobox
                  value={addonSourceId || null}
                  onValueChange={setAddonSourceId}
                  disabled={
                    !health ||
                    selectedProfileId == null ||
                    needsBaseSource ||
                    addonSourceOptions.length === 0
                  }
                  placeholder={
                    addonSourceOptions.length === 0
                      ? "All sources already attached"
                      : "Attach another source…"
                  }
                  searchPlaceholder="Search sources…"
                  emptyText="No sources match."
                  options={addonComboboxOptions}
                  className="min-h-10 w-full min-w-0 flex-1 sm:w-auto"
                  contentClassName="min-w-[16rem]"
                />
                <Button
                  size="sm"
                  className="min-h-10 w-full sm:w-auto"
                  onClick={() => {
                    void onAddAddon();
                    setAttachOpen(false);
                  }}
                  disabled={!addonSourceId || needsBaseSource}
                >
                  Attach
                </Button>
              </div>
            )}
          </section>

          <BuildRecipePanel profileId={selectedProfileId} />
        </div>
      )}

      <SourceCategorySheet
        open={categoriesSheetOpen}
        onOpenChange={setCategoriesSheetOpen}
        engineReady={Boolean(health)}
      />
    </div>
  );
}
