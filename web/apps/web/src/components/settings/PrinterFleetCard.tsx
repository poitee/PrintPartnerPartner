import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import {
  deletePrinter,
  fetchIntegrationStatus,
  fetchIntegrations,
  fetchPrinterPresets,
  fetchPrinters,
  savePrinterFleet,
  type IntegrationSummary,
  type PrinterHostStatus,
  type PrinterMachine,
  type PrinterPreset,
} from "../../api/engine";
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
import { cn } from "../../lib/utils";

type Props = {
  engineReady: boolean;
};

const NONE = "__none__";
const HOST_TYPES = new Set(["moonraker", "prusalink", "bambu"]);

const HOST_TYPE_LABELS: Record<string, string> = {
  moonraker: "Moonraker",
  prusalink: "PrusaLink",
  bambu: "Bambu",
};

function hostTypeLabel(type: string): string {
  return HOST_TYPE_LABELS[type] ?? type;
}

function machineFromPreset(preset: PrinterPreset): PrinterMachine {
  const slots = Math.max(1, Math.min(4, preset.max_filament_slots || 1));
  return {
    id: `printer-${crypto.randomUUID().slice(0, 10)}`,
    name: preset.name,
    bed_width_mm: preset.bed_width_mm,
    bed_depth_mm: preset.bed_depth_mm,
    bed_height_mm: preset.bed_height_mm,
    margin_mm: 4,
    max_filament_slots: slots,
    loaded_filaments: Array.from({ length: slots }, (_, i) => ({
      slot: i + 1,
      filament_color_id: null,
      label: "",
    })),
  };
}

function statusPillLabel(status: PrinterHostStatus | null | undefined): string {
  if (!status) return "…";
  if (status.state === "printing" && status.progress != null) {
    return `Printing ${status.progress}%`;
  }
  if (status.state === "idle") return "Idle";
  if (status.state === "paused") return "Paused";
  if (status.state === "complete") return "Complete";
  if (status.state === "error") return "Error";
  if (status.state === "offline") return "Offline";
  return status.message ?? status.state;
}

