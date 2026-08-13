import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReviewPart } from "../../api/engine";
import { SortableShell } from "../dnd/SortableDragHandle";
import CheckoffMobilePartCard from "./CheckoffMobilePartCard";
import ProgressPartRow from "./ProgressPartRow";

type Props = {
  part: ReviewPart;
  busy: boolean;
  mobile: boolean;
  disabled?: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
  onIncrement: (part: ReviewPart) => void;
  onDecrement: (part: ReviewPart) => void;
  onPreview: (part: ReviewPart) => void;
};

export default function SortableProgressPart({
  part,
  busy,
  mobile,
  disabled,
  onToggleUnit,
  onIncrement,
  onDecrement,
  onPreview,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: part.id, disabled: disabled || busy });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandle = {
    attributes,
    listeners,
    disabled: disabled || busy,
  };

  return (
    <SortableShell
      style={style}
      isDragging={isDragging}
      className="rounded-[10px]"
    >
      <div ref={setNodeRef}>
        {mobile ? (
          <CheckoffMobilePartCard
            part={part}
            busy={busy}
            onToggleUnit={onToggleUnit}
            onPreview={onPreview}
            dragHandle={dragHandle}
          />
        ) : (
          <ProgressPartRow
            part={part}
            busy={busy}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
            onPreview={onPreview}
            dragHandle={dragHandle}
          />
        )}
      </div>
    </SortableShell>
  );
}
