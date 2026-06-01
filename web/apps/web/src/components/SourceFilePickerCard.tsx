import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import ImportRulesTree from "./ImportRulesTree";
import Preview3D from "./Preview3D";
import SourceDocsSheet from "./sources/SourceDocsSheet";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { fetchStlTree, type SourceSummary } from "../api/engine";
import { useImportRulesAutosave } from "../hooks/useImportRulesAutosave";
import { useImportRulesSaveRegistry } from "../context/ImportRulesSaveContext";
import {
  importRulesSaveStatusLabel,
  shouldShowImportRulesRetry,
} from "../lib/importRulesSave";
import { cn } from "../lib/utils";

type Props = {
  sourceId: number;
  sourceName: string;
  layerType: "base" | "addon";
  source?: SourceSummary | null;
  allSources?: SourceSummary[];
  disabled?: boolean;
  defaultExpanded?: boolean;
  onChangeSource?: (projectId: number) => void;
  onRemove?: () => void;
  /** Shown inside expanded card (e.g. kit manifest variants for base layer). */
  expandedExtra?: ReactNode;
};

function syncLabel(source: SourceSummary | null | undefined): string {
  if (!source?.last_synced_at) return "Not synced";
  try {
    return `Synced ${new Date(source.last_synced_at).toLocaleString()}`;
  } catch {
    return "Synced";
  }
}

