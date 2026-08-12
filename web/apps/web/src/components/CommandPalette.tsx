import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  startExportKitBundle,
  startExportStlPack,
  startRecompute,
  startSync,
  type StlPackGroupBy,
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
  exportRoute,
  helpRoute,
  isBuildPath,
  isPartsPath,
  reviewRoute,
  settingsRoute,
  sourcesRoute,
} from "../lib/routes";
import { completeExportDownload } from "../lib/exportActions";
import { handleStlPackExportJobDone } from "../lib/exportStlJobResult";
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

type Props = {
  onOpenAssistant?: () => void;
};

export default function CommandPalette({ onOpenAssistant }: Props) {
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
  const onReview = isPartsPath(location.pathname);
  const onSources = location.pathname === "/library" || location.pathname === "/sources";

  const actions: Action[] = useMemo(() => {
    const leaveBuildThen = (go: () => void) => {
      if (onBuild) void flushBuildSaves().then(go);
      else go();
    };

    const list: Action[] = [
      {
        id: "nav-sources",
        label: "Go to Library",
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
        hint: "Library · cross-repo STL",
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
        label: "Go to Plan",
        hint: onBuild ? "current" : undefined,
        group: "Navigate",
        run: () => {
          navigate(buildRoute(selectedProfileId));
          setOpen(false);
        },
      },
      {
        id: "nav-review",
        label: "Go to Parts",
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
        id: "nav-progress",
        label: "Go to Progress",
        hint:
          location.pathname === "/progress" || location.pathname === "/checkoff"
            ? "current"
            : undefined,
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(checkoffRoute(selectedProfileId));
            setOpen(false);
          });
        },
      },
      {
        id: "nav-export",
        label: "Go to Export hub",
        hint: location.pathname === "/export" ? "current" : undefined,
        group: "Navigate",
        run: () => {
          leaveBuildThen(() => {
            navigate(exportRoute(selectedProfileId));
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
        ...(["color_dir", "color"] as const).flatMap((groupBy: StlPackGroupBy) => {
          const groupHint =
            groupBy === "color" ? "color only" : "color + directory";
          return [
            {
              id: `export-stl-${groupBy}`,
              label: `Export STLs (${groupHint})`,
              hint: `Plan #${selectedProfileId}`,
              group: "Actions" as const,
              disabled: stlExportJob.busy,
              run: () => {
                void stlExportJob.runJob(
                  () => startExportStlPack(selectedProfileId, { group_by: groupBy }),
                  (snap) => {
                    handleStlPackExportJobDone("STL export", snap, {
                      pathField: "root_path",
                    });
                  },
                );
                if (!onBuild && !onReview) {
                  navigate(reviewRoute(selectedProfileId));
                }
                setOpen(false);
              },
            },
            {
              id: `export-missing-stl-${groupBy}`,
              label: `Export missing STLs (${groupHint})`,
              hint: onReview ? "Parts" : `Plan #${selectedProfileId}`,
              group: "Actions" as const,
              disabled: stlExportJob.busy,
              run: () => {
                void stlExportJob.runJob(
                  () =>
                    startExportStlPack(selectedProfileId, {
                      missing_only: true,
                      group_by: groupBy,
                    }),
                  (snap) => {
                    handleStlPackExportJobDone("Missing-parts STL", snap, {
                      pathField: "root_path",
                    });
                  },
                );
                if (!onReview) {
                  navigate(reviewRoute(selectedProfileId));
                }
                setOpen(false);
              },
            },
          ];
        }),
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
      if (health.capabilities?.includes("ai_assistant") && onOpenAssistant) {
        list.push({
          id: "open-assistant",
          label: "Open kit advisor",
          hint: "AI guidance",
          group: "Actions",
          run: () => {
            onOpenAssistant();
            setOpen(false);
          },
        });
      }
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
    onSources,
    location.pathname,
    flushBuildSaves,
    importSharedBuild,
    onOpenAssistant,
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
