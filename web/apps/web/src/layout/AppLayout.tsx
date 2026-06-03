import { type ComponentType, type MouseEvent, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckSquare,
  ClipboardCheck,
  FolderGit2,
  Hammer,
  Layers,
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
import UpdateAvailableBanner, {
  dismissUpdateBanner,
  isUpdateBannerDismissed,
} from "../components/UpdateAvailableBanner";
import { openKofi } from "../lib/supportLinks";
import { useProfileUrlSync } from "../hooks/useProfileUrlSync";
import { useAppUpdateCheck } from "../hooks/useAppUpdateCheck";
import {
  buildRoute,
  buildsRoute,
  checkoffRoute,
  isBuildPath,
  isBuildsPath,
  isCheckoffPath,
  isReviewPath,
  reviewRoute,
  sourcesRoute,
} from "../lib/routes";
import { cn } from "../lib/utils";
import { useProfileSelection } from "../context/ProfileContext";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import ThemePreferenceControl from "../components/ThemePreferenceControl";
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
  Builds: "Create, rename, duplicate, and delete plans",
  Build: "Attach sources, pick files, set colors and quantities",
  Review: "Validate parts, edit quantities, and export",
  Checkoff: "Track what you've printed on the shop floor",
};

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent-brand text-primary-foreground shadow-sm",
        className,
      )}
      aria-hidden
    >
      <Layers className="h-4 w-4" />
    </span>
  );
}

function navLinkClass(active: boolean, compact = false) {
  return cn(
    "relative flex transition-colors",
    compact
      ? "shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium"
      : "flex-col gap-0.5 rounded-md px-3 py-2 text-sm font-medium",
    active
      ? "bg-primary/12 text-primary shadow-sm before:absolute before:left-0 before:top-1/2 before:h-[60%] before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
      : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
  );
}

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
      className={({ isActive }) => navLinkClass(matchPath ? Boolean(customActive) : isActive)}
    >
      <span className="flex items-center gap-2 pl-0.5">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            (matchPath ? customActive : location.pathname === to.split("?")[0]) && "text-primary",
          )}
        />
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

function EngineStatusPill({
  health,
  error,
}: {
  health: ReturnType<typeof useEngineHealth>["health"];
  error: ReturnType<typeof useEngineHealth>["error"];
}) {
  const online = Boolean(health);
  const offline = Boolean(error);
  const label = online ? "Engine online" : offline ? "Engine offline" : "Connecting…";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
        online && "border-success/30 bg-success/10 text-success",
        offline && "border-destructive/30 bg-destructive/10 text-destructive",
        !online && !offline && "border-warning/30 bg-warning/10 text-warning",
      )}
    >
      <span
        className={cn(
          "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
          online && "bg-success shadow-[0_0_6px_color-mix(in_srgb,var(--success)_60%,transparent)]",
          offline && "bg-destructive",
          !online && !offline && "animate-pulse bg-warning",
        )}
      />
      {label}
    </span>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { health, error } = useEngineHealth();
  const { updateCheck } = useAppUpdateCheck(Boolean(health));
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (updateCheck?.latest_version) {
      setBannerDismissed(isUpdateBannerDismissed(updateCheck.latest_version));
    }
  }, [updateCheck?.latest_version]);

  const onDismissUpdateBanner = () => {
    if (!updateCheck?.latest_version) return;
    dismissUpdateBanner(updateCheck.latest_version);
    setBannerDismissed(true);
  };

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
    (isBuildPath(location.pathname) ||
      isBuildsPath(location.pathname) ||
      isReviewPath(location.pathname) ||
      isCheckoffPath(location.pathname));

  const pipelineNav: NavEntry[] = [
    { to: sourcesRoute(), label: "Sources", hint: NAV_HINTS.Sources, icon: FolderGit2 },
    {
      to: buildsRoute(selectedProfileId),
      label: "Builds",
      hint: NAV_HINTS.Builds,
      icon: Layers,
      isActive: (pathname) => isBuildsPath(pathname),
    },
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
    {
      to: checkoffRoute(selectedProfileId),
      label: "Checkoff",
      hint: NAV_HINTS.Checkoff,
      icon: CheckSquare,
      isActive: (pathname) => isCheckoffPath(pathname),
    },
  ];

  return (
    <div className="flex min-h-screen min-w-0 bg-background">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card lg:flex print:hidden">
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">Print Partner</h1>
              <p className="text-xs text-muted-foreground">
                Sources → Build → Review → Checkoff
              </p>
            </div>
          </div>
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
                cn(navLinkClass(isActive), "flex-row items-center gap-2 pl-0.5")
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border p-3">
          <div className="px-1">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
            <ThemePreferenceControl compact className="w-full" />
          </div>
          <SupportCta variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 print:hidden"
          style={{ background: "var(--gradient-header)" }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <EngineStatusPill health={health} error={error} />
            {showPlanInHeader && activePlanName && (
              <span className="hidden truncate text-muted-foreground md:inline">
                · <span className="font-medium text-foreground">{activePlanName}</span>
              </span>
            )}
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:justify-end">
            <SupportCta variant="secondary" size="sm" className="hidden shrink-0 sm:inline-flex" />
            <ThemePreferenceControl compact className="hidden shrink-0 md:inline-flex" />
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
                return navLinkClass(active, true);
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

        {updateCheck && (
          <UpdateAvailableBanner
            updateCheck={updateCheck}
            dismissed={bannerDismissed}
            onDismiss={onDismissUpdateBanner}
          />
        )}
      </div>

      <JobTray />
      <CommandPalette />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
