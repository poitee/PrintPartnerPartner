import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type Props = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({ title, description, actions, className }: Props) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 pb-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
