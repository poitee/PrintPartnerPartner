import { type ComponentType, type MouseEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardCheck,
  FolderGit2,
  FolderOpen,
  Hammer,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import CommandPalette from "../components/CommandPalette";
import JobTray from "../components/JobTray";
import SupportCta from "../components/SupportCta";
import { Toaster } from "../components/ui/sonner";
import { Separator } from "../components/ui/separator";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import PlanPicker from "../components/PlanPicker";
import { openDataFolder } from "../api/engine";
import { openKofi } from "../lib/supportLinks";
import { useProfileUrlSync } from "../hooks/useProfileUrlSync";
import {
  buildRoute,
  isBuildPath,
  isReviewPath,
  reviewRoute,
  sourcesRoute,
} from "../lib/routes";
import { cn } from "../lib/utils";
import { useProfileSelection } from "../context/ProfileContext";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import { useEngineHealth } from "../hooks/useEngineHealth";

type NavEntry = {
  to: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  isActive?: (pathname: string) => boolean;
};

const secondaryNav: Omit<NavEntry, "hint">[] = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: BookOpen },
];

const NAV_HINTS: Record<string, string> = {
  Sources: "Register repos and set import folders",
  Build: "Manage plans, attach sources, pick files, set colors",
  Review: "Validate parts, track printing, and export",
};

function NavItem({
  to,
  label,
  hint,
  icon: Icon,
  isActive: matchPath,
  onNavigate,
}: NavEntry & { onNavigate?: (to: string, e: MouseEvent<HTMLAnchorElement>) => void }) {
  const location = useLocation();
  const customActive = matchPath?.(location.pathname);

  return (
    <NavLink
      to={to}
      end={matchPath == null}
      onClick={(e) => onNavigate?.(to, e)}
      className={({ isActive }) =>
        cn(
          "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          (matchPath ? customActive : isActive)
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )
      }
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </span>
      {(matchPath ? customActive : location.pathname === to.split("?")[0]) && (
        <span className="pl-6 text-[11px] font-normal leading-snug text-muted-foreground">
          {hint}
        </span>
      )}
    </NavLink>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { health, error } = useEngineHealth();
  useProfileUrlSync();
  const { selectedProfileId, profiles } = useProfileSelection();
  const { flushAll: flushImportRules } = useImportRulesSaveRegistry();
  const { flushAll: flushKitManifest } = useKitManifestSaveRegistry();

  const onPipelineNavigate = (to: string, e: MouseEvent<HTMLAnchorElement>) => {
    const leavingBuild = isBuildPath(location.pathname) && !isBuildPath(to.split("?")[0] ?? to);
    if (!leavingBuild) return;
    e.preventDefault();
    void Promise.all([flushImportRules(), flushKitManifest()]).then(() => {
      navigate(to);
    });
  };

  const activePlanName =
    selectedProfileId != null
      ? profiles.find((p) => p.id === selectedProfileId)?.name
      : null;

  const showPlanInHeader =
    activePlanName &&
    (isBuildPath(location.pathname) || isReviewPath(location.pathname));

  const pipelineNav: NavEntry[] = [
    { to: sourcesRoute(), label: "Sources", hint: NAV_HINTS.Sources, icon: FolderGit2 },
    {
      to: buildRoute(selectedProfileId),
      label: "Build",
      hint: NAV_HINTS.Build,
      icon: Hammer,
      isActive: (pathname) => pathname === "/build" || pathname === "/plan",
    },
    {
      to: reviewRoute(selectedProfileId),
      label: "Review",
      hint: NAV_HINTS.Review,
      icon: ClipboardCheck,
      isActive: (pathname) => isReviewPath(pathname),
    },
  ];

  return (
    <div className="flex min-h-screen min-w-0 bg-background">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card lg:flex print:hidden">
        <div className="border-b border-border px-4 py-4">
          <h1 className="text-base font-semibold tracking-tight">Print Partner</h1>
          <p className="text-xs text-muted-foreground">
            Sources → Build → Review
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {pipelineNav.map((item) => (
            <NavItem key={item.label} {...item} onNavigate={onPipelineNavigate} />
          ))}
          <Separator className="my-2" />
          {secondaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => void openDataFolder()}
          >
            <FolderOpen className="mr-2 h-4 w-4 shrink-0" />
            Open data folder
          </Button>
          <SupportCta variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-2 border-b border-border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 print:hidden">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex h-2 w-2 shrink-0 rounded-full",
                health ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : error ? "bg-red-400" : "bg-amber-400",
              )}
            />
            <span className="truncate text-muted-foreground">
              {health ? "Engine online" : error ? "Engine offline" : "Connecting…"}
            </span>
            {showPlanInHeader && activePlanName && (
              <span className="hidden truncate text-foreground md:inline">
                · <span className="font-medium">{activePlanName}</span>
              </span>
            )}
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:justify-end">
            <SupportCta variant="secondary" size="sm" className="hidden shrink-0 sm:inline-flex" />
            <PlanPicker className="min-w-0 flex-1 sm:min-w-[200px] sm:max-w-xs" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 lg:hidden"
                  aria-label="More"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  className="sm:hidden"
                  onClick={() => void openKofi()}
                >
                  Support on Ko-fi
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden" />
                {secondaryNav.map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <NavLink to={item.to} className="flex w-full cursor-pointer items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void openDataFolder()}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Open data folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-2 lg:hidden print:hidden [-webkit-overflow-scrolling:touch]"
          aria-label="Workflow"
        >
          {pipelineNav.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              onClick={(e) => onPipelineNavigate(item.to, e)}
              className={({ isActive }) => {
                const active = item.isActive?.(location.pathname) ?? isActive;
                return cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                );
              }}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-x-hidden overflow-y-auto p-3 pb-20 sm:p-5 sm:pb-16 lg:pb-14 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>

      <JobTray />
      <CommandPalette />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
