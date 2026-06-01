import SourceCategoryManager from "./SourceCategoryManager";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engineReady: boolean;
  onCategoriesChanged?: (categories: string[]) => void;
};

export default function SourceCategorySheet({
  open,
  onOpenChange,
  engineReady,
  onCategoriesChanged,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-lg flex-col overflow-y-auto p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle>Manage source categories</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <SourceCategoryManager
            engineReady={engineReady}
            onSaved={onCategoriesChanged}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
