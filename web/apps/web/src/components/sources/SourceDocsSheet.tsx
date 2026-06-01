import { useEffect, useState } from "react";
import { fetchSourceDocMarkdown, fetchSourceDocs } from "../../api/engine";
import { ScrollArea } from "../ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

type Props = {
  sourceId: number;
  sourceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function SourceDocsSheet({
  sourceId,
  sourceName,
  open,
  onOpenChange,
}: Props) {
  const [docs, setDocs] = useState<Array<{ path: string; title: string }>>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setActiveDoc(null);
    setDocContent("");
    void (async () => {
      try {
        const docList = await fetchSourceDocs(sourceId);
        setDocs(docList);
        if (docList.length > 0) {
          const first = docList[0].path;
          setActiveDoc(first);
          const md = await fetchSourceDocMarkdown(sourceId, first);
          setDocContent(md);
        }
      } catch {
        setDocs([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, sourceId]);

  const loadDoc = async (path: string) => {
    setActiveDoc(path);
    try {
      const md = await fetchSourceDocMarkdown(sourceId, path);
      setDocContent(md);
    } catch {
      setDocContent("");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-xl flex-col">
        <SheetHeader>
          <SheetTitle className="truncate">{sourceName}</SheetTitle>
          <SheetDescription>README and docs from the synced repo</SheetDescription>
        </SheetHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading docs…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No markdown docs found. Sync the source and check for README.md or a docs/ folder.
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[140px_1fr]">
            <ScrollArea className="h-[min(60vh,420px)] rounded-md border border-border">
              <ul className="p-2 text-sm">
                {docs.map((d) => (
                  <li key={d.path}>
                    <button
                      type="button"
                      className={`w-full rounded px-2 py-1 text-left hover:bg-accent ${activeDoc === d.path ? "bg-accent" : ""}`}
                      onClick={() => void loadDoc(d.path)}
                    >
                      {d.title}
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <ScrollArea className="h-[min(60vh,420px)] rounded-md border border-border">
              <pre className="whitespace-pre-wrap p-3 text-xs">{docContent || "Select a document."}</pre>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
