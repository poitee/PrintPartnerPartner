import { cn } from "../../lib/utils";

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "base" | "addon" | "muted";
};

export function Badge({ className, variant = "default", ...props }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "default" && "bg-primary/25 text-primary border border-primary/30",
        variant === "base" && "bg-success/20 text-success border border-success/25",
        variant === "addon" && "bg-warning/20 text-warning border border-warning/25",
        variant === "muted" &&
          "border border-border bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