export default function SourceFilePickerCard({
  sourceId,
  sourceName,
  layerType,
  source,
  allSources,
  disabled = false,
  defaultExpanded = false,
  onChangeSource,
  onRemove,
  expandedExtra,
}: Props) {
  const expandedKey = `pp-build-source-${sourceId}-expanded`;
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = sessionStorage.getItem(expandedKey);
      if (stored === "0" || stored === "1") return stored === "1";
    } catch {
      /* ignore */
    }
    return defaultExpanded;
  });
  const [savedRules, setSavedRules] = useState<string[]>([]);
  const [pendingRules, setPendingRules] = useState<string[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [userEditedRules, setUserEditedRules] = useState(false);
  const userEditedRulesRef = useRef(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [docsOpen, setDocsOpen] = useState(false);

  const onSaved = useCallback(
    (rules: string[]) => {
      setSavedRules(rules);
      setPendingRules(rules);
      setUserEditedRules(false);
      userEditedRulesRef.current = false;
    },
    [],
  );

  const loadSelectionSummary = useCallback(async () => {
    if (!source?.local_path) return;
    try {
      const tree = await fetchStlTree(sourceId);
      setSelectedCount(tree.selected);
      setTotalFiles(tree.total);
    } catch {
      /* tree unavailable until sync */
    }
  }, [source?.local_path, sourceId]);

  const onSavedWithRefresh = useCallback(
    (rules: string[]) => {
      onSaved(rules);
      void loadSelectionSummary();
    },
    [loadSelectionSummary, onSaved],
  );

  const { registerFlush, unregisterFlush } = useImportRulesSaveRegistry();

  const { dirty, status, saveNow, saveUserEdit } = useImportRulesAutosave({
    sourceId,
    pendingRules,
    savedRules,
    rulesLoaded,
    userEdited: userEditedRules,
    disabled,
    onSaved: onSavedWithRefresh,
    onRegisterFlush: registerFlush,
    onUnregisterFlush: unregisterFlush,
  });

  const onPendingRulesChange = useCallback(
    (rules: string[], opts?: { userInitiated?: boolean }) => {
      if (opts?.userInitiated) {
        setPendingRules(rules);
        setUserEditedRules(true);
        userEditedRulesRef.current = true;
        saveUserEdit(rules);
        return;
      }
      // STL tree load — only sync baseline before the user has edited (avoids clobbering in-flight saves).
      if (!userEditedRulesRef.current) {
        setPendingRules(rules);
        setSavedRules(rules);
        setRulesLoaded(true);
      }
    },
    [saveUserEdit],
  );

  const saveStatusLabel = importRulesSaveStatusLabel(status);
  const showRetry = shouldShowImportRulesRetry(status);

  useEffect(() => {
    userEditedRulesRef.current = false;
    setRulesLoaded(false);
    setUserEditedRules(false);
    setPendingRules([]);
    setSavedRules([]);
    setSelectedCount(0);
    setTotalFiles(0);
  }, [sourceId]);

  useEffect(() => {
    void loadSelectionSummary();
  }, [loadSelectionSummary]);

  useEffect(() => {
    if (!expanded) setSelectedFilePath(null);
  }, [expanded]);

  useEffect(() => {
    try {
      sessionStorage.setItem(expandedKey, expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [expanded, expandedKey]);

  const previewFilename = useMemo(() => {
    if (!selectedFilePath) return undefined;
    const parts = selectedFilePath.split("/");
    return parts[parts.length - 1] || selectedFilePath;
  }, [selectedFilePath]);

  const selectionLabel =
    totalFiles > 0 ? `${selectedCount} of ${totalFiles} STL file(s) selected` : null;

  return (
    <Card className={cn(expanded && dirty && "border-primary/40")}>
      <CardHeader className="p-4 pb-2">
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={layerType}>{layerType}</Badge>
                <CardTitle className="truncate text-sm">{sourceName}</CardTitle>
                {saveStatusLabel && (
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      status === "saved" && "text-emerald-600 dark:text-emerald-400",
                      status === "error" && "text-destructive",
                      (status === "pending" || status === "saving") && "text-muted-foreground",
                    )}
                    aria-live="polite"
                  >
                    {saveStatusLabel}
                  </span>
                )}
              </div>
              <CardDescription className="text-xs">
                {syncLabel(source)}
                {selectionLabel && (
                  <span>
                    {" "}
                    · {selectionLabel}
                  </span>
                )}
              </CardDescription>
            </div>
          </button>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {source?.local_path && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 w-full gap-1 px-2 text-xs text-muted-foreground sm:w-auto"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setDocsOpen(true);
                }}
                title="View repo docs"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Docs
              </Button>
            )}
            {allSources && onChangeSource && (
              <select
                className="min-h-10 w-full max-w-none rounded-md border border-input bg-background px-2 py-2 text-base sm:max-w-[180px] sm:py-1 sm:text-xs"
                value={sourceId}
                disabled={disabled}
                aria-label={`Change ${layerType} source`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  if (pid && pid !== sourceId) onChangeSource(pid);
                }}
              >
                {allSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {layerType === "addon" && onRemove && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {source?.local_path && (
        <CardContent className={cn("space-y-3 p-4 pt-0", !expanded && "hidden")}>
          {expandedExtra}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Check STL files or folders to include on the next{" "}
              <strong className="font-medium text-foreground">Update build</strong>. Selections
              save automatically and are the source of truth for recompute. Click{" "}
              <strong className="font-medium text-foreground">Update build</strong> to refresh
              Review parts from these picks.
            </p>
            {showRetry && (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={disabled}
                onClick={() => void saveNow()}
              >
                Retry save
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
            <ImportRulesTree
              key={sourceId}
              projectId={sourceId}
              variant="inline"
              disabled={disabled}
              selectedFilePath={selectedFilePath}
              onFileSelect={setSelectedFilePath}
              onRulesChange={onPendingRulesChange}
              onSelectionStats={(selected, total) => {
                setSelectedCount(selected);
                setTotalFiles(total);
              }}
            />
            <aside className="rounded-md border border-border bg-muted/20 p-3">
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">STL preview</h4>
              <Preview3D
                partId={null}
                sourceId={sourceId}
                relativePath={selectedFilePath}
                preferSource
                filename={previewFilename}
                className="min-h-[220px]"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Click a file row to preview. Drag to rotate.
              </p>
            </aside>
          </div>
        </CardContent>
      )}

      <SourceDocsSheet
        sourceId={sourceId}
        sourceName={sourceName}
        open={docsOpen}
        onOpenChange={setDocsOpen}
      />
    </Card>
  );
}
