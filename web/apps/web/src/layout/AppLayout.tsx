import { type ComponentType, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardCheck,
  FolderGit2,
  Hammer,
  Layers,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
} from "lucide-react";
import CommandPalette from "../components/CommandPalette";
import AssistantChatSheet from "../components/AssistantChatSheet";
import ErrorBoundary from "../components/ErrorBoundary";
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
import CreatePlanButton from "../components/CreatePlanButton";
import SaveStatusIndicator from "../components/SaveStatusIndicator";
import UserMenu from "../components/UserMenu";
import WorkflowProgress from "../components/WorkflowProgress";
import UpdateAvailableBanner, {
  dismissUpdateBanner,
  isUpdateBannerDismissed,
} from "../components/UpdateAvailableBanner";
import { openSponsor } from "../lib/supportLinks";
import { useProfileUrlSync } from "../hooks/useProfileUrlSync";
import { useAppUpdateCheck } from "../hooks/useAppUpdateCheck";
import {
  buildRoute,
  buildsRoute,
  isBuildPath,
  isBuildsPath,
  isReviewPath,
  reviewRoute,
  sourcesRoute,
} from "../lib/routes";
import { cn } from "../lib/utils";
import { useProfileSelection } from "../context/ProfileContext";
import { CopilotUiProvider } from "../context/CopilotUiContext";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import ThemePreferenceControl from "../components/ThemePreferenceControl";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../lib/persistedSidebarUi";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";

type NavEntry = {
  to: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  isActive?: (pathname: string) => boolean;
};

const secondaryNav: Omit<NavEntry, "hint">[] = [
  { to: buildsRoute(), label: "Builds", icon: Layers },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: BookOpen },
];

