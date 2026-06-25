import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  startExportKitBundle,
  startExportStlPack,
  startRecompute,
  startSync,
} from "../api/engine";
import { useProfileSelection } from "../context/ProfileContext";
import { useFlushBuildPageSaves } from "../hooks/useFlushBuildPageSaves";
import { useImportSharedBuild } from "../hooks/useImportSharedBuild";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";
import {
  buildRoute,
  buildsRoute,
  checkoffRoute,
  helpRoute,
  isBuildPath,
  isCheckoffPath,
  isReviewPath,
  reviewRoute,
  settingsRoute,
  sourcesRoute,
} from "../lib/routes";
import { completeExportDownload } from "../lib/exportActions";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";

type Action = {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Workflow" | "Actions";
  disabled?: boolean;
  run: () => void;
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { health } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const flushBuildSaves = useFlushBuildPageSaves();
  const importSharedBuild = useImportSharedBuild();
  const recomputeJob = useJobRunner("recompute");
  const syncJob = useJobRunner("sync");
  const stlExportJob = useJobRunner("stl-export");
  const kitExportJob = useJobRunner("kit-export");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onBuild = isBuildPath(location.pathname);
  const onReview = isReviewPath(location.pathname);
  const onCheckoff = isCheckoffPath(location.pathname);
  const onSources = location.pathname === "/sources";

  const actions: Action[] = useMemo(() => {
    const leaveBuildThen = (go: () => void) => {
      if (onBuild) void flushBuildSaves().then(go);
      else go();
    };

    const list: Action[] = [
      {
        id: "nav-sources",
        label: "Go to Sources",
        hint: onSources ? "current" : undefined,
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(sourcesRoute());
            setOpen(false);
          });
        },
      },
      {
        id: "search-stl",
        label: "Search all repos for part…",
        hint: "Sources · cross-repo STL",
        group: "Navigate",
        disabled: !health,
        run: () => {
          leaveBuildThen(() => {
            navigate(sourcesRoute(), { state: { stlSearch: true } });
            setOpen(false);
          });
        },
      },
      {
        id: "nav-build",
        label: "Go to Build",
        hint: onBuild ? "current" : undefined,
        group: "Navigate",
        run: () => {
          navigate(buildRoute(selectedProfileId));
          setOpen(false);
        },
      },
      {
        id: "nav-review",
        label: "Go to Review",
        hint: onReview ? "current" : undefined,
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(reviewRoute(selectedProfileId));
            setOpen(false);
          });
        },
      },
      {
        id: "nav-checkoff",
        label: "Go to Checkoff",
        hint: onCheckoff ? "current" : undefined,
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(checkoffRoute(selectedProfileId));
            setOpen(false);
          });
        },
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(settingsRoute());
            setOpen(false);
          });
        },
      },
      {
        id: "nav-help",
        label: "Go to Help",
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(helpRoute());
            setOpen(false);
          });
        },
      },
      {
        id: "manage-builds",
        label: "Manage builds",
        hint: "Builds → create, rename, duplicate, delete",
        group: "Workflow",
        run: () => {
          leaveBuildThen(() => {
            navigate(buildsRoute(selectedProfileId));
            setOpen(false);
          });
        },
      },
    ];

    if (health && selectedProfileId != null) {
      list.push(
        {
          id: "update-build",
          label: "Update build",
          hint: "Scan layers and merge parts",
          group: "Workflow",
          disabled: recomputeJob.busy,
          run: () => {
            void recomputeJob.runJob(() =>
              startRecompute(selectedProfileId, { apply_manifest: false }),
            );
            if (!onBuild) navigate(buildRoute(selectedProfileId));
            setOpen(false);
          },
        },
        {
          id: "export-share",
          label: "Share build…",
          hint: "Export .print-partner-kit.zip",
          group: "Workflow",
          disabled: kitExportJob.busy,
          run: () => {
            void kitExportJob.runJob(
              () => startExportKitBundle(selectedProfileId, false),
              (snap) => {
                if (snap.status === "error") {
                  toast.error(snap.message || "Export failed");
                  return;
                }
                completeExportDownload("Share build", snap.result);
              },
            );
            if (!onBuild && !onReview) navigate(buildRoute(selectedProfileId));
            setOpen(false);
          },
        },
        {
          id: "export-stl",
          label: "Export STLs",
          hint: `Plan #${selectedProfileId}`,
          group: "Actions",
          disabled: stlExportJob.busy,
          run: () => {
            void stlExportJob.runJob(
              () => startExportStlPack(selectedProfileId),
              (snap) => {
                if (snap.status === "error") {
                  toast.error(snap.message || "STL export failed");
                  return;
                }
                completeExportDownload("STL export", snap.result, { pathField: "root_path" });
              },
            );
            if (!onBuild && !onReview && !onCheckoff) navigate(reviewRoute(selectedProfileId));
            setOpen(false);
          },
        },
        {
          id: "export-missing-stl",
          label: "Export missing STLs",
          hint: onCheckoff ? "Checkoff" : onReview ? "Review" : `Plan #${selectedProfileId}`,
          group: "Actions",
          disabled: stlExportJob.busy,
          run: () => {
            void stlExportJob.runJob(
              () => startExportStlPack(selectedProfileId, { missing_only: true }),
              (snap) => {
                if (snap.status === "error") {
                  toast.error(snap.message || "Export failed");
                  return;
                }
                completeExportDownload("Missing-parts STL", snap.result, {
                  pathField: "root_path",
                });
              },
            );
            if (!onReview && !onCheckoff) navigate(checkoffRoute(selectedProfileId));
            setOpen(false);
          },
        },
        {
          id: "recompute",
          label: "Recompute plan",
          group: "Actions",
          disabled: recomputeJob.busy,
          run: () => {
            void recomputeJob.runJob(() =>
              startRecompute(selectedProfileId, { apply_manifest: false }),
            );
            setOpen(false);
          },
        },
      );
    }

    if (health) {
      list.push(
        {
          id: "search-stl-global",
          label: "Search all repos for part…",
          hint: "Cross-repo STL discovery",
          group: "Actions",
          run: () => {
            navigate(sourcesRoute(), { state: { stlSearch: true } });
            setOpen(false);
          },
        },
        {
          id: "import-shared-build",
          label: "Import shared build…",
          hint: ".print-partner-kit.zip",
          group: "Actions",
          run: () => {
            void importSharedBuild().finally(() => setOpen(false));
          },
        },
        {
          id: "sync-all",
          label: "Sync all sources",
          group: "Actions",
          disabled: syncJob.busy,
          run: () => {
            navigate(sourcesRoute());
            void syncJob.runJob(() => startSync());
            setOpen(false);
          },
        },
      );
    }

    return list;
  }, [
    health,
    selectedProfileId,
    navigate,
    recomputeJob,
    syncJob,
    stlExportJob,
    kitExportJob,
    onBuild,
    onReview,
    onCheckoff,
    onSources,
    flushBuildSaves,
    importSharedBuild,
  ]);

  const groups = ["Navigate", "Workflow", "Actions"] as const;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {groups.map((group, index) => {
          const items = actions.filter((a) => a.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group}>
                {items.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.label} ${a.hint ?? ""}`}
                    disabled={a.disabled}
                    onSelect={a.run}
                  >
                    <span>{a.label}</span>
                    {a.hint && (
                      <span className="ml-auto text-xs text-muted-foreground">{a.hint}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
