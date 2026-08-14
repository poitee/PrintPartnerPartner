import { type MouseEvent, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BookOpen,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Settings,
} from "lucide-react";
import CreatePlanButton from "../CreatePlanButton";
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
  spineUtilityNavItems,
  type SpineUtilityId,
} from "../../lib/spineUtilityNav";
import { cn } from "../../lib/utils";
import type { WorkflowStage, WorkflowStageId } from "../../lib/workflowStages";
import { useProfileSelection } from "../../context/ProfileContext";

type Props = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  stages: WorkflowStage[];
  activeId: WorkflowStageId | null;
  onStageNavigate: (to: string, e: MouseEvent<HTMLAnchorElement>) => void;
};

const UTILITY_ICONS: Record<
  SpineUtilityId,
  typeof Layers
> = {
  plans: Layers,
  printers: Printer,
  settings: Settings,
  help: BookOpen,
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

/** Left spine rail: plan picker, workflow stages (incl. Export), Settings/Help. */
export default function SpineRail({
  collapsed,
  onToggleCollapsed,
  stages,
  activeId,
  onStageNavigate,
}: Props) {
  const location = useLocation();
  const { selectedProfileId } = useProfileSelection();
  const footerLinks = spineUtilityNavItems(selectedProfileId).map((item) => ({
    ...item,
    icon: UTILITY_ICONS[item.id],
    match: location.pathname === item.path,
  }));

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
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
            <PlanPicker className="w-full" />
            <CreatePlanButton className="w-full" variant="outline" size="sm" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <SidebarTooltip label="Switch plan" collapsed>
              <div className="mx-auto">
                <PlanPicker compact className="mx-auto" />
              </div>
            </SidebarTooltip>
            <SidebarTooltip label="Create plan" collapsed>
              <CreatePlanButton size="icon" showLabel={false} variant="ghost" className="mx-auto" />
            </SidebarTooltip>
          </div>
        )}

        <WorkflowProgress
          stages={stages}
          activeId={activeId}
          collapsed={collapsed}
          onNavigate={onStageNavigate}
        />

        <Separator className={cn(collapsed && "mx-1")} />
      </div>

      <div className={cn("mt-auto space-y-2 border-t border-border", collapsed ? "p-2" : "p-3")}>
        {!collapsed && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-1.5 text-xs text-muted-foreground">
            {footerLinks.map((link) => (
              <NavLink
                key={link.label}
                to={link.to}
                onClick={(e) => onStageNavigate(link.to, e)}
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
                onClick={(e) => onStageNavigate(link.to, e)}
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
