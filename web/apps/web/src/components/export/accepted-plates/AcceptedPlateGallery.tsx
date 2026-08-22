import { useEffect, useState } from "react";
import type { AcceptedPlateWorkspace } from "@print-partner/contracts";
import { Button } from "../../ui/button";
import AcceptedPlateBed from "./AcceptedPlateBed";

type ReadyWorkspace = Extract<AcceptedPlateWorkspace, { kind: "ready" }>;

type Props = Readonly<{
  workspace: ReadyWorkspace;
  disabled: boolean;
  onMove: (plateId: string, token: string, xUm: number, yUm: number) => Promise<boolean | undefined>;
  onPin: (plateId: string, token: string, pinned: boolean) => Promise<void>;
  onUnplace: (plateId: string, token: string) => Promise<void>;
  onArrange: (mode: "unplaced" | "all") => Promise<void>;
  onUndoArrangeAll?: () => Promise<void>;
  onStaleMove: () => Promise<void>;
}>;

export default function AcceptedPlateGallery({
  workspace,
  disabled,
  onMove,
  onPin,
  onUnplace,
  onArrange,
  onUndoArrangeAll,
  onStaleMove,
}: Props) {
  const [selectedPlateId, setSelectedPlateId] = useState<string>(workspace.plates[0]?.plate_id ?? "");
  useEffect(() => {
    if (!workspace.plates.some((plate) => plate.plate_id === selectedPlateId)) {
      setSelectedPlateId(workspace.plates[0]?.plate_id ?? "");
    }
  }, [selectedPlateId, workspace.plates]);
  const plate = workspace.plates.find((candidate) => candidate.plate_id === selectedPlateId)
    ?? workspace.plates[0];
  if (!plate) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Plates">
        {workspace.plates.map((candidate) => (
          <Button
            key={candidate.plate_id}
            size="sm"
            variant={candidate.plate_id === plate.plate_id ? "default" : "outline"}
            role="tab"
            aria-selected={candidate.plate_id === plate.plate_id}
            disabled={disabled}
            className="shrink-0"
            onClick={() => setSelectedPlateId(candidate.plate_id)}
          >
            Plate {candidate.ordinal} · {candidate.printer.name}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void onArrange("unplaced")}
        >
          Arrange unplaced
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void onArrange("all")}
        >
          Arrange all
        </Button>
        {onUndoArrangeAll ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void onUndoArrangeAll()}>
            Undo Arrange all
          </Button>
        ) : null}
      </div>
      <AcceptedPlateBed
        key={plate.plate_id}
        plate={plate}
        revisionId={workspace.plate_revision_id}
        disabled={disabled}
        onMove={onMove}
        onPin={onPin}
        onUnplace={onUnplace}
        onStaleMove={onStaleMove}
      />
      {workspace.unplaced.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Unplaced</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {workspace.unplaced.map((unit) => (
              <li key={unit.token} className="truncate font-mono text-[11px]">
                {unit.object_name}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Arrange unplaced packs these names around pinned and manual placements.
          </p>
        </div>
      ) : null}
    </div>
  );
}
