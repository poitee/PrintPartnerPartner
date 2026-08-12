import { type MouseEvent, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BookOpen,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
} from "lucide-react";
import PlanPicker from "../PlanPicker";
import SupportCta from "../SupportCta";
import ThemePreferenceControl from "../ThemePreferenceControl";
import WorkflowProgress from "../WorkflowProgress";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  buildsRoute,
  helpRoute,
  isBuildsPath,
  settingsRoute,
} from "../../lib/routes";
import { cn } from "../../lib/utils";
import type { WorkflowStage, WorkflowStageId } from "../../lib/workflowStages";

type Props = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  stages: WorkflowStage[];
  activeId: WorkflowStageId | null;
  selectedProfileId: number | null;
  aiAssistantEnabled: boolean;
  assistantOpen: boolean;
  onAssistantOpenChange: (open: boolean) => void;
  onStageNavigate: (to: string, e: MouseEvent<HTMLAnchorElement>) => void;
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

/** Left spine rail: plan picker, workflow stages (incl. Export), assistant + Settings/Help. */
export default function SpineRail({
  collapsed,
  onToggleCollapsed,
  stages,
  activeId,
  selectedProfileId,
  aiAssistantEnabled,
  assistantOpen,
  onAssistantOpenChange,
  onStageNavigate,
}: Props) {
  const location = useLocation();

  const footerLinks = [
    {
      to: settingsRoute(),
      label: "Settings",
      icon: Settings,
      match: location.pathname === "/settings",
    },
    {
      to: helpRoute(),
      label: "Help",
      icon: BookOpen,
      match: location.pathname === "/help",
    },
  ];

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out lg:flex print:hidden",
        collapsed ? "w-[4.25rem]" : "w-56",
      )}
    >
      <div className={cn("border-b border-border", collapsed ? "px-2 py-3" : "px-4 py-4")}>
        <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
          <BrandMark />
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">Print Partner</h1>
              <p className="text-xs text-muted-foreground">Library → Plan → Parts → Progress → Export</p>
            </div>
          )}
        </div>
      </div>

      <div className={cn("flex flex-1 flex-col gap-3 overflow-y-auto", collapsed ? "p-2" : "p-3")}>
        {!collapsed ? (
          <div className="rounded-md border border-border bg-muted/30 p-2">
            <PlanPicker className="w-full" />
          </div>
        ) : (
          <SidebarTooltip label="Switch plan" collapsed>
            <div className="flex justify-center py-1" aria-hidden>
              <Layers className="h-4 w-4 text-muted-foreground" />
            </div>
          </SidebarTooltip>
        )}

        <WorkflowProgress
          stages={stages}
          activeId={activeId}
          collapsed={collapsed}
          onNavigate={onStageNavigate}
        />

        <Separator className={cn(collapsed && "mx-1")} />

        <SidebarTooltip label="Builds" collapsed={collapsed}>
          <NavLink
            to={buildsRoute(selectedProfileId)}
            className={cn(
              "flex items-center gap-2 rounded-md text-sm font-medium transition-colors",
              collapsed ? "justify-center p-2.5" : "px-3 py-2",
              isBuildsPath(location.pathname)
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
            )}
            aria-label={collapsed ? "Builds" : undefined}
          >
            <Layers className="h-4 w-4 shrink-0" />
            {!collapsed && "Builds"}
          </NavLink>
        </SidebarTooltip>
      </div>

      <div className={cn("mt-auto space-y-2 border-t border-border", collapsed ? "p-2" : "p-3")}>
        {aiAssistantEnabled && (
          <SidebarTooltip label="Ask assistant" collapsed={collapsed}>
            <Button
              type="button"
              variant="outline"
              size={collapsed ? "icon" : "sm"}
              className={cn("w-full", !collapsed && "justify-start gap-2")}
              onClick={() => onAssistantOpenChange(!assistantOpen)}
              aria-pressed={assistantOpen}
              aria-label="Ask assistant"
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Ask assistant</span>
                  <kbd className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
                    ⌘J
                  </kbd>
                </>
              )}
            </Button>
          </SidebarTooltip>
        )}

        {!collapsed && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-1.5 text-xs text-muted-foreground">
            {footerLinks.map((link) => (
              <NavLink
                key={link.label}
                to={link.to}
                className={cn(
                  "font-medium transition-colors hover:text-foreground",
                  link.match && "text-primary",
                )}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        )}

        {collapsed &&
          footerLinks.map((link) => (
            <SidebarTooltip key={link.label} label={link.label} collapsed>
              <NavLink
                to={link.to}
                className={cn(
                  "flex items-center justify-center rounded-md p-2.5 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground",
                  link.match && "bg-primary/12 text-primary",
                )}
                aria-label={link.label}
              >
                <link.icon className="h-4 w-4" />
              </NavLink>
            </SidebarTooltip>
          ))}

        {!collapsed && (
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
          size={collapsed ? "icon" : "sm"}
          className={cn("text-muted-foreground", !collapsed && "w-full justify-start")}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
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
  );
}
