import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Printer } from "lucide-react";
import {
  fetchIntegrationStatus,
  fetchIntegrations,
  fetchPrinterCheckoffLinks,
  fetchPrinters,
  type IntegrationSummary,
  type PrinterCheckoffLink,
  type PrinterHostStatus,
  type PrinterMachine,
} from "../api/engine";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { resolveEngineState } from "../lib/workflowState";
import { useProfileSelection } from "../context/ProfileContext";
import {
  formatPrinterStatusPill,
  printerDeskTypeLabel,
  printerLiveStripTone,
  type LiveStripHostType,
} from "../lib/printerLiveStrip";
import {
  findPlanNameForLiveJob,
  liveJobPlanCaption,
} from "../lib/printerPlanBind";
import { usePrinterStatusPollMs } from "../hooks/usePrinterStatusPollMs";
import { exportRoute } from "../lib/routes";
import { cn } from "../lib/utils";
import PrintersSettingsCard from "../components/settings/PrintersSettingsCard";

const HOST_TYPES = new Set<LiveStripHostType>(["moonraker", "prusalink", "bambu"]);

type LinkedPrinter = {
  printer: PrinterMachine;
  host: IntegrationSummary;
  hostType: LiveStripHostType;
};

function toneBadgeVariant(
  tone: ReturnType<typeof printerLiveStripTone>,
): "success" | "muted" | "default" | "warning" | "error" {
  switch (tone) {
    case "idle":
    case "complete":
      return "success";
    case "printing":
      return "default";
    case "paused":
      return "warning";
    case "error":
    case "offline":
      return "error";
    default:
      return "muted";
  }
}

