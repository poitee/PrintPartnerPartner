import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import PageHeader from "../components/layout/PageHeader";
import PlanManager from "../components/PlanManager";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import KitManifestOptions from "../components/KitManifestOptions";
import RoleFilamentPicker from "../components/RoleFilamentPicker";
import SourceCategorySheet from "../components/sources/SourceCategorySheet";
import SourceFilePickerCard from "../components/SourceFilePickerCard";
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import ShareImportSetupPanel, {
  type UnmatchedSource,
} from "../components/share/ShareImportSetupPanel";
import type { KitImportJobResult } from "../api/engine";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
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
  fetchPlanLayers,
  fetchSources,
  replaceProfileLayer,
  setProfileBaseLayer,
  startExportStlPack,
  startRecompute,
  type ProfileLayer,
  type SourceSummary,
} from "../api/engine";
import { buildRoute, reviewRoute, sourcesRoute } from "../lib/routes";
import { completeExportDownload } from "../lib/exportActions";
import { useProfileSelection } from "../context/ProfileContext";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import { layersEqual } from "../lib/planDataStable";

type BuildLocationState = {
  kitImport?: KitImportJobResult;
};

export default function BuildPage() {
  return <BuildPageContent />;
}

function BuildPageContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { health } = useEngineHealth();
  const { selectedProfileId, reloadProfiles } = useProfileSelection();
  const { busy, message, runJob } = useJobRunner("recompute");
  const exportStlJob = useJobRunner("stl-export");

  const [layers, setLayers] = useState<ProfileLayer[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addonSourceId, setAddonSourceId] = useState("");
  const [pendingBaseSourceId, setPendingBaseSourceId] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [kitImportSetup, setKitImportSetup] = useState<KitImportJobResult | null>(null);
  const [categoriesSheetOpen, setCategoriesSheetOpen] = useState(false);

  useEffect(() => {
    const state = location.state as BuildLocationState | null;
    if (state?.kitImport) {
      setKitImportSetup(state.kitImport);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

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
        toast.success("Build updated");
        void loadProfileData(selectedProfileId);
        void reloadProfiles();
      },
    );
  };

  const onExportStls = () => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "STL export failed");
          return;
        }
        completeExportDownload("STL export", snap.result, { pathField: "root_path" });
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
        title="Build"
        description="Attach sources, pick files, and set role colors."
      />

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-semibold">Manage builds</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Create, rename, duplicate, or delete build plans. Switch the active plan from the header
          dropdown.
        </p>
        <PlanManager hideSelector disabled={!health} />
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button
          onClick={() => void onUpdateBuild()}
          disabled={selectedProfileId == null || busy || !health}
        >
          {busy ? "Updating…" : "Update build"}
        </Button>
        <Button
          variant="secondary"
          onClick={onExportStls}
          disabled={selectedProfileId == null || exportStlJob.busy}
        >
          Export STLs
        </Button>
        <Button
          variant="secondary"
          onClick={() => setShareOpen(true)}
          disabled={selectedProfileId == null}
        >
          Share build…
        </Button>
        {selectedProfileId != null && (
          <Button variant="ghost" onClick={onNavigateToReview}>
            Review →
          </Button>
        )}
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>

      {kitImportSetup &&
        ((kitImportSetup.unmatched_sources?.length ?? 0) > 0 ||
          (kitImportSetup.warnings?.length ?? 0) > 0) && (
          <ShareImportSetupPanel
            unmatchedSources={(kitImportSetup.unmatched_sources ?? []) as UnmatchedSource[]}
            warnings={kitImportSetup.warnings ?? []}
            profileId={kitImportSetup.profile_id}
            onDismiss={() => setKitImportSetup(null)}
          />
        )}

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {exportStlJob.message && (
        <p className="text-sm text-muted-foreground">{exportStlJob.message}</p>
      )}

      <div className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-semibold">Role filament colors</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Pick a catalog or custom color for each STL role. Changes apply immediately to all
            included parts with that role.
          </p>
          {selectedProfileId == null ? (
            <p className="text-sm text-muted-foreground">Select a build plan first.</p>
          ) : (
            <RoleFilamentPicker
              profileId={selectedProfileId}
              disabled={!health || busy}
              onUpdated={() => {}}
            />
          )}
        </section>

        {selectedProfileId != null && baseLayer?.project_id != null && (
          <KitManifestOptions
            profileId={selectedProfileId}
            baseSourceName={baseLayer.project_name}
            disabled={!health || busy}
          />
        )}

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Sources &amp; files</h3>
            <p className="text-xs text-muted-foreground">
              Expand a source to choose STL files (saved automatically), then click{" "}
              <strong className="font-medium text-foreground">Update build</strong>.
            </p>
          </div>

          {needsBaseSource && (
            <Card className="border-dashed">
              <CardHeader className="p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant="base">base</Badge>
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
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={pendingBaseSourceId}
                  disabled={!health || selectedProfileId == null}
                  onChange={(e) => setPendingBaseSourceId(e.target.value)}
                >
                  <option value="">Choose base source…</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
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

          {sourceCardLayers.map((row, index) => (
            <SourceFilePickerCard
              key={row.key}
              sourceId={row.sourceId}
              sourceName={row.sourceName}
              layerType={row.layerType}
              source={sourceById.get(row.sourceId) ?? null}
              allSources={sources}
              disabled={!health}
              defaultExpanded={index === 0}
              onChangeSource={(projectId) => void onChangeLayerProject(row.layer, projectId)}
              onRemove={
                row.layerType === "addon"
                  ? () => void onRemoveLayer(row.layer)
                  : undefined
              }
            />
          ))}

          <div className="flex flex-wrap gap-2">
            <select
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={addonSourceId}
              onChange={(e) => setAddonSourceId(e.target.value)}
              disabled={!health || selectedProfileId == null || needsBaseSource}
            >
              <option value="">Add addon…</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => void onAddAddon()}
              disabled={!addonSourceId || needsBaseSource}
            >
              Add addon
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sync repos on{" "}
            <Link to={sourcesRoute()} className="text-primary underline">
              Sources
            </Link>{" "}
            first.{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => setCategoriesSheetOpen(true)}
            >
              Manage source categories
            </button>
            .
          </p>
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