const NAV_HINTS: Record<string, string> = {
  Sources: "Register repos and set import folders",
  Build: "Attach sources, pick files, set colors and quantities",
  Review: "Validate, edit quantities, track printing, and export",
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

function navLinkClass(active: boolean, opts?: { compact?: boolean; sidebarCollapsed?: boolean }) {
  const compact = opts?.compact ?? false;
  const sidebarCollapsed = opts?.sidebarCollapsed ?? false;
  return cn(
    "relative flex transition-colors",
    sidebarCollapsed
      ? "items-center justify-center rounded-md p-2.5"
      : compact
        ? "shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium"
        : "flex-col gap-0.5 rounded-md px-3 py-2 text-sm font-medium",
    active
      ? "bg-primary/12 text-primary shadow-sm before:absolute before:left-0 before:top-1/2 before:h-[60%] before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
      : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
    sidebarCollapsed && active && "before:hidden",
  );
}

function SidebarTooltip({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavItem({
  to,
  label,
  hint,
  icon: Icon,
  isActive: matchPath,
  onNavigate,
  sidebarCollapsed = false,
}: NavEntry & {
  onNavigate?: (to: string, e: MouseEvent<HTMLAnchorElement>) => void;
  sidebarCollapsed?: boolean;
}) {
  const location = useLocation();
  const customActive = matchPath?.(location.pathname);

  const link = (
    <NavLink
      to={to}
      end={matchPath == null}
      onClick={(e) => onNavigate?.(to, e)}
      className={({ isActive }) =>
        navLinkClass(matchPath ? Boolean(customActive) : isActive, { sidebarCollapsed })
      }
      aria-label={sidebarCollapsed ? label : undefined}
      title={sidebarCollapsed ? undefined : label}
    >
      <span
        className={cn(
          "flex items-center gap-2 pl-0.5",
          sidebarCollapsed && "justify-center pl-0",
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            (matchPath ? customActive : location.pathname === to.split("?")[0]) && "text-primary",
          )}
        />
        {!sidebarCollapsed && label}
      </span>
      {!sidebarCollapsed && (matchPath ? customActive : location.pathname === to.split("?")[0]) && (
        <span className="pl-6 text-[11px] font-normal leading-snug text-muted-foreground">
          {hint}
        </span>
      )}
    </NavLink>
  );

  return (
    <SidebarTooltip label={sidebarCollapsed ? `${label} — ${hint}` : label} collapsed={sidebarCollapsed}>
      {link}
    </SidebarTooltip>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { health } = useEngineHealth();
  const { updateCheck } = useAppUpdateCheck(Boolean(health));
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readSidebarCollapsed());
  const [assistantOpen, setAssistantOpen] = useState(() => {
    try {
      return sessionStorage.getItem("pp-assistant-open") === "1";
    } catch {
      return false;
    }
  });

  const setAssistantOpenPersisted = (open: boolean) => {
    setAssistantOpen(open);
    try {
      sessionStorage.setItem("pp-assistant-open", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const aiAssistantEnabled = Boolean(health?.capabilities?.includes("ai_assistant"));

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  };

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
    <TooltipProvider delayDuration={300}>
    <CopilotUiProvider>
    <div className="flex min-h-screen min-w-0 bg-background">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out lg:flex print:hidden",
          sidebarCollapsed ? "w-[4.25rem]" : "w-56",
        )}
      >
        <div className={cn("border-b border-border", sidebarCollapsed ? "px-2 py-3" : "px-4 py-4")}>
          <div
            className={cn(
              "flex items-center gap-2.5",
              sidebarCollapsed && "justify-center",
            )}
          >
            <BrandMark />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="text-base font-semibold tracking-tight">Print Partner</h1>
                <p className="text-xs text-muted-foreground">
                  Sources → Build → Review
                </p>
              </div>
            )}
          </div>
        </div>
        <nav className={cn("flex flex-1 flex-col gap-1", sidebarCollapsed ? "p-2" : "p-3")}>
          {pipelineNav.map((item) => (
            <NavItem
              key={item.label}
              {...item}
              onNavigate={onPipelineNavigate}
              sidebarCollapsed={sidebarCollapsed}
            />
          ))}
          {!sidebarCollapsed && (
            <div className="px-1 py-2">
              <WorkflowProgress />
            </div>
          )}
          <Separator className={cn("my-2", sidebarCollapsed && "mx-1")} />
          {secondaryNav.map((item) => {
            const to = item.to === buildsRoute() ? buildsRoute(selectedProfileId) : item.to;
            const active =
              location.pathname === item.to.split("?")[0] ||
              (item.label === "Builds" && isBuildsPath(location.pathname));
            const link = (
              <NavLink
                key={item.to}
                to={to}
                className={cn(
                  navLinkClass(active, { sidebarCollapsed }),
                  !sidebarCollapsed && "flex-row items-center gap-2 pl-0.5",
                )}
                aria-label={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && item.label}
              </NavLink>
            );
            return (
              <SidebarTooltip key={item.to} label={item.label} collapsed={sidebarCollapsed}>
                {link}
              </SidebarTooltip>
            );
          })}
        </nav>
        <div className={cn("space-y-2 border-t border-border", sidebarCollapsed ? "p-2" : "p-3")}>
          {!sidebarCollapsed && (
            <>
              <div className="px-1">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
                <ThemePreferenceControl compact className="w-full" />
              </div>
              <SupportCta
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
              />
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size={sidebarCollapsed ? "icon" : "sm"}
            className={cn(
              "text-muted-foreground",
              !sidebarCollapsed && "w-full justify-start",
            )}
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" />
                Collapse sidebar
              </>
            )}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 print:hidden"
          style={{ background: "var(--gradient-header)" }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            {showPlanInHeader && activePlanName && (
              <span className="hidden truncate text-muted-foreground md:inline">
                <span className="font-medium text-foreground">{activePlanName}</span>
              </span>
            )}
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:justify-end">
            <SaveStatusIndicator />
            {aiAssistantEnabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setAssistantOpenPersisted(!assistantOpen)}
                aria-label={assistantOpen ? "Close kit advisor" : "Open kit advisor"}
                aria-pressed={assistantOpen}
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">Advisor</span>
              </Button>
            )}
            <SupportCta variant="secondary" size="sm" className="hidden shrink-0 sm:inline-flex" />
            <ThemePreferenceControl compact className="hidden shrink-0 md:inline-flex" />
            <UserMenu />
            <CreatePlanButton className="hidden sm:inline-flex" />
            <CreatePlanButton size="icon" showLabel={false} className="sm:hidden" />
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
                {aiAssistantEnabled && (
                  <DropdownMenuItem
                    className="lg:hidden"
                    onClick={() => setAssistantOpenPersisted(true)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Kit advisor
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="sm:hidden"
                  onClick={() => openSponsor()}
                >
                  Sponsor on GitHub
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden" />
                {secondaryNav.map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <NavLink
                      to={item.to === buildsRoute() ? buildsRoute(selectedProfileId) : item.to}
                      className="flex w-full cursor-pointer items-center gap-2"
                    >
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
          className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-2 py-2 lg:hidden print:hidden"
          aria-label="Workflow"
        >
          <div className="flex gap-1 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            {pipelineNav.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={(e) => onPipelineNavigate(item.to, e)}
                className={({ isActive }) => {
                  const active = item.isActive?.(location.pathname) ?? isActive;
                  return navLinkClass(active, { compact: true });
                }}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
          <WorkflowProgress compact className="mx-1" />
        </nav>

        <main
          className={cn(
            "flex-1 overflow-x-hidden overflow-y-auto p-3 pb-20 sm:p-5 sm:pb-16 lg:pb-14 print:overflow-visible print:p-0",
            assistantOpen && "lg:pr-[28rem]",
          )}
        >
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
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
      <CommandPalette onOpenAssistant={() => setAssistantOpenPersisted(true)} />
      <AssistantChatSheet open={assistantOpen} onOpenChange={setAssistantOpenPersisted} />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
    </CopilotUiProvider>
    </TooltipProvider>
  );
}
