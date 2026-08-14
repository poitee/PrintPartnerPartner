import { type MouseEvent, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, MoreHorizontal, Printer, Settings, Sparkles } from "lucide-react";
import CommandPalette from "../components/CommandPalette";
import AssistantChatSheet from "../components/AssistantChatSheet";
import ErrorBoundary from "../components/ErrorBoundary";
import JobTray from "../components/JobTray";
import PlanTray from "../components/PlanTray";
import SupportCta from "../components/SupportCta";
import { Toaster } from "../components/ui/sonner";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import CreatePlanButton from "../components/CreatePlanButton";
import SaveStatusIndicator from "../components/SaveStatusIndicator";
import UserMenu from "../components/UserMenu";
import WorkflowProgress from "../components/WorkflowProgress";
import SpineRail from "../components/layout/SpineRail";
import UpdateAvailableBanner, {
  dismissUpdateBanner,
  isUpdateBannerDismissed,
} from "../components/UpdateAvailableBanner";
import { openSponsor } from "../lib/supportLinks";
import { useProfileUrlSync } from "../hooks/useProfileUrlSync";
import { useAppUpdateCheck } from "../hooks/useAppUpdateCheck";
import { useWorkflowStages } from "../hooks/useWorkflowStages";
import {
  helpRoute,
  isBuildPath,
  isPartsPath,
  isPlanPath,
  isProgressPath,
  printersRoute,
  settingsRoute,
} from "../lib/routes";
import { cn } from "../lib/utils";
import { useProfileSelection } from "../context/ProfileContext";
import { CopilotUiProvider } from "../context/CopilotUiContext";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import { useKitManifestSaveRegistry } from "../context/KitManifestSaveContext";
import ThemePreferenceControl from "../components/ThemePreferenceControl";
import PlanPicker from "../components/PlanPicker";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../lib/persistedSidebarUi";
import { TooltipProvider } from "../components/ui/tooltip";
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

  useEffect(() => {
    const width = sidebarCollapsed ? "4.25rem" : "14rem";
    document.documentElement.style.setProperty("--app-sidebar-width", width);
  }, [sidebarCollapsed]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      document.documentElement.style.setProperty(
        "--mobile-stage-height",
        mq.matches ? "0px" : "3.25rem",
      );
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const onDismissUpdateBanner = () => {
    if (!updateCheck?.latest_version) return;
    dismissUpdateBanner(updateCheck.latest_version);
    setBannerDismissed(true);
  };

  useProfileUrlSync();
  const { selectedProfileId, profiles } = useProfileSelection();
  const { flushAll: flushImportRules } = useImportRulesSaveRegistry();
  const { flushAll: flushKitManifest } = useKitManifestSaveRegistry();
  const { stages, activeId } = useWorkflowStages();

  const onPipelineNavigate = (to: string, e: MouseEvent<HTMLAnchorElement>) => {
    const destPath = to.split("?")[0] ?? to;
    const leavingPlan = isPlanPath(location.pathname) && !isPlanPath(destPath);
    if (!leavingPlan) return;
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
      isPartsPath(location.pathname) ||
      isProgressPath(location.pathname));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!aiAssistantEnabled) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpenPersisted(!assistantOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiAssistantEnabled, assistantOpen]);

  useEffect(() => {
    const onOpen = () => setAssistantOpenPersisted(true);
    window.addEventListener("pp-open-assistant", onOpen);
    return () => window.removeEventListener("pp-open-assistant", onOpen);
  }, []);

  const secondaryMobile = [
    { to: printersRoute(), label: "Printers", icon: Printer },
    { to: settingsRoute(), label: "Settings", icon: Settings },
    { to: helpRoute(), label: "Help", icon: BookOpen },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <CopilotUiProvider>
        <div className="flex min-h-screen min-w-0 bg-background">
          <SpineRail
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            stages={stages}
            activeId={activeId}
            aiAssistantEnabled={aiAssistantEnabled}
            assistantOpen={assistantOpen}
            onAssistantOpenChange={setAssistantOpenPersisted}
            onStageNavigate={onPipelineNavigate}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <header
              className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 print:hidden"
              style={{ background: "var(--gradient-header)" }}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                {showPlanInHeader && activePlanName ? (
                  <span className="hidden truncate text-muted-foreground md:inline">
                    <span className="font-medium text-foreground">{activePlanName}</span>
                  </span>
                ) : null}
              </div>
              <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:justify-end">
                <SaveStatusIndicator />
                {aiAssistantEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 lg:hidden"
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
                {/* Mobile-only plan switcher + create — spine owns both on lg+ */}
                <CreatePlanButton className="lg:hidden" size="icon" showLabel={false} />
                <PlanPicker className="min-w-0 flex-1 sm:min-w-[200px] sm:max-w-xs lg:hidden" />
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
                    <DropdownMenuItem className="sm:hidden" onClick={() => openSponsor()}>
                      Sponsor on GitHub
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="sm:hidden" />
                    {secondaryMobile.map((item) => (
                      <DropdownMenuItem key={item.to} asChild>
                        <NavLink
                          to={item.to}
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

            <main
              className={cn(
                "flex-1 overflow-x-hidden overflow-y-auto p-3 pb-28 sm:p-5 sm:pb-24 lg:pb-20 print:overflow-visible print:p-0",
                assistantOpen && "lg:pr-[28rem]",
              )}
            >
              <ErrorBoundary key={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </main>

            <WorkflowProgress
              variant="mobile"
              stages={stages}
              activeId={activeId}
              onNavigate={onPipelineNavigate}
              className="fixed bottom-[var(--plan-tray-height,0px)] left-0 right-0 z-30 lg:hidden"
            />

            {updateCheck && (
              <UpdateAvailableBanner
                updateCheck={updateCheck}
                dismissed={bannerDismissed}
                onDismiss={onDismissUpdateBanner}
              />
            )}
          </div>

          <JobTray sidebarCollapsed={sidebarCollapsed} />
          <PlanTray />
          <CommandPalette onOpenAssistant={() => setAssistantOpenPersisted(true)} />
          <AssistantChatSheet open={assistantOpen} onOpenChange={setAssistantOpenPersisted} />
          <Toaster position="bottom-right" richColors closeButton />
        </div>
      </CopilotUiProvider>
    </TooltipProvider>
  );
}
