import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
  /** `sm` for inline panels; default is page-level empty state */
  size?: "default" | "sm";
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "default",
}: Props) {
  const compact = size === "sm";
  return (
    <section
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-center",
        compact ? "px-4 py-8" : "px-6 py-12",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full border border-accent-brand/15 bg-accent-brand/10 text-accent-brand",
          compact ? "mb-2 h-12 w-12" : "mb-3 h-14 w-14",
        )}
        aria-hidden
      >
        <Icon className={cn(compact ? "h-5 w-5" : "h-6 w-6")} />
      </span>
      <h3 className={cn("font-medium text-foreground", compact ? "text-sm" : "text-base")}>
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action && (
        <Button className="mt-4" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </section>
  );
}
