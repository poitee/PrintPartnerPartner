import { helpRoute, plansRoute, printersRoute, settingsRoute } from "./routes";

export type SpineUtilityId = "plans" | "printers" | "settings" | "help";

export type SpineUtilityNavItem = {
  id: SpineUtilityId;
  to: string;
  label: string;
  path: string;
};

/**
 * Spine / More utility rows: Plans · Printers · Settings · Help.
 * Stage-weight chrome below the desk-loop track — not WorkflowProgress, not a sixth step.
 */
export function spineUtilityNavItems(
  profileId?: number | null,
): SpineUtilityNavItem[] {
  return [
    { id: "plans", to: plansRoute(profileId), label: "Plans", path: "/plans" },
    { id: "printers", to: printersRoute(), label: "Printers", path: "/printers" },
    { id: "settings", to: settingsRoute(), label: "Settings", path: "/settings" },
    { id: "help", to: helpRoute(), label: "Help", path: "/help" },
  ];
}
