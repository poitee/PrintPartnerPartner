import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Hammer, Layers } from "lucide-react";
import StaleBuildBanner from "../components/StaleBuildBanner";
import MergeConflictBanner from "../components/MergeConflictBanner";
import BuildSourcesPanel from "../components/build/BuildSourcesPanel";
import BuildRecipePanel from "../components/build/BuildRecipePanel";
import EmptyState from "../components/layout/EmptyState";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import PlanManager from "../components/PlanManager";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import RoleFilamentPicker from "../components/RoleFilamentPicker";
import KitManifestOptions from "../components/KitManifestOptions";
import SourceCategorySheet from "../components/sources/SourceCategorySheet";
import SourceFilePickerCard from "../components/SourceFilePickerCard";
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import ShareImportSetupPanel, {
  type UnmatchedSource,
} from "../components/share/ShareImportSetupPanel";
import type { KitImportJobResult } from "../api/engine";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
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
  startExportStlPack,
  startRecompute,
  type ProfileLayer,
  type RoleFilamentRow,
  type SourceSummary,
  type StlPackGroupBy,
  DEFAULT_STL_NAMING_PROFILE,
  type StlNamingProfile,
} from "../api/engine";
import { buildRoute, reviewRoute, settingsRoute } from "../lib/routes";
import { handleStlPackExportJobDone } from "../lib/exportStlJobResult";
import { groupMergeConflictsByFilename } from "../lib/mergeConflictGroups";
import { takeKitImportResult } from "../lib/kitImportStash";
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
  const navigate = useNavigate();
  const { health } = useEngineHealth();
  const { selectedProfileId, reloadProfiles, profiles } = useProfileSelection();
  const { openCreatePlan } = usePlanActions();
  const { invalidate: bumpPlanRevision, review, invalidate: reloadReview } = usePlanWorkspace();
  const { busy, runJob } = useJobRunner("recompute");
  const exportStlJob = useJobRunner("stl-export");
  const copilot = useCopilotUiOptional();
  const pendingConflictCheckRef = useRef(false);
  const appliedIntentSeqRef = useRef(0);

  const [layers, setLayers] = useState<ProfileLayer[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addonSourceId, setAddonSourceId] = useState("");
  const [pendingBaseSourceId, setPendingBaseSourceId] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [kitImportSetup, setKitImportSetup] = useState<KitImportJobResult | null>(null);
  const [categoriesSheetOpen, setCategoriesSheetOpen] = useState(false);
  const [filamentRefreshKey, setFilamentRefreshKey] = useState(0);
  const [autoRecomputeEnabled, setAutoRecomputeEnabled] = useState(true);
  const [roleFilaments, setRoleFilaments] = useState<RoleFilamentRow[]>([]);
  const [namingProfile, setNamingProfile] = useState<StlNamingProfile>(DEFAULT_STL_NAMING_PROFILE);
  const [kitFocus, setKitFocus] = useState<KitFocusState | null>(null);

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
    if (selectedProfileId == null) return;
    void loadProfileData(selectedProfileId);
  }, [selectedProfileId, loadProfileData]);

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

  const onNavigateToReview = () => {
    void flushPendingSaves().then(() => {
      if (selectedProfileId != null) {
        navigate(reviewRoute(selectedProfileId));
      }
    });
  };

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

  const onExportStls = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId, { group_by: groupBy }),
      (snap) => {
        handleStlPackExportJobDone("STL export", snap, { pathField: "root_path" });
      },
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
      <RouteBreadcrumbs items={[{ label: "Build", to: buildRoute(selectedProfileId) }]} />
      <PageHeader
        icon={Hammer}
        accent
        title="Build"
        description="Attach sources, pick STL files, set role colors, then update the build."
        actions={
          <PageHeaderActions>
            <Button
              className="min-h-10 w-full sm:w-auto"
              onClick={() => void onUpdateBuild()}
              disabled={selectedProfileId == null || busy || !health}
            >
              {busy ? "Updating…" : "Update build"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="min-h-10 w-full sm:w-auto"
                  disabled={selectedProfileId == null || exportStlJob.busy || !health}
                >
                  {exportStlJob.busy ? "Exporting…" : "Export STLs"}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Group exported files by</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onExportStls("color_dir")}>
                  <div className="flex flex-col">
                    <span>Color + directory</span>
                    <span className="text-xs text-muted-foreground">
                      Keep source folders (e.g. Primary/partsDir/file.stl)
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onExportStls("color")}>
                  <div className="flex flex-col">
                    <span>Color only</span>
                    <span className="text-xs text-muted-foreground">
                      Flatten all directories (e.g. Primary/file.stl)
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => setShareOpen(true)}
              disabled={selectedProfileId == null || !health}
            >
              Share build…
            </Button>
            {selectedProfileId != null && (
              <Button
                variant="ghost"
                className="col-span-2 min-h-10 w-full sm:col-span-1 sm:w-auto"
                onClick={onNavigateToReview}
              >
                Review →
              </Button>
            )}
          </PageHeaderActions>
        }
      />

      <PlanManager
        disabled={!health}
        collapsible
        defaultOpen={profiles.length === 0 || selectedProfileId == null}
      />

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
          title="No build plan yet"
          description="Use Manage builds above to create a plan, then attach sources and pick STL files below."
          action={{
            label: "Create build",
            onClick: openCreatePlan,
          }}
        />
      ) : selectedProfileId == null ? (
        <EmptyState
          icon={Hammer}
          title="Select a build plan"
          description="Choose a plan in Manage builds above or the header dropdown."
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

      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Sources &amp; files</h3>
              <p className="text-xs text-muted-foreground">
                Expand each source to pick STL files, then run{" "}
                <strong className="font-medium text-foreground">Update build</strong>.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedProfileId != null && (
                <BuildSourcesPanel
                  profileId={selectedProfileId}
                  layers={layers}
                  onLayersChange={setLayers}
                  disabled={!health || busy}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setCategoriesSheetOpen(true)}
              >
                Categories…
              </Button>
            </div>
          </div>

          {selectedProfileId != null && (
            <BuildRecipePanel profileId={selectedProfileId} />
          )}

          {needsBaseSource && (
            <Card className="border-dashed">
              <CardHeader className="p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant="base" icon={Layers}>base</Badge>
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
                <Select
                  value={pendingBaseSourceId || undefined}
                  onValueChange={setPendingBaseSourceId}
                  disabled={!health || selectedProfileId == null}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose base source…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              defaultExpanded={index === 0}
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
                row.layerType === "base" && selectedProfileId != null ? (
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

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Select
              value={addonSourceId || undefined}
              onValueChange={setAddonSourceId}
              disabled={!health || selectedProfileId == null || needsBaseSource}
            >
              <SelectTrigger className="min-h-10 w-full min-w-0 flex-1 sm:w-auto">
                <SelectValue placeholder="Add addon…" />
              </SelectTrigger>
              <SelectContent>
                {addonSourceOptions.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    All sources already attached
                  </SelectItem>
                ) : (
                  addonSourceOptions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => void onAddAddon()}
              disabled={!addonSourceId || needsBaseSource}
            >
              Add addon
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-semibold">Part roles</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Roles come from STL filenames and folder rules (e.g.{" "}
            {DEFAULT_STL_NAMING_PROFILE.roles
              .filter((r) => r.markers.length > 0)
              .map((r) => `${r.markers.join(", ")} → ${r.label}`)
              .join("; ")}
            ).{" "}
            <Button variant="link" className="h-auto p-0 text-xs" asChild>
              <Link to={`${settingsRoute()}#stl-naming`}>Customize roles in Settings</Link>
            </Button>
          </p>

          <h3 className="mb-1 mt-4 text-sm font-semibold">Colors by role</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Pick a filament color for each role — it applies to every included part with that role.
            Review and Checkoff previews update automatically when you change a color.
          </p>
          {selectedProfileId == null ? (
            <p className="text-sm text-muted-foreground">Select a build plan in the header first.</p>
          ) : (
            <RoleFilamentPicker
              profileId={selectedProfileId}
              disabled={!health || busy}
              refreshKey={filamentRefreshKey}
              onRolesChange={setRoleFilaments}
              onUpdated={onRoleFilamentsUpdated}
            />
          )}
        </section>
      </div>

      {selectedProfileId != null && (
        <ShareBuildExportDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          profileId={selectedProfileId}
        />
      )}

      <SourceCategorySheet
        open={categoriesSheetOpen}
        onOpenChange={setCategoriesSheetOpen}
        engineReady={Boolean(health)}
      />
    </div>
  );
}