export default function PrintersPage() {
  const { health, error: engineError, loading: healthLoading } = useEngineHealth();
  const location = useLocation();
  const { profiles } = useProfileSelection();
  const engineState = resolveEngineState({
    health,
    loading: healthLoading,
    error: engineError,
  });
  const engineReady = engineState === "ready";
  const pollMs = usePrinterStatusPollMs();
  const [linked, setLinked] = useState<LinkedPrinter[]>([]);
  const [planning, setPlanning] = useState<PrinterMachine[]>([]);
  const [statusById, setStatusById] = useState<Record<string, PrinterHostStatus>>({});
  const [checkoffLinks, setCheckoffLinks] = useState<PrinterCheckoffLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);
  const linkedRef = useRef(linked);
  linkedRef.current = linked;

  const planNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of profiles) map.set(p.id, p.name);
    return map;
  }, [profiles]);

  const refreshRoster = useCallback(async () => {
    if (!engineReady) {
      setLinked([]);
      setPlanning([]);
      setStatusById({});
      setCheckoffLinks([]);
      setLoadError(null);
      return;
    }
    try {
      const [fleet, integrations, checkoff] = await Promise.all([
        fetchPrinters(),
        fetchIntegrations(),
        fetchPrinterCheckoffLinks()
          .then((r) => r)
          .catch(() => null),
      ]);
      const byId = new Map(integrations.map((i) => [i.id, i]));
      const next: LinkedPrinter[] = [];
      const planningNext: PrinterMachine[] = [];
      for (const machine of fleet) {
        // Skip disabled fleet rows (plan/machine flag) and disabled hosts.
        if (machine.enabled === false) continue;
        const id = machine.integration_id?.trim();
        if (!id) {
          planningNext.push(machine);
          continue;
        }
        const host = byId.get(id);
        if (!host) {
          planningNext.push(machine);
          continue;
        }
        if (host.config.enabled === false) continue;
        if (!HOST_TYPES.has(host.type as LiveStripHostType)) continue;
        next.push({
          printer: machine,
          host,
          hostType: host.type as LiveStripHostType,
        });
      }
      setLinked(next);
      setPlanning(planningNext);
      // Keep last successful links on transient failure (avoid flashing "No plan.").
      if (checkoff) setCheckoffLinks(checkoff.links ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLinked([]);
      setPlanning([]);
      setCheckoffLinks([]);
    }
  }, [engineReady]);

  const refreshStatuses = useCallback(async (rows: LinkedPrinter[]) => {
    const id = ++requestId.current;
    if (!rows.length) {
      if (id === requestId.current) {
        setStatusById({});
        setCheckoffLinks([]);
      }
      return;
    }
    const integrationIds = [...new Set(rows.map((r) => r.host.id))];
    const [entries, checkoff] = await Promise.all([
      Promise.all(
        integrationIds.map(async (integrationId) => {
          try {
            return [integrationId, await fetchIntegrationStatus(integrationId)] as const;
          } catch (e) {
            return [
              integrationId,
              {
                state: "offline" as const,
                message: e instanceof Error ? e.message : String(e),
              },
            ] as const;
          }
        }),
      ),
      fetchPrinterCheckoffLinks()
        .then((r) => r)
        .catch(() => null),
    ]);
    if (id !== requestId.current) return;
    setStatusById(Object.fromEntries(entries));
    if (checkoff) setCheckoffLinks(checkoff.links ?? []);
  }, []);

  useEffect(() => {
    void refreshRoster();
  }, [refreshRoster]);

  useEffect(() => {
    if (!engineReady || linked.length === 0) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      void refreshStatuses(linkedRef.current);
    };

    tick();
    const timer = window.setInterval(tick, pollMs);
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      requestId.current += 1;
    };
  }, [engineReady, linked, refreshStatuses, pollMs]);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, "").trim();
    if (!hash) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs items={[{ label: "Printers" }]} />
      <PageHeader
        icon={Printer}
        accent
        title="Printers"
        description="Live status for connected printers. Planning printers appear here without a connection."
        actions={
          <PageHeaderActions>
            <Button size="sm" variant="outline" asChild>
              <a href="#printer-setup">Printer setup</a>
            </Button>
          </PageHeaderActions>
        }
      />

      {loadError && (
        <p className="text-sm text-destructive">Could not load printers: {loadError}</p>
      )}

      {!engineReady ? (
        <p className="text-sm text-muted-foreground">
          {engineState === "offline"
            ? "Engine offline — start the print-partner engine to view printers."
            : "Connecting to the engine…"}
        </p>
      ) : (
        <>
          {linked.length > 0 || planning.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {planning.map((printer) => (
            <li key={printer.id}>
              <Card className="h-full border-dashed border-border shadow-sm">
                <CardHeader className="space-y-2 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-[15px] font-semibold leading-snug">
                        {printer.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Bed {printer.bed_width_mm}×{printer.bed_depth_mm} mm
                      </CardDescription>
                    </div>
                    <Badge
                      variant="muted"
                      className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-normal"
                    >
                      Planning only
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  <p className="text-xs text-muted-foreground">
                    Planning and local 3MF work without a connection.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" asChild>
                      <a href="#printer-setup">Add connection</a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
          {linked.map(({ printer, host, hostType }) => {
            const status = statusById[host.id];
            const tone = printerLiveStripTone(status?.state);
            const filename = status?.filename?.trim();
            const canSend = hostType === "moonraker" || hostType === "prusalink";
            return (
              <li key={printer.id}>
                <Card className="h-full border-border shadow-sm">
                  <CardHeader className="space-y-2 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-[15px] font-semibold leading-snug">
                          {printer.name}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {printerDeskTypeLabel(hostType)}
                        </CardDescription>
                      </div>
                      <Badge
                        variant={toneBadgeVariant(tone)}
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-normal",
                        )}
                      >
                        {formatPrinterStatusPill(status)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {filename ? (
                      (() => {
                        const planCaption = liveJobPlanCaption(
                          findPlanNameForLiveJob({
                            printerId: printer.id,
                            filename,
                            links: checkoffLinks,
                            planNameById,
                          }),
                        );
                        return (
                          <p
                            className="truncate font-mono text-xs text-muted-foreground"
                            title={`${filename} · ${planCaption}`}
                          >
                            {filename}
                            <span className="font-sans text-muted-foreground/80">
                              {" · "}
                              {planCaption}
                            </span>
                          </p>
                        );
                      })()
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {status?.message?.trim() || "No active job"}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {canSend ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link to={exportRoute()}>Send from Production</Link>
                        </Button>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Use Bambu Connect from Production.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
          ) : null}
          <div id="printer-setup">
            <PrintersSettingsCard
              engineReady={engineReady}
              onFleetChange={refreshRoster}
            />
          </div>
        </>
      )}
    </div>
  );
}
