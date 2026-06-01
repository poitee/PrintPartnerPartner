import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  engineBaseUrl,
  fetchHealth,
  fetchLegalDocument,
  fetchManifestRegistry,
  fetchWorkflowGuide,
  openDataFolder,
  openExportsFolder,
  type ManifestRegistryEntry,
} from "../api/engine";
import SupportCta from "../components/SupportCta";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { buildRoute, reviewRoute, sourcesRoute } from "../lib/routes";

type LegalTab = "summary" | "license" | "attribution" | "commercial" | "third-party";

const LEGAL_TABS: { id: LegalTab; label: string }[] = [
  { id: "summary", label: "License overview" },
  { id: "license", label: "Full license" },
  { id: "attribution", label: "Attribution" },
  { id: "commercial", label: "Commercial" },
  { id: "third-party", label: "Third-party notices" },
];

const WORKFLOW_STEPS = [
  {
    num: 1,
    label: "Sources",
    path: sourcesRoute(),
    description: "Add or sync repos and set import rules",
  },
  {
    num: 2,
    label: "Build",
    path: null as string | null,
    description: "Attach sources, pick STLs, and update the build",
  },
  {
    num: 3,
    label: "Review",
    path: null as string | null,
    description: "Validate parts, track printing, edit quantities, and export",
  },
] as const;

function renderMarkdownLite(text: string): string {
  return text
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(.+)$/gm, (line) =>
      line.startsWith("<") ? line : `<p>${line}</p>`,
    );
}

function HelpLoadingSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

export default function HelpPage() {
  const { health } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const [legalTab, setLegalTab] = useState<LegalTab>("summary");
  const [legalText, setLegalText] = useState("");
  const [workflowText, setWorkflowText] = useState("");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [legalLoading, setLegalLoading] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const [registryEntries, setRegistryEntries] = useState<ManifestRegistryEntry[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const stepPaths = WORKFLOW_STEPS.map((step) => {
    if (step.path) return step.path;
    if (step.label === "Build") return buildRoute(selectedProfileId);
    if (step.label === "Review") return reviewRoute(selectedProfileId);
    return buildRoute(selectedProfileId);
  });

  useEffect(() => {
    void fetchHealth()
      .then((h) => setDataDir(h.data_dir))
      .catch(() => setDataDir(null));
    void engineBaseUrl().then(setEngineUrl);
  }, [health]);

  const loadWorkflow = useCallback(async () => {
    setWorkflowError(null);
    setWorkflowLoading(true);
    try {
      const text = await fetchWorkflowGuide();
      setWorkflowText(text);
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : String(e));
      setWorkflowText("");
    } finally {
      setWorkflowLoading(false);
    }
  }, []);

  const loadLegal = useCallback(async (tab: LegalTab) => {
    setLegalError(null);
    setLegalLoading(true);
    try {
      const text = await fetchLegalDocument(tab);
      setLegalText(text);
    } catch (e) {
      setLegalError(e instanceof Error ? e.message : String(e));
      setLegalText("");
    } finally {
      setLegalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!health) return;
    void loadWorkflow();
  }, [health, loadWorkflow]);

  useEffect(() => {
    if (!health) return;
    void loadLegal(legalTab);
  }, [health, legalTab, loadLegal]);

  useEffect(() => {
    if (!health) return;
    setRegistryError(null);
    setRegistryLoading(true);
    void fetchManifestRegistry()
      .then(setRegistryEntries)
      .catch((e) => {
        setRegistryError(e instanceof Error ? e.message : String(e));
        setRegistryEntries([]);
      })
      .finally(() => setRegistryLoading(false));
  }, [health]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Help"
        description="Workflow guide, data folders, and license information."
        actions={<SupportCta />}
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Workflow</CardTitle>
          <CardDescription>Sources → Build → Review</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((step, index) => (
              <li key={step.num}>
                <Link
                  to={stepPaths[index]}
                  className="flex h-full flex-col rounded-lg border border-border bg-muted/20 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span className="text-xs font-medium text-primary">Step {step.num}</span>
                  <span className="mt-1 font-medium">{step.label}</span>
                  <span className="mt-1 text-xs text-muted-foreground">{step.description}</span>
                </Link>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="shadow-none" id="creating-a-manifest">
        <CardHeader>
          <CardTitle className="text-base">Workflow guide</CardTitle>
        </CardHeader>
        <CardContent>
          {workflowError && <p className="text-sm text-destructive">{workflowError}</p>}
          {!health && (
            <p className="text-sm text-muted-foreground">
              Connect to the engine to load the workflow guide.
            </p>
          )}
          {workflowLoading && health && !workflowText && <HelpLoadingSkeleton />}
          {workflowText ? (
            <div
              className="help-prose text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:space-y-1"
              dangerouslySetInnerHTML={{ __html: renderMarkdownLite(workflowText) }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Community manifest registry</CardTitle>
          <CardDescription>
            Approved manifests from the Print Partner repo. Link a slug on a source or use a
            repo-root <code className="font-mono text-xs">print-partner.manifest.yaml</code> after
            sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registryError && <p className="text-sm text-destructive">{registryError}</p>}
          {!health && (
            <p className="text-sm text-muted-foreground">
              Connect to the engine to browse approved manifests.
            </p>
          )}
          {registryLoading && health && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}
          {health && registryEntries.length === 0 && !registryError && !registryLoading && (
            <p className="text-sm text-muted-foreground">No approved community manifests yet.</p>
          )}
          {registryEntries.length > 0 && (
            <ul className="space-y-3">
              {registryEntries.map((entry) => (
                <li
                  key={entry.slug}
                  className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
                >
                  <strong>{entry.title ?? entry.slug}</strong>
                  <span className="font-mono text-xs text-muted-foreground">{entry.slug}</span>
                  {entry.target_repo ? (
                    <a
                      href={entry.target_repo}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      {entry.target_repo}
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">No repo URL</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Folders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {dataDir ? (
              <>
                Data directory: <code className="font-mono text-xs">{dataDir}</code>
              </>
            ) : (
              "Start the engine to see the data directory path."
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => void openDataFolder()}
            >
              Open data folder
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => void openExportsFolder()}
            >
              Open exports folder
            </Button>
          </div>
          {engineUrl && (
            <p className="text-xs text-muted-foreground">
              Engine API: <code className="font-mono">{engineUrl}</code> · OpenAPI:{" "}
              <code className="font-mono">{engineUrl}/api/v1/openapi.json</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Legal</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={legalTab} onValueChange={(v) => setLegalTab(v as LegalTab)}>
            <TabsList className="flex h-auto w-full flex-wrap gap-1 sm:flex-nowrap">
              {LEGAL_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="min-h-9 flex-1 text-xs sm:flex-none sm:text-sm">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {LEGAL_TABS.map((t) => (
              <TabsContent key={t.id} value={t.id}>
                {legalError && <p className="text-sm text-destructive">{legalError}</p>}
                {!health && (
                  <p className="text-sm text-muted-foreground">
                    Connect to the engine to load license text.
                  </p>
                )}
                {legalLoading && health && !legalText ? (
                  <HelpLoadingSkeleton />
                ) : (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed">
                    {legalText || (health ? "" : "")}
                  </pre>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
