import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_STL_NAMING_PROFILE,
  fetchImportRules,
  fetchSourceDocMarkdown,
  fetchSourceDocs,
  fetchSourceNotes,
  fetchSourceNaming,
  fetchStlNaming,
  mergeStlNamingProfiles,
  saveImportRules,
  saveSourceNaming,
  type SourceNote,
  type SourceSummary,
  type StlNamingProfile,
} from "../../api/engine";
import { StlNamingEditorEmbedded } from "../settings/StlNamingEditor";
import ImportRulesTree from "../ImportRulesTree";
import Preview3D from "../Preview3D";
import SourceCardCover from "../SourceCardCover";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

type DetailTab = "docs" | "rules" | "naming";
type DocsSubTab = "synced" | "notes";

type Props = {
  source: SourceSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: DetailTab;
  highlightPath?: string | null;
  /** Optional keyword filter for Synced docs / Advisor notes lists (from copilot ui_open_docs). */
  docsQuery?: string | null;
  busy?: boolean;
  onEdit: (source: SourceSummary) => void;
  onDelete: (source: SourceSummary) => void;
  onSaveRules: () => void;
  runImportScan: (sourceId: number) => void;
};

function isEngineNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("404");
}

export default function SourceDetailSheet({
  source,
  open,
  onOpenChange,
  initialTab = "docs",
  highlightPath = null,
  docsQuery = null,
  busy = false,
  onEdit,
  onDelete,
  onSaveRules,
  runImportScan,
}: Props) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [docsSubTab, setDocsSubTab] = useState<DocsSubTab>("synced");
  const [docs, setDocs] = useState<
    Array<{ path: string; title: string; kind?: string; extract_status?: string }>
  >([]);
  const [notes, setNotes] = useState<SourceNote[]>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState("");
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [pendingRules, setPendingRules] = useState<string[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const [globalNaming, setGlobalNaming] = useState<StlNamingProfile>(DEFAULT_STL_NAMING_PROFILE);
  const [useDefaults, setUseDefaults] = useState(true);
  const [overrideDraft, setOverrideDraft] = useState<StlNamingProfile>(DEFAULT_STL_NAMING_PROFILE);
  const [savedUseDefaults, setSavedUseDefaults] = useState(true);
  const [savedOverride, setSavedOverride] = useState<Partial<StlNamingProfile>>({});
  const [namingLoadError, setNamingLoadError] = useState<string | null>(null);
  const [namingApiMissing, setNamingApiMissing] = useState(false);
  const [namingSaving, setNamingSaving] = useState(false);
  const [namingNote, setNamingNote] = useState<string | null>(null);

  const previewProfile = useMemo(
    () => (useDefaults ? globalNaming : overrideDraft),
    [useDefaults, globalNaming, overrideDraft],
  );

  const namingDirty =
    useDefaults !== savedUseDefaults ||
    (!useDefaults &&
      JSON.stringify(overrideDraft) !==
        JSON.stringify(mergeStlNamingProfiles(globalNaming, savedOverride)));

  const loadNaming = useCallback(async (sourceId: number) => {
    setNamingLoadError(null);
    setNamingApiMissing(false);
    setNamingNote(null);
    try {
      const [global, sourceNaming] = await Promise.all([
        fetchStlNaming(),
        fetchSourceNaming(sourceId),
      ]);
      setGlobalNaming(global);
      setUseDefaults(sourceNaming.use_defaults);
      setSavedUseDefaults(sourceNaming.use_defaults);
      setSavedOverride(sourceNaming.override);
      setOverrideDraft(mergeStlNamingProfiles(global, sourceNaming.override));
    } catch (e) {
      if (isEngineNotFoundError(e)) {
        setNamingApiMissing(true);
        setNamingLoadError("Unable to load naming overrides — this feature isn't available right now.");
      } else {
        setNamingLoadError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    if (!open || !source) return;
    setTab(initialTab);
    setDocsSubTab("synced");
    setSelectedFilePath(highlightPath);
    setScanResult(null);
    setActiveDoc(null);
    setDocContent("");
    setActiveNoteId(null);
    setNotes([]);
    void (async () => {
      try {
        const [docList, noteList] = await Promise.all([
          fetchSourceDocs(source.id),
          fetchSourceNotes(source.id),
        ]);
        setDocs(docList);
        setNotes(noteList);
        if (docList.length > 0) {
          const first = docList[0].path;
          setActiveDoc(first);
          const md = await fetchSourceDocMarkdown(source.id, first);
          setDocContent(md);
        } else if (noteList.length > 0) {
          setDocsSubTab("notes");
          setActiveNoteId(noteList[0].id);
        }
      } catch {
        setDocs([]);
        setNotes([]);
      }
      if (initialTab === "rules" || highlightPath) {
        try {
          const data = await fetchImportRules(source.id);
          setPendingRules(data.rules);
        } catch {
          setPendingRules([]);
        }
      }
      if (initialTab === "naming") {
        await loadNaming(source.id);
      }
    })();
  }, [open, source, initialTab, highlightPath, loadNaming]);

  const loadDoc = async (path: string) => {
    if (!source) return;
    setActiveDoc(path);
    try {
      const md = await fetchSourceDocMarkdown(source.id, path);
      setDocContent(md);
    } catch {
      setDocContent("");
    }
  };

  const onTabChange = async (value: string) => {
    const next = value as DetailTab;
    setTab(next);
    if (!source) return;
    if (next === "rules") {
      const data = await fetchImportRules(source.id);
      setPendingRules(data.rules);
    }
    if (next === "naming") {
      await loadNaming(source.id);
    }
  };

  const saveRules = async () => {
    if (!source) return;
    try {
      await saveImportRules(source.id, pendingRules);
      runImportScan(source.id);
      onSaveRules();
      setScanResult("Rules saved — import scan started.");
    } catch (e) {
      setScanResult(e instanceof Error ? e.message : String(e));
    }
  };

  const saveNaming = async () => {
    if (!source) return;
    setNamingSaving(true);
    setNamingLoadError(null);
    setNamingNote(null);
    try {
      const overridePayload = useDefaults
        ? {}
        : {
            roles: overrideDraft.roles,
            quantity: overrideDraft.quantity,
            slug: overrideDraft.slug,
            folder_rules: overrideDraft.folder_rules,
            export_role_order: overrideDraft.export_role_order,
          };
      const saved = await saveSourceNaming(source.id, {
        use_defaults: useDefaults,
        override: overridePayload,
      });
      setSavedUseDefaults(saved.use_defaults);
      setSavedOverride(saved.override);
      setOverrideDraft(mergeStlNamingProfiles(globalNaming, saved.override));
      setNamingNote("Naming rules saved.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNamingLoadError(msg);
      toast.error(msg);
    } finally {
      setNamingSaving(false);
    }
  };

  if (!source) return null;

  const queryNorm = (docsQuery ?? "").trim().toLowerCase();
  const filteredDocs = queryNorm
    ? docs.filter(
        (d) =>
          d.title.toLowerCase().includes(queryNorm) ||
          d.path.toLowerCase().includes(queryNorm),
      )
    : docs;
  const filteredNotes = queryNorm
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(queryNorm) ||
          n.body_markdown.toLowerCase().includes(queryNorm),
      )
    : notes;
  const activeNote = filteredNotes.find((n) => n.id === activeNoteId) ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        showOverlay={false}
        className="flex w-full max-w-2xl flex-col p-0"
        onInteractOutside={(e) => {
          // Keep docked; nav/Build stay clickable without Escape.
          e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
      >
        <SheetHeader className="relative border-b p-4 pr-12">
          <SheetClose
            type="button"
            className="absolute right-3 top-3 rounded-sm p-1.5 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close source details"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
          <div className="flex items-start gap-3">
            <SourceCardCover
              sourceId={source.id}
              name={source.name}
              sourceKind={source.source_kind}
              compact
            />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">{source.name}</SheetTitle>
              <p className="truncate text-xs text-muted-foreground">{source.url}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="secondary" onClick={() => onEdit(source)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(source)}>
                Delete
              </Button>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => void onTabChange(v)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-2 w-fit">
            <TabsTrigger value="docs">Docs</TabsTrigger>
            <TabsTrigger value="rules">Import files</TabsTrigger>
            <TabsTrigger value="naming">Naming</TabsTrigger>
          </TabsList>

          <TabsContent value="docs" className="mt-0 min-h-0 flex-1 overflow-hidden px-4 pb-4">
            <Tabs
              value={docsSubTab}
              onValueChange={(v) => setDocsSubTab(v as DocsSubTab)}
              className="flex h-[min(60vh,480px)] flex-col gap-2"
            >
              <TabsList className="w-fit">
                <TabsTrigger value="synced">
                  Synced docs{filteredDocs.length > 0 ? ` (${filteredDocs.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="notes">
                  Advisor notes{filteredNotes.length > 0 ? ` (${filteredNotes.length})` : ""}
                </TabsTrigger>
              </TabsList>
              {queryNorm ? (
                <p className="text-xs text-muted-foreground">Filtering docs by “{docsQuery}”</p>
              ) : null}
              <TabsContent value="synced" className="mt-0 min-h-0 flex-1 overflow-hidden">
                {docs.length === 0 ? (
                  <div className="space-y-2 rounded-md border border-border p-4 text-sm text-muted-foreground">
                    <p>
                      Sync this source to pull README/PDFs from the repository into Synced docs.
                    </p>
                    {notes.length > 0 ? (
                      <p>
                        {notes.length} Advisor note{notes.length === 1 ? "" : "s"} available — open
                        the Advisor notes tab. Empty Synced docs does not mean import failed.
                      </p>
                    ) : !source.last_synced_at ? (
                      <p>This source has not been synced yet.</p>
                    ) : (
                      <p>No markdown or PDF docs found in the synced tree.</p>
                    )}
                  </div>
                ) : filteredDocs.length === 0 ? (
                  <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                    No synced docs match “{docsQuery}”.
                  </p>
                ) : (
                  <div className="grid h-full gap-4 md:grid-cols-[160px_1fr]">
                    <ScrollArea className="h-full rounded-md border border-border">
                      <ul className="p-2 text-sm">
                        {filteredDocs.map((d) => (
                          <li key={d.path}>
                            <button
                              type="button"
                              className={`w-full rounded px-2 py-1 text-left hover:bg-accent ${activeDoc === d.path ? "bg-accent" : ""}`}
                              onClick={() => void loadDoc(d.path)}
                            >
                              {d.title}
                              {d.kind === "pdf" &&
                              d.extract_status &&
                              d.extract_status !== "ready" ? (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                  PDF · {d.extract_status}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                    <ScrollArea className="h-full rounded-md border border-border">
                      <pre className="whitespace-pre-wrap p-3 text-xs">
                        {docContent || "Select a document."}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="notes" className="mt-0 min-h-0 flex-1 overflow-hidden">
                {notes.length === 0 ? (
                  <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                    No Advisor notes yet. Import a domain research pack (workflow / pitfalls /
                    quotes) or add notes from the kit advisor.
                  </p>
                ) : filteredNotes.length === 0 ? (
                  <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                    No Advisor notes match “{docsQuery}”.
                  </p>
                ) : (
                  <div className="grid h-full gap-4 md:grid-cols-[160px_1fr]">
                    <ScrollArea className="h-full rounded-md border border-border">
                      <ul className="p-2 text-sm">
                        {filteredNotes.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              className={`w-full rounded px-2 py-1 text-left hover:bg-accent ${activeNoteId === n.id ? "bg-accent" : ""}`}
                              onClick={() => setActiveNoteId(n.id)}
                            >
                              {n.title || "Note"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                    <ScrollArea className="h-full rounded-md border border-border">
                      <pre className="whitespace-pre-wrap p-3 text-xs">
                        {activeNote?.body_markdown || "Select a note."}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent
            value="rules"
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4"
          >
            {selectedFilePath && (
              <div className="h-40 shrink-0 overflow-hidden rounded-md border border-border">
                <Preview3D
                  partId={null}
                  sourceId={source.id}
                  relativePath={selectedFilePath}
                  preferSource
                  filename={selectedFilePath.split("/").pop() ?? selectedFilePath}
                  className="h-full w-full"
                />
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
              <div className="p-3">
                <ImportRulesTree
                  projectId={source.id}
                  disabled={busy}
                  onRulesChange={setPendingRules}
                  selectedFilePath={selectedFilePath}
                  onFileSelect={setSelectedFilePath}
                />
              </div>
            </ScrollArea>
            {scanResult && <p className="text-sm text-muted-foreground">{scanResult}</p>}
            <Button onClick={() => void saveRules()} disabled={busy}>
              Save rules
            </Button>
          </TabsContent>

          <TabsContent
            value="naming"
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4"
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 py-1">
                <p className="text-sm text-muted-foreground">
                  Override how STL paths are parsed for this source. Changes apply on the next{" "}
                  <strong>Update build</strong> for plans using this source.
                </p>
                {namingLoadError && <p className="text-sm text-destructive">{namingLoadError}</p>}
                {namingNote && <p className="text-sm text-muted-foreground">{namingNote}</p>}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useDefaults}
                    disabled={namingApiMissing || namingSaving || busy}
                    onChange={(e) => setUseDefaults(e.target.checked)}
                  />
                  <span>Use app default naming rules</span>
                </label>
                {!useDefaults && (
                  <div>
                    <Label className="mb-2 block text-sm">Source override</Label>
                    <StlNamingEditorEmbedded
                      profile={overrideDraft}
                      onChange={setOverrideDraft}
                      previewProfile={previewProfile}
                      compact
                      disabled={namingApiMissing || namingSaving || busy}
                    />
                  </div>
                )}
                {useDefaults && (
                  <p className="text-sm text-muted-foreground">
                    Using global rules from Settings → STL naming rules.
                  </p>
                )}
              </div>
            </ScrollArea>
            <Button
              onClick={() => void saveNaming()}
              disabled={busy || namingSaving || namingApiMissing || !namingDirty}
            >
              {namingSaving ? "Saving…" : "Save naming"}
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
