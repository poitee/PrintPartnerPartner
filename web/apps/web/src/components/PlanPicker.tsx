import { useProfileSelection } from "../context/ProfileContext";

type Props = {
  disabled?: boolean;
  className?: string;
};

/** Compact plan selector — hoisted in AppLayout header for workflow pages. */
export default function PlanPicker({ disabled, className }: Props) {
  const { profiles, selectedProfileId, setSelectedProfileId, loading } =
    useProfileSelection();

  return (
    <label className={className ?? "flex min-w-[180px] items-center gap-2 text-sm"}>
      <span className="shrink-0 text-xs text-muted-foreground">Plan</span>
      <select
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={selectedProfileId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          setSelectedProfileId(v === "" ? null : Number(v));
        }}
        disabled={disabled || loading || profiles.length === 0}
        aria-label="Select plan"
      >
        {profiles.length === 0 ? (
          <option value="">No plans yet</option>
        ) : (
          profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.part_count} parts)
            </option>
          ))
        )}
      </select>
    </label>
  );
}