function statusPillClass(state: PrinterHostStatus["state"] | undefined): string {
  switch (state) {
    case "idle":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "printing":
      return "bg-sky-500/15 text-sky-800 dark:text-sky-300";
    case "paused":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "complete":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "error":
      return "bg-destructive/15 text-destructive";
    case "offline":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function PrinterFleetCard({ engineReady }: Props) {
  const [printers, setPrinters] = useState<PrinterMachine[]>([]);
  const [presets, setPresets] = useState<PrinterPreset[]>([]);
  const [hosts, setHosts] = useState<IntegrationSummary[]>([]);
  const [statusByIntegration, setStatusByIntegration] = useState<
    Record<string, PrinterHostStatus>
  >({});
  const [presetId, setPresetId] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hostOptions = useMemo(
    () => hosts.filter((h) => HOST_TYPES.has(h.type) && h.config.enabled !== false),
    [hosts],
  );

  const hostLabel = useCallback(
    (id: string | null | undefined) => {
      if (!id) return null;
      const host = hosts.find((h) => h.id === id);
      if (!host) return "Missing host";
      return `${host.name} (${hostTypeLabel(host.type)})`;
    },
    [hosts],
  );

  const statusRequestId = useRef(0);

  const refreshStatuses = useCallback(async (fleet: PrinterMachine[]) => {
    const requestId = ++statusRequestId.current;
    const ids = [
      ...new Set(
        fleet
          .map((p) => p.integration_id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!ids.length) {
      if (requestId === statusRequestId.current) setStatusByIntegration({});
      return;
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await fetchIntegrationStatus(id)] as const;
        } catch (e) {
          return [
            id,
            {
              state: "offline" as const,
              message: e instanceof Error ? e.message : String(e),
            },
          ] as const;
        }
      }),
    );
    if (requestId !== statusRequestId.current) return;
    setStatusByIntegration(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    return () => {
      statusRequestId.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!engineReady) return;
    setLoadError(null);
    try {
      const [fleet, presetRows, integrations] = await Promise.all([
        fetchPrinters(),
        fetchPrinterPresets(),
        fetchIntegrations(),
      ]);
      setPrinters(fleet);
      setPresets(presetRows);
      setHosts(integrations);
      setPresetId((prev) => prev || presetRows[0]?.id || "");
      void refreshStatuses(fleet);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady, refreshStatuses]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAddFromPreset = async () => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      const next = await savePrinterFleet([...printers, machineFromPreset(preset)]);
      setPrinters(next);
      setMessage(`Added ${preset.name}.`);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setLoadError(null);
    setMessage(null);
    try {
      await deletePrinter(id);
      setMessage("Printer removed.");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSlotColorChange = async (
    printerId: string,
    slot: number,
    filamentColorId: string,
  ) => {
    const next = printers.map((p) => {
      if (p.id !== printerId) return p;
      return {
        ...p,
        loaded_filaments: p.loaded_filaments.map((lf) =>
          lf.slot === slot
            ? { ...lf, filament_color_id: filamentColorId.trim() || null }
            : lf,
        ),
      };
    });
    setPrinters(next);
    setBusy(true);
    setLoadError(null);
    try {
      const saved = await savePrinterFleet(next);
      setPrinters(saved);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onHostChange = async (printerId: string, value: string) => {
    const integrationId = value === NONE ? null : value;
    const next = printers.map((p) => {
      if (p.id !== printerId) return p;
      const hostChanged = (p.integration_id?.trim() || null) !== integrationId;
      return {
        ...p,
        integration_id: integrationId,
        device_id: integrationId
          ? hostChanged
            ? "default"
            : (p.device_id ?? "default")
          : null,
      };
    });
    setPrinters(next);
    setBusy(true);
    setLoadError(null);
    try {
      const saved = await savePrinterFleet(next);
      setPrinters(saved);
      void refreshStatuses(saved);
      setMessage(
        integrationId
          ? `Linked to ${hostLabel(integrationId)}.`
          : "Host link cleared.",
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "rounded-md border border-input bg-background px-2 py-1.5 text-sm w-full";

  return (
    <Card>
      <CardHeader accent>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-brand/10 text-accent-brand">
            <Printer className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <CardTitle className="text-base">Printer fleet</CardTitle>
            <CardDescription>
              Bed sizes and loaded filament slots used when exporting 3MF plates. Link a live
              host to enable send-to-printer from Export.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Add from preset</span>
            <Select
              value={presetId}
              onValueChange={setPresetId}
              disabled={!engineReady || busy || presets.length === 0}
            >
              <SelectTrigger className="min-h-10 w-full">
                <SelectValue placeholder="Choose a printer preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.bed_width_mm}×{p.bed_depth_mm} mm)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            className="min-h-10"
            disabled={!engineReady || busy || !presetId}
            onClick={() => void onAddFromPreset()}
          >
            Add printer
          </Button>
        </div>

        {printers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No printers yet. Add one from a preset to enable 3MF export.
          </p>
        ) : (
          <ul className="space-y-3">
            {printers.map((printer) => {
              const linkedId = printer.integration_id?.trim() || null;
              const status = linkedId ? statusByIntegration[linkedId] : null;
              return (
                <li
                  key={printer.id}
                  className="space-y-2 rounded-md border border-border px-3 py-2.5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{printer.name}</p>
                      <p className="text-xs text-muted-foreground tabular">
                        Bed {printer.bed_width_mm}×{printer.bed_depth_mm} mm
                        {printer.bed_height_mm != null ? ` × ${printer.bed_height_mm} H` : ""}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onDelete(printer.id)}
                    >
                      Delete
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="block min-w-0 flex-1 text-xs">
                      <span className="mb-1 block text-muted-foreground">Link host</span>
                      <Select
                        value={linkedId ?? NONE}
                        onValueChange={(v) => void onHostChange(printer.id, v)}
                        disabled={!engineReady || busy}
                      >
                        <SelectTrigger className="min-h-9 w-full">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>None</SelectItem>
                          {hostOptions.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.name} ({hostTypeLabel(h.type)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    {linkedId && (
                      <span
                        className={cn(
                          "inline-flex min-h-9 items-center rounded-md px-2.5 text-xs font-medium",
                          statusPillClass(status?.state),
                        )}
                        title={status?.message}
                      >
                        {statusPillLabel(status)}
                      </span>
                    )}
                  </div>

                  {printer.loaded_filaments.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {printer.loaded_filaments.map((slot) => (
                        <label key={slot.slot} className="block text-xs">
                          <span className="mb-1 block text-muted-foreground">
                            Slot {slot.slot} filament color id
                            {slot.label ? ` · ${slot.label}` : ""}
                          </span>
                          <input
                            className={inputClass}
                            defaultValue={slot.filament_color_id ?? ""}
                            placeholder="optional"
                            disabled={!engineReady || busy}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              const prev = slot.filament_color_id ?? "";
                              if (next === prev) return;
                              void onSlotColorChange(printer.id, slot.slot, next);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
