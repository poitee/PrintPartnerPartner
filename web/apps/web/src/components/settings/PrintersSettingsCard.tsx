import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import {
  createIntegration,
  deleteIntegration,
  deletePrinter,
  fetchIntegrationStatus,
  fetchIntegrations,
  fetchPrinterPresets,
  fetchPrinters,
  savePrinterFleet,
  testIntegration,
  updateIntegration,
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

type HostType = "moonraker" | "prusalink" | "bambu";

const HOST_TYPES = new Set(["moonraker", "prusalink", "bambu"]);

const DEFAULT_URLS: Record<"moonraker" | "prusalink", string> = {
  moonraker: "http://192.168.1.40:7125",
  prusalink: "http://192.168.1.50",
};

const DEFAULT_PRESET_BY_TYPE: Record<HostType, string> = {
  moonraker: "preset-voron-250",
  prusalink: "preset-prusa-mk4",
  bambu: "preset-bambu-x1",
};

const HOST_TYPE_LABELS: Record<HostType, string> = {
  moonraker: "Klipper",
  prusalink: "Prusa",
  bambu: "Bambu",
};

function machineFromPreset(
  preset: PrinterPreset,
  name: string,
  integrationId: string,
  deviceId: string,
): PrinterMachine {
  const slots = Math.max(1, Math.min(4, preset.max_filament_slots || 1));
  return {
    id: `printer-${crypto.randomUUID().slice(0, 10)}`,
    name,
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
    integration_id: integrationId,
    device_id: deviceId,
  };
}

function statusPillLabel(status: PrinterHostStatus | null | undefined): string {
  if (!status) return "…";
  if (status.state === "printing" && status.progress != null) {
    return `Printing ${Math.round(status.progress)}%`;
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

function pickDefaultPresetId(presets: PrinterPreset[], hostType: HostType): string {
  const preferred = DEFAULT_PRESET_BY_TYPE[hostType];
  if (presets.some((p) => p.id === preferred)) return preferred;
  return presets[0]?.id ?? "";
}

/**
 * Unified Printers settings: one Add printer submit creates the host integration
 * and a linked fleet row (schema stays printer.fleet vs integrations).
 */
export default function PrintersSettingsCard({ engineReady }: Props) {
  const [printers, setPrinters] = useState<PrinterMachine[]>([]);
  const [presets, setPresets] = useState<PrinterPreset[]>([]);
  const [hosts, setHosts] = useState<IntegrationSummary[]>([]);
  const [statusByIntegration, setStatusByIntegration] = useState<
    Record<string, PrinterHostStatus>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const [hostType, setHostType] = useState<HostType>("moonraker");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState(DEFAULT_URLS.moonraker);
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bambuHost, setBambuHost] = useState("192.168.1.60");
  const [accessCode, setAccessCode] = useState("");
  const [serial, setSerial] = useState("");
  const [presetId, setPresetId] = useState("");

  const hostsById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts]);

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
      setHosts(integrations.filter((i) => HOST_TYPES.has(i.type)));
      setPresetId((prev) => prev || pickDefaultPresetId(presetRows, "moonraker"));
      void refreshStatuses(fleet);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady, refreshStatuses]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (hostType === "moonraker") {
      setNewUrl((prev) =>
        prev === DEFAULT_URLS.prusalink || prev.includes("prusa")
          ? DEFAULT_URLS.moonraker
          : prev,
      );
    } else if (hostType === "prusalink") {
      setNewUrl((prev) =>
        prev === DEFAULT_URLS.moonraker || prev.includes(":7125")
          ? DEFAULT_URLS.prusalink
          : prev,
      );
    }
    if (presets.length) {
      setPresetId(pickDefaultPresetId(presets, hostType));
    }
  }, [hostType, presets]);

  const onAddPrinter = async () => {
    const name = newName.trim();
    if (!name) return;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      setLoadError("Choose a bed size preset.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      let created: IntegrationSummary;
      let deviceId = "default";
      if (hostType === "bambu") {
        const host = bambuHost.trim();
        const access_code = accessCode.trim();
        const deviceSerial = serial.trim();
        if (!host || !access_code || !deviceSerial) return;
        created = await createIntegration({
          type: "bambu",
          name,
          config: {
            host,
            access_code,
            serial: deviceSerial,
            enabled: true,
          },
        });
        deviceId = deviceSerial;
        setAccessCode("");
        setSerial("");
      } else {
        const base_url = newUrl.trim();
        if (!base_url) return;
        const config: Record<string, unknown> = { base_url, enabled: true };
        if (hostType === "moonraker") {
          if (apiKey.trim()) config.api_key = apiKey.trim();
        } else {
          config.username = username.trim();
          if (password.trim()) config.password = password.trim();
        }
        created = await createIntegration({ type: hostType, name, config });
        setApiKey("");
        setUsername("");
        setPassword("");
      }

      const machine = machineFromPreset(preset, name, created.id, deviceId);
      const next = await savePrinterFleet([...printers, machine]);
      setPrinters(next);
      setHosts((prev) => [...prev, created]);
      void refreshStatuses(next);
      setNewName("");
      setMessage(
        hostType === "bambu"
          ? `${name} added. Status on Printers; use Bambu Connect from Export (never Start print).`
          : `${name} added. Send and Start print from Export when Idle.`,
      );
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (integrationId: string) => {
    setTestingId(integrationId);
    setMessage(null);
    setLoadError(null);
    try {
      const result = await testIntegration(integrationId);
      setMessage(result.ok ? result.message ?? "Connected." : result.message ?? "Test failed.");
      void refreshStatuses(printers);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingId(null);
    }
  };

  const onToggleEnabled = async (printer: PrinterMachine, enabled: boolean) => {
    const integrationId = printer.integration_id?.trim();
    if (!integrationId) return;
    setBusy(true);
    setLoadError(null);
    try {
      await updateIntegration(integrationId, { config: { enabled } });
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (printer: PrinterMachine) => {
    setBusy(true);
    setLoadError(null);
    setMessage(null);
    try {
      const integrationId = printer.integration_id?.trim();
      await deletePrinter(printer.id);
      if (integrationId) {
        try {
          await deleteIntegration(integrationId);
        } catch {
          /* host may already be gone */
        }
      }
      setMessage("Printer removed.");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onStartRename = (printer: PrinterMachine) => {
    setRenamingId(printer.id);
    setRenameDraft(printer.name);
  };

  const onCommitRename = async (printer: PrinterMachine) => {
    const nextName = renameDraft.trim();
    setRenamingId(null);
    if (!nextName || nextName === printer.name) return;
    setBusy(true);
    setLoadError(null);
    try {
      const next = printers.map((p) =>
        p.id === printer.id ? { ...p, name: nextName } : p,
      );
      const saved = await savePrinterFleet(next);
      setPrinters(saved);
      const integrationId = printer.integration_id?.trim();
      if (integrationId) {
        await updateIntegration(integrationId, { name: nextName });
      }
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      await refresh();
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

  const canAdd =
    engineReady &&
    !busy &&
    Boolean(newName.trim()) &&
    Boolean(presetId) &&
    (hostType === "bambu"
      ? Boolean(bambuHost.trim()) &&
        Boolean(accessCode.trim()) &&
        Boolean(serial.trim())
      : Boolean(newUrl.trim()) &&
        (hostType === "moonraker" || Boolean(password.trim())));

  const inputClass =
    "rounded-md border border-input bg-background px-2 py-1.5 text-sm w-full";

  const namePlaceholder =
    hostType === "moonraker"
      ? "Shop Voron"
      : hostType === "prusalink"
        ? "MK4"
        : "X1C desk";

  const linkedPrinters = printers.filter((p) => {
    const id = p.integration_id?.trim();
    if (!id) return false;
    const host = hostsById.get(id);
    return Boolean(host && HOST_TYPES.has(host.type));
  });

  const orphanPrinters = printers.filter((p) => {
    const id = p.integration_id?.trim();
    if (!id) return true;
    return !hostsById.has(id);
  });

  return (
    <Card>
      <CardHeader accent>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-brand/10 text-accent-brand">
            <Printer className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <CardTitle className="text-base">Printers</CardTitle>
            <CardDescription>
              Add a Klipper, Prusa, or Bambu printer once — connection and bed size together.
              Live status on the Printers page; Send from Export for Klipper and Prusa.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Add printer</p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Type</span>
            <Select
              value={hostType}
              onValueChange={(v) => setHostType(v as HostType)}
              disabled={!engineReady || busy}
            >
              <SelectTrigger className="min-h-10 w-full max-w-none sm:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="moonraker">Klipper (Moonraker)</SelectItem>
                <SelectItem value="prusalink">Prusa (PrusaLink)</SelectItem>
                <SelectItem value="bambu">Bambu (LAN + Connect)</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Name</span>
            <input
              className={inputClass}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={namePlaceholder}
              disabled={!engineReady || busy}
            />
          </label>

          {hostType === "bambu" ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Printer IP / hostname
                </span>
                <input
                  className={inputClass}
                  value={bambuHost}
                  onChange={(e) => setBambuHost(e.target.value)}
                  placeholder="192.168.1.60"
                  disabled={!engineReady || busy}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">LAN access code</span>
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="From printer Network / LAN"
                  disabled={!engineReady || busy}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Serial / device id
                </span>
                <input
                  className={inputClass}
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="Device SN from printer or Bambu Studio"
                  disabled={!engineReady || busy}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Status over LAN. Export opens Bambu Connect — it never starts a print from
                there.
              </p>
            </>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Base URL</span>
                <input
                  className={inputClass}
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder={
                    hostType === "moonraker"
                      ? "http://192.168.1.40:7125"
                      : "http://192.168.1.50"
                  }
                  disabled={!engineReady || busy}
                />
              </label>
              {hostType === "moonraker" ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">
                    API key (optional for trusted clients)
                  </span>
                  <input
                    className={inputClass}
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Moonraker API key or JWT"
                    disabled={!engineReady || busy}
                  />
                </label>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">Digest username</span>
                    <input
                      className={inputClass}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="often blank on Buddy"
                      disabled={!engineReady || busy}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">
                      Digest password (printer API key)
                    </span>
                    <input
                      className={inputClass}
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="From printer Settings → Network"
                      disabled={!engineReady || busy}
                    />
                  </label>
                </>
              )}
            </>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Bed size (for 3MF packing)
            </span>
            <Select
              value={presetId}
              onValueChange={setPresetId}
              disabled={!engineReady || busy || presets.length === 0}
            >
              <SelectTrigger className="min-h-10 w-full max-w-none sm:max-w-md">
                <SelectValue placeholder="Choose bed size" />
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

          <Button className="min-h-10" disabled={!canAdd} onClick={() => void onAddPrinter()}>
            Add printer
          </Button>
        </div>

        <ul className="space-y-3">
          {linkedPrinters.map((printer) => {
            const linkedId = printer.integration_id?.trim() || "";
            const host = hostsById.get(linkedId);
            const hostTypeKey = (host?.type ?? "moonraker") as HostType;
            const typeLabel = HOST_TYPE_LABELS[hostTypeKey] ?? host?.type ?? "Printer";
            const enabled = host?.config.enabled !== false;
            const status = linkedId ? statusByIntegration[linkedId] : null;
            const detail =
              host?.type === "bambu"
                ? String(host.config.host ?? host.config.hostname ?? "")
                : String(host?.config.base_url ?? host?.config.baseUrl ?? "");
            return (
              <li
                key={printer.id}
                className="space-y-2 rounded-md border border-border px-3 py-2.5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    {renamingId === printer.id ? (
                      <input
                        className={inputClass}
                        value={renameDraft}
                        autoFocus
                        disabled={busy}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void onCommitRename(printer)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void onCommitRename(printer);
                          }
                          if (e.key === "Escape") {
                            setRenamingId(null);
                          }
                        }}
                        aria-label="Rename printer"
                      />
                    ) : (
                      <button
                        type="button"
                        className="text-left text-sm font-medium hover:underline"
                        onClick={() => onStartRename(printer)}
                        disabled={busy}
                      >
                        {printer.name}{" "}
                        <span className="font-normal text-muted-foreground">
                          ({typeLabel})
                        </span>
                      </button>
                    )}
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {detail}
                      {" · "}
                      Bed {printer.bed_width_mm}×{printer.bed_depth_mm} mm
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex min-h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium",
                      statusPillClass(status?.state),
                    )}
                    title={status?.message}
                  >
                    {statusPillLabel(status)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={busy || !linkedId}
                      onChange={(e) => void onToggleEnabled(printer, e.target.checked)}
                    />
                    Enabled
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!engineReady || testingId === linkedId || !linkedId}
                    onClick={() => void onTest(linkedId)}
                  >
                    {testingId === linkedId ? "Testing…" : "Test connection"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onStartRename(printer)}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRemove(printer)}
                  >
                    Remove
                  </Button>
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

        {orphanPrinters.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Unlinked bed profiles
            </p>
            <ul className="space-y-2">
              {orphanPrinters.map((printer) => (
                <li
                  key={printer.id}
                  className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{printer.name}</p>
                    <p className="text-xs text-muted-foreground tabular">
                      Bed {printer.bed_width_mm}×{printer.bed_depth_mm} mm · not linked
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRemove(printer)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!linkedPrinters.length && !orphanPrinters.length && engineReady && (
          <p className="text-sm text-muted-foreground">
            No printers yet. Add one above to enable status, Export Send, and 3MF packing.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
