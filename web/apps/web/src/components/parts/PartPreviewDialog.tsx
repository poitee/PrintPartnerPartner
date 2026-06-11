import Preview3D from "../Preview3D";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

export type PreviewDialogPart = {
  id: number;
  filename: string;
  filament_hex?: string | null;
};

type Props = {
  part: PreviewDialogPart | null;
  onClose: () => void;
};

/**
 * Expanded 3D preview for a sheet thumbnail. Render ONE instance per
 * page/sheet (controlled by which part is selected) so at most one WebGL
 * renderer exists at a time; Preview3D disposes its renderer, controls,
 * geometry and material when the dialog content unmounts on close.
 */
export default function PartPreviewDialog({ part, onClose }: Props) {
  return (
    <Dialog
      open={part != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        {part && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all pr-8 text-base">{part.filename}</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Drag to rotate · scroll or pinch to zoom
            </p>
            <Preview3D partId={part.id} meshColor={part.filament_hex || undefined} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
