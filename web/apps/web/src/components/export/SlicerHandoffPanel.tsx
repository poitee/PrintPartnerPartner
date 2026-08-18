/**
 * Send plate 3MF(s) to a slicer — Download, Open in managed slicer, or local-app
 * best-effort (download + explanation). Does not alter 3MF object names.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  fetchPrintPlan,
  fetchPrinters,
  fetchSlicerExchangeStatus,
  fetchSlicerInstances,
  openPlatesInSlicer,
  startExport3mf,
  type SlicerInstance,
} from "../../api/engine";
import { useEngineHealth } from "../../hooks/useEngineHealth";
import { useJobRunner } from "../../hooks/useJobRunner";
import { useProfileSelection } from "../../context/ProfileContext";
import { handleExport3mfJobDone } from "../../lib/export3mfJobResult";
import { settingsRoute } from "../../lib/routes";
import { loadHandoffPrinterSelection } from "../../lib/slicerHandoff";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export default function SlicerHandoffPanel() {
  const { health } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const export3mfJob = useJobRunner("export-3mf");
  const [instances, setInstances] = useState<SlicerInstance[]>([]);
  const [instanceId, setInstanceId] = useState<string>("");
  const [exchangeReady, setExchangeReady] = useState(false);
  const [exchangeDetail, setExchangeDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!health?.ok) return;
    let cancelled = false;
    void (async () => {
      try {
        const [list, exchange] = await Promise.all([
          fetchSlicerInstances(),
          fetchSlicerExchangeStatus(),
        ]);
        if (cancelled) return;
        const enabled = list.filter((i) => i.enabled && i.gui_url.trim());
        setInstances(enabled);
        setInstanceId((prev) => prev || enabled[0]?.id || "");
        setExchangeReady(exchange.ready);
        setExchangeDetail(exchange.detail);
      } catch {
        if (!cancelled) {
          setInstances([]);
          setExchangeReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [health?.ok]);

  const fetchEnabledPrinterIds = async (profileId: number) => {
    const selection = await loadHandoffPrinterSelection(profileId, {
      fetchPrinterIds: async () => (await fetchPrinters()).map((printer) => printer.id),
      fetchEnabledPrinterIds: async (id) => (await fetchPrintPlan(id)).enabled_printer_ids,
    });
    if (selection.kind === "no-printers") {
      toast.error("No printers configured", {
        description: "Add a printer in Settings before exporting 3MF.",
      });
      return null;
    }
    return selection.printerIds;
  };

  const onDownload = async () => {
    if (selectedProfileId == null) return;
    try {
      const enabledPrinterIds = await fetchEnabledPrinterIds(selectedProfileId);
      if (!enabledPrinterIds) return;
      await export3mfJob.runJob(
        () =>
          startExport3mf({
            profile_id: selectedProfileId,
            layout_mode: "per_plate",
            enabled_printer_ids: enabledPrinterIds,
          }),
        (snap) => handleExport3mfJobDone("3MF export", snap),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onManagedOpen = async () => {
    if (selectedProfileId == null || !instanceId) return;
    setBusy(true);
    try {
      const enabledPrinterIds = await fetchEnabledPrinterIds(selectedProfileId);
      if (!enabledPrinterIds) return;
      const result = await openPlatesInSlicer(instanceId, {
        profile_id: selectedProfileId,
        layout_mode: "per_plate",
        enabled_printer_ids: enabledPrinterIds,
      });
      toast.success(`Staged ${result.staged.length} plate(s) for the slicer`, {
        description: `Open File → Open in the slicer GUI and pick files under the exchange inbox (${result.inbox_dir}).`,
        duration: 12_000,
      });
      if (result.warnings.length) {
        toast.warning(`${result.warnings.length} export warning(s)`, {
          description: result.warnings.slice(0, 3).join("\n"),
        });
      }
      window.open(result.gui_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLocalApp = async () => {
    toast.message("Open with local app", {
      description:
        "Browsers cannot reliably hand files to desktop slicers. Downloading the 3MF instead — open it from the slicer’s File → Open.",
      duration: 10_000,
    });
    await onDownload();
  };

  const disabled = selectedProfileId == null || !health?.ok || export3mfJob.busy || busy;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="text-[13.5px] font-semibold leading-snug">
          Send plate(s) to slicer
        </CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          Same per-plate 3MFs Print Partner already builds — object names stay readable for Progress.
          Prefer one plate at a time in the slicer when possible.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {instances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No enabled slicer instances with a GUI URL.{" "}
            <Link className="underline" to={settingsRoute() + "#slicers"}>
              Settings → Slicers
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Managed slicer</span>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger className="h-8 w-[14rem]">
                <SelectValue placeholder="Choose slicer" />
              </SelectTrigger>
              <SelectContent>
                {instances.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void onDownload()}>
            Download 3MF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !instanceId || !exchangeReady}
            title={exchangeDetail ?? undefined}
            onClick={() => void onManagedOpen()}
          >
            Open in managed slicer
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void onLocalApp()}>
            Open with local app
          </Button>
        </div>

        {!exchangeReady && (
          <p className="text-xs text-muted-foreground">
            Managed open needs a writable exchange volume
            {exchangeDetail ? ` (${exchangeDetail})` : " (set PP_EXCHANGE_DIR)"}. Download still works.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
