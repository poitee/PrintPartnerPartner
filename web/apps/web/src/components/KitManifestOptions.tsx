import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPlanKitManifest,
  fetchPlanManifestBuilder,
  type KitManifest,
  type RepoManifestOptionGroup,
} from "../api/engine";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import { useKitManifestAutosave } from "../hooks/useKitManifestAutosave";
import {
  kitManifestSaveStatusLabel,
  shouldShowKitManifestRetry,
} from "../lib/kitManifestSave";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

type Props = {
  profileId: number;
  baseSourceName?: string | null;
  disabled?: boolean;
};

function groupLabel(groupId: string, group: RepoManifestOptionGroup): string {
  return group.label?.trim() || groupId.replace(/_/g, " ");
}

function variantLabel(variant: { id: string; label?: string | null }): string {
  return variant.label?.trim() || variant.id.replace(/_/g, " ");
}

export default function KitManifestOptions({ profileId, baseSourceName, disabled = false }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedKit, setSavedKit] = useState<KitManifest | null>(null);
  const [savedSelections, setSavedSelections] = useState<Record<string, string>>({});
  const [pendingSelections, setPendingSelections] = useState<Record<string, string>>({});
  const [userEdited, setUserEdited] = useState(false);
  const [optionGroups, setOptionGroups] = useState<Record<string, RepoManifestOptionGroup>>({});

  const { registerFlush, unregisterFlush } = useKitManifestSaveRegistry();

  const onSaved = useCallback((kit: KitManifest) => {
    setSavedKit(kit);
    setSavedSelections({ ...kit.selections });
    setUserEdited(false);
  }, []);

  const { dirty, status, saveNow, saveUserEdit } = useKitManifestAutosave({
    profileId,
    pendingSelections,
    savedSelections,
    loaded,
    userEdited,
    disabled,
    baseKit: savedKit,
    onSaved,
    onRegisterFlush: registerFlush,
    onUnregisterFlush: unregisterFlush,
  });

  const saveStatusLabel = kitManifestSaveStatusLabel(status);
  const showRetry = shouldShowKitManifestRetry(status);

  useEffect(() => {
    setLoaded(false);
    setLoadError(null);
    setUserEdited(false);
    setSavedKit(null);
    setSavedSelections({});
    setPendingSelections({});
    setOptionGroups({});

    let cancelled = false;
    void (async () => {
      try {
        const [builder, kit] = await Promise.all([
          fetchPlanManifestBuilder(profileId),
          fetchPlanKitManifest(profileId),
        ]);
        if (cancelled) return;
        let groups = builder.merged_option_groups ?? {};
        if (Object.keys(groups).length === 0 && Object.keys(kit.selections ?? {}).length > 0) {
          groups = Object.fromEntries(
            Object.entries(kit.selections).map(([groupId, variantId]) => [
              groupId,
              {
                rule: "pick_one",
                label: groupId.replace(/_/g, " "),
                parts: [],
                variants: [{ id: variantId, label: variantId.replace(/_/g, " "), parts: [] }],
              },
            ]),
          );
        }
        setOptionGroups(groups);
        setSavedKit(kit);
        const selections = { ...kit.selections };
        for (const [gid, group] of Object.entries(groups)) {
          if (!selections[gid] && group.variants?.length === 1) {
            selections[gid] = group.variants[0]!.id;
          }
        }
        setSavedSelections(selections);
        setPendingSelections(selections);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const visibleGroups = useMemo(
    () =>
      Object.entries(optionGroups).filter(
        ([, group]) => (group.rule ?? "pick_one") === "pick_one" && (group.variants?.length ?? 0) > 0,
      ),
    [optionGroups],
  );

  const onPickVariant = (groupId: string, variantId: string) => {
    const next = { ...pendingSelections, [groupId]: variantId };
    setPendingSelections(next);
    setUserEdited(true);
    saveUserEdit(next);
  };

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading kit options…</p>;
  }

  if (visibleGroups.length === 0) {
    return null;
  }

  const title = baseSourceName ? `${baseSourceName} options` : "Kit options";

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        dirty && "border-primary/40",
      )}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">
            Pick variants for this build. Changes save automatically and are kept after{" "}
            <strong className="font-medium text-foreground">Update build</strong>.
          </p>
        </div>
        {(saveStatusLabel || showRetry) && (
          <div className="flex shrink-0 items-center gap-2 text-xs" aria-live="polite">
            {saveStatusLabel && (
              <span
                className={cn(
                  "text-muted-foreground",
                  status === "saved" && "text-emerald-600 dark:text-emerald-400",
                  status === "error" && "text-destructive",
                )}
              >
                {saveStatusLabel}
              </span>
            )}
            {showRetry && (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={disabled}
                onClick={() => void saveNow()}
              >
                Retry
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {visibleGroups.map(([groupId, group]) => {
          const selected = pendingSelections[groupId] ?? "";
          return (
            <div key={groupId} className="option-group space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-medium capitalize">{groupLabel(groupId, group)}</h4>
                <Badge variant="muted">choose one</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {(group.variants ?? []).map((variant) => {
                  const active = selected === variant.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={active}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                      onClick={() => onPickVariant(groupId, variant.id)}
                    >
                      {variantLabel(variant)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
