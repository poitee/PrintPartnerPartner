import { Link } from "react-router-dom";
import RoleFilamentPicker from "../RoleFilamentPicker";
import type { RoleFilamentRow } from "../../api/engine";
import { DEFAULT_STL_NAMING_PROFILE } from "../../api/engine";
import { settingsRoute } from "../../lib/routes";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  profileId: number;
  disabled?: boolean;
  refreshKey?: number;
  onRolesChange?: (rows: RoleFilamentRow[]) => void;
  onUpdated?: () => void | Promise<void>;
  className?: string;
};

/** Compact filament-roles card matching Plan mock density. */
export default function PlanRolesCard({
  profileId,
  disabled,
  refreshKey,
  onRolesChange,
  onUpdated,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3.5",
        className,
      )}
    >
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Filament roles
      </span>
      <RoleFilamentPicker
        profileId={profileId}
        disabled={disabled}
        refreshKey={refreshKey}
        onRolesChange={onRolesChange}
        onUpdated={onUpdated}
        density="compact"
      />
      <p className="text-[11px] text-muted-foreground">
        Roles come from STL filenames and folder rules
        {DEFAULT_STL_NAMING_PROFILE.roles.some((r) => r.markers.length > 0)
          ? ` (e.g. ${DEFAULT_STL_NAMING_PROFILE.roles
              .filter((r) => r.markers.length > 0)
              .slice(0, 2)
              .map((r) => `${r.markers.join(", ")} → ${r.label}`)
              .join("; ")})`
          : ""}
        .{" "}
        <Button variant="link" className="h-auto p-0 text-[11px]" asChild>
          <Link to={`${settingsRoute()}#stl-naming`}>Customize in Settings</Link>
        </Button>
      </p>
    </div>
  );
}
