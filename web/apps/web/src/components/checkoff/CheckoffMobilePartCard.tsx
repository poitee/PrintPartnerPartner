import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import type { ReviewPart } from "../../api/engine";
import {
  lastCompletedUnit,
  nextUnitToComplete,
} from "../../lib/checkoffProgress";
import ProgressPartRow from "./ProgressPartRow";

type Props = {
  part: ReviewPart;
  busy: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
  onPreview: (part: ReviewPart) => void;
  dragHandle?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
    disabled?: boolean;
  };
};

/** Phone-first Progress row (shop floor). Matches Workflow mock density. */
export default function CheckoffMobilePartCard({
  part,
  busy,
  onToggleUnit,
  onPreview,
  dragHandle,
}: Props) {
  return (
    <ProgressPartRow
      part={part}
      busy={busy}
      compact
      dragHandle={dragHandle}
      onIncrement={(p) => {
        const idx = nextUnitToComplete(p.print_units);
        if (idx >= 0) onToggleUnit(p, idx);
      }}
      onDecrement={(p) => {
        const idx = lastCompletedUnit(p.print_units);
        if (idx >= 0) onToggleUnit(p, idx);
      }}
      onPreview={onPreview}
    />
  );
}
