import { cn } from "../../lib/utils";

type Props = {
  warnings: string[];
  onAskAssistant?: () => void;
  className?: string;
};

/** Non-blocking Plan warnings panel — loud but passable (mock density). */
export default function PlanWarningsCard({ warnings, onAskAssistant, className }: Props) {
  if (warnings.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-amber-300/80 bg-amber-50 p-3.5 dark:border-amber-700/50 dark:bg-amber-950/35",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 shrink-0 rotate-45 bg-amber-700 dark:bg-amber-400"
          aria-hidden
        />
        <span className="text-[12.5px] font-semibold text-amber-950 dark:text-amber-100">
          {warnings.length} thing{warnings.length === 1 ? "" : "s"} worth a look
        </span>
        {onAskAssistant ? (
          <button
            type="button"
            className="ml-auto text-[11px] font-semibold text-amber-800 hover:underline dark:text-amber-300"
            onClick={onAskAssistant}
          >
            Ask assistant
          </button>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {warnings.map((line) => (
          <li
            key={line}
            className="flex items-baseline gap-1.5 text-xs leading-snug text-amber-950/90 dark:text-amber-100/90"
          >
            <span
              className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-amber-700 dark:bg-amber-400"
              aria-hidden
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-[11.5px] text-amber-900/70 dark:text-amber-200/70">
        Nothing is blocked — you can build and export as is.
      </p>
    </div>
  );
}
