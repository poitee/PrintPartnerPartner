import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import {
  addPrinter,
  createIntegration,
  deleteIntegration,
  deletePrinter,
  fetchIntegrationStatus,
  fetchIntegrations,
  fetchPrinterPlanBindings,
  fetchPrinterPresets,
  fetchFilamentCatalog,
  fetchPrinters,
  fetchProfiles,
  savePrinterFleet,
  type FilamentCatalog,
  savePrinterPlanBinding,
  testIntegration,
  updateIntegration,
  updatePrinterSlicer,
  type IntegrationSummary,
  type PrinterHostStatus,
  type PrinterMachine,
  type PrinterPlanBinding,
  type PrinterPreset,
  type ProfileSummary,
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
import PrinterProfileAssignmentSection from "./PrinterProfileAssignmentSection";
import SlotFilamentPicker from "./SlotFilamentPicker";
import { cn } from "../../lib/utils";
import {
  PRINTER_STATUS_POLL_SECONDS_OPTIONS,
  readPrinterStatusPollSeconds,
  writePrinterStatusPollSeconds,
  type PrinterStatusPollSeconds,
} from "../../lib/persistedPrinterStatusPoll";

type Props = {
  engineReady: boolean;
  /** Called after a successful fleet reload so live rosters can catch up. */
  onFleetChange?: () => void;
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

type SlicerOverride = "orca" | "prusa" | "bambu";

const SLICER_OVERRIDE_LABELS: Record<SlicerOverride, string> = {
  orca: "OrcaSlicer",
  prusa: "PrusaSlicer",
  bambu: "BambuStudio",
};

const CUSTOM_PRESET_ID = "custom";

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

function ConnectionFields({
  hostType,
  setHostType,
  newUrl,
  setNewUrl,
  apiKey,
  setApiKey,
  username,
  setUsername,
  password,
  setPassword,
  bambuHost,
  setBambuHost,
  accessCode,
  setAccessCode,
  serial,
  setSerial,
  disabled,
  inputClass,
}: {
  hostType: HostType;
  setHostType: (value: HostType) => void;
  newUrl: string;
  setNewUrl: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  bambuHost: string;
  setBambuHost: (value: string) => void;
  accessCode: string;
  setAccessCode: (value: string) => void;
  serial: string;
  setSerial: (value: string) => void;
  disabled: boolean;
  inputClass: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Type</span>
        <Select
          value={hostType}
          onValueChange={(v) => setHostType(v as HostType)}
          disabled={disabled}
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
      {hostType === "bambu" ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Printer IP / hostname</span>
            <input
              className={inputClass}
              value={bambuHost}
              onChange={(e) => setBambuHost(e.target.value)}
              placeholder="192.168.1.60"
              disabled={disabled}
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
              disabled={disabled}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Serial / device id</span>
            <input
              className={inputClass}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Device SN from printer or Bambu Studio"
              disabled={disabled}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Status over LAN. Export opens Bambu Connect — it never starts a print from there.
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
              disabled={disabled}
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
                disabled={disabled}
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
                  disabled={disabled}
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
                  disabled={disabled}
                />
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Printers settings: create a planning Printer from a preset or Custom bed,
 * then optionally attach a host connection later.
 */
export default function PrintersSettingsCard({ engineReady, onFleetChange }: Props) {
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
  const [planBindings, setPlanBindings] = useState<PrinterPlanBinding[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [catalog, setCatalog] = useState<FilamentCatalog | null>(null);

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
  const [customWidth, setCustomWidth] = useState("250");
  const [customDepth, setCustomDepth] = useState("250");
  const [customHeight, setCustomHeight] = useState("250");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [sizeDraft, setSizeDraft] = useState({
    model: "",
    width: "",
    depth: "",
    height: "",
  });
  const [pollSeconds, setPollSeconds] = useState<PrinterStatusPollSeconds>(() =>
    readPrinterStatusPollSeconds(),
  );

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
      const [fleet, presetRows, integrations, bindings, profileList, filamentCatalog] =
        await Promise.all([
          fetchPrinters(),
          fetchPrinterPresets(),
          fetchIntegrations(),
          fetchPrinterPlanBindings(),
          fetchProfiles(),
          fetchFilamentCatalog().catch(() => null),
        ]);
      setPrinters(fleet);
      setPresets(presetRows);
      setHosts(integrations.filter((i) => HOST_TYPES.has(i.type)));
      setPresetId((prev) => prev || pickDefaultPresetId(presetRows, "moonraker"));
      setPlanBindings(bindings);
      setProfiles(profileList);
      setCatalog(filamentCatalog);
      void refreshStatuses(fleet);
      onFleetChange?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady, onFleetChange, refreshStatuses]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // URL defaults follow host type only.
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
  }, [hostType]);

  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  // Seed a default once presets first arrive (without resetting later refreshes).
  useEffect(() => {
    if (!presets.length) return;
    setPresetId((prev) => prev || pickDefaultPresetId(presets, hostType));
  }, [presets, hostType]);

  const createHost = async (
    name: string,
  ): Promise<{ created: IntegrationSummary; deviceId: string }> => {
    if (hostType === "bambu") {
      const host = bambuHost.trim();
      const access_code = accessCode.trim();
      const deviceSerial = serial.trim();
      if (!host || !access_code || !deviceSerial) {
        throw new Error("Enter printer IP, LAN access code, and serial.");
      }
      const created = await createIntegration({
        type: "bambu",
        name,
        config: {
          host,
          access_code,
          serial: deviceSerial,
          enabled: true,
        },
      });
      setAccessCode("");
      setSerial("");
      return { created, deviceId: deviceSerial };
    }
    const base_url = newUrl.trim();
    if (!base_url) {
      throw new Error("Enter the printer base URL.");
    }
    const config: Record<string, unknown> = { base_url, enabled: true };
    if (hostType === "moonraker") {
      if (apiKey.trim()) config.api_key = apiKey.trim();
    } else {
      config.username = username.trim();
      if (password.trim()) config.password = password.trim();
    }
    const created = await createIntegration({ type: hostType, name, config });
    setApiKey("");
    setUsername("");
    setPassword("");
    return { created, deviceId: "default" };
  };

  const onAddPrinter = async () => {
    const name = newName.trim();
    if (!name) return;
    const isCustom = presetId === CUSTOM_PRESET_ID;
    if (!isCustom && !presets.some((p) => p.id === presetId)) {
      setLoadError("Choose a bed size preset.");
      return;
    }
    const width = Number(customWidth);
    const depth = Number(customDepth);
    const height = Number(customHeight);
    if (isCustom && (!(width > 0) || !(depth > 0) || !(height > 0))) {
      setLoadError("Enter custom bed width, depth, and height.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      const created = await addPrinter(
        isCustom
          ? {
              name,
              model: name,
              bed_width_mm: width,
              bed_depth_mm: depth,
              bed_height_mm: height,
            }
          : { name, preset_id: presetId },
      );
      setPrinters((prev) => [...prev, created]);
      setNewName("");
      setMessage(
        `${name} added for planning and local 3MF. Add a connection later to send jobs and read status.`,
      );
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAttachConnection = async (printer: PrinterMachine) => {
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      const { created, deviceId } = await createHost(printer.name);
      const next = printers.map((p) =>
        p.id === printer.id
          ? { ...p, integration_id: created.id, device_id: deviceId }
          : p,
      );
      const saved = await savePrinterFleet(next);
      setPrinters(saved);
      setHosts((prev) => [...prev, created]);
      setConnectingId(null);
      setMessage(
        hostType === "bambu"
          ? `Connection added to ${printer.name}. Status on Printers; use Bambu Connect from Production (never Start print).`
          : `Connection added to ${printer.name}. Send and Start print from Production when Idle.`,
      );
      void refreshStatuses(saved);
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

  const onStartEditSize = (printer: PrinterMachine) => {
    setEditingSizeId(printer.id);
    setSizeDraft({
      model: printer.model,
      width: String(printer.bed_width_mm),
      depth: String(printer.bed_depth_mm),
      height: printer.bed_height_mm != null ? String(printer.bed_height_mm) : "",
    });
  };

  const onSaveSize = async (printer: PrinterMachine) => {
    const model = sizeDraft.model.trim();
    const width = Number(sizeDraft.width);
    const depth = Number(sizeDraft.depth);
    const height = Number(sizeDraft.height);
    if (!model) {
      setLoadError("Model is required.");
      return;
    }
    if (!(width > 0) || !(depth > 0) || !(height > 0)) {
      setLoadError("Enter custom bed width, depth, and height.");
      return;
    }
    setBusy(true);
    setLoadError(null);
    try {
      const next = printers.map((p) =>
        p.id === printer.id
          ? {
              ...p,
              model,
              bed_width_mm: width,
              bed_depth_mm: depth,
              bed_height_mm: height,
            }
          : p,
      );
      const saved = await savePrinterFleet(next);
      setPrinters(saved);
      setEditingSizeId(null);
      onFleetChange?.();
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
    filamentColorId: string | null,
    label: string,
  ) => {
    const next = printers.map((p) => {
      if (p.id !== printerId) return p;
      return {
        ...p,
        loaded_filaments: p.loaded_filaments.map((lf) =>
          lf.slot === slot
            ? {
                ...lf,
                filament_color_id: filamentColorId?.trim() || null,
                label: label.trim(),
              }
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
      onFleetChange?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onSlicerOverrideChange = async (
    printer: PrinterMachine,
    value: SlicerOverride | "auto",
  ) => {
    const next = value === "auto" ? null : value;
    setBusy(true);
    setLoadError(null);
    try {
      const updated = await updatePrinterSlicer(printer.id, next);
      setPrinters((prev) => prev.map((p) => (p.id === printer.id ? updated : p)));
      onFleetChange?.();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const customReady =
    Number(customWidth) > 0 && Number(customDepth) > 0 && Number(customHeight) > 0;
  const canAdd =
    engineReady &&
    !busy &&
    Boolean(newName.trim()) &&
    (presetId === CUSTOM_PRESET_ID ? customReady : Boolean(presetId));
  const connectionReady =
    hostType === "bambu"
      ? Boolean(bambuHost.trim()) &&
        Boolean(accessCode.trim()) &&
        Boolean(serial.trim())
      : Boolean(newUrl.trim()) &&
        (hostType === "moonraker" || Boolean(password.trim()));

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
            <CardTitle level={3} className="text-base">Printers</CardTitle>
            <CardDescription>
              Create a Printer from a bed preset or Custom size. Planning and local 3MF
              work without a connection. Add a host later for status, sending, and job tracking.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <label className="block max-w-md text-sm">
          <span className="mb-1 block font-medium">Printer status refresh</span>
          <span className="mb-1.5 block text-xs text-muted-foreground">
            How often Progress, Export, and the Printers page ask linked hosts for status while
            the page is open.
          </span>
          <Select
            value={String(pollSeconds)}
            onValueChange={(v) => {
              const next = Number(v) as PrinterStatusPollSeconds;
              setPollSeconds(next);
              writePrinterStatusPollSeconds(next);
            }}
          >
            <SelectTrigger className="min-h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRINTER_STATUS_POLL_SECONDS_OPTIONS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Every {s} seconds
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Add printer</p>
          <p className="text-xs text-muted-foreground">
            A connection is optional. Add it later when you want live status or sending.
          </p>
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
                <SelectItem value={CUSTOM_PRESET_ID}>Custom</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {presetId === CUSTOM_PRESET_ID && (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Width (mm)</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  disabled={!engineReady || busy}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Depth (mm)</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={customDepth}
                  onChange={(e) => setCustomDepth(e.target.value)}
                  disabled={!engineReady || busy}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Height (mm)</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  disabled={!engineReady || busy}
                />
              </label>
            </div>
          )}

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
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">Preferred slicer:</span>
                    <Select
                      value={printer.preferred_slicer ?? "auto"}
                      onValueChange={(v) =>
                        void onSlicerOverrideChange(printer, v as SlicerOverride | "auto")
                      }
                      disabled={!engineReady || busy}
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        {(Object.keys(SLICER_OVERRIDE_LABELS) as SlicerOverride[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {SLICER_OVERRIDE_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <p className="text-xs text-muted-foreground">
                  Accepted Plate export does not choose slicer profiles.
                </p>

                {printer.loaded_filaments.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {printer.loaded_filaments.map((slot) => (
                      <SlotFilamentPicker
                        key={slot.slot}
                        slot={slot.slot}
                        extraLabel={slot.label && slot.label !== slot.filament_color_id ? slot.label : undefined}
                        filamentColorId={slot.filament_color_id}
                        catalog={catalog}
                        disabled={!engineReady || busy}
                        onChange={(colorId, label) => {
                          void onSlotColorChange(printer.id, slot.slot, colorId, label);
                        }}
                      />
                    ))}
                  </div>
                )}

                <PrinterProfileAssignmentSection
                  printer={printer}
                  engineReady={engineReady}
                  disabled={busy}
                />

                {(host?.type === "moonraker" || host?.type === "prusalink") && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground min-w-fit">Default plan:</span>
                    <Select
                      value={planBindings.find(b => b.integration_id === printer.integration_id)?.profile_id?.toString() ?? "none"}
                      onValueChange={(val) => {
                        const profileId = val === "none" ? null : Number(val);
                        void savePrinterPlanBinding(printer.integration_id!, profileId)
                          .then(setPlanBindings);
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="No default plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No default plan</SelectItem>
                        {profiles.map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {orphanPrinters.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Planning printers
            </p>
            <ul className="space-y-2">
              {orphanPrinters.map((printer) => {
                const attaching = connectingId === printer.id;
                return (
                  <li
                    key={printer.id}
                    className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{printer.name}</p>
                        <p className="text-xs text-muted-foreground tabular">
                          Bed {printer.bed_width_mm}×{printer.bed_depth_mm} mm · planning only
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!attaching && editingSizeId !== printer.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => onStartEditSize(printer)}
                          >
                            Edit size
                          </Button>
                        )}
                        {!attaching && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setConnectingId(printer.id)}
                          >
                            Add connection
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void onRemove(printer)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    {editingSizeId === printer.id && (
                      <div className="space-y-2 border-t border-border pt-2">
                        <label className="block text-sm">
                          <span className="mb-1 block text-muted-foreground">Model</span>
                          <input
                            className={inputClass}
                            value={sizeDraft.model}
                            onChange={(e) =>
                              setSizeDraft((prev) => ({ ...prev, model: e.target.value }))
                            }
                            disabled={!engineReady || busy}
                            aria-label="Model"
                          />
                        </label>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label className="block text-sm">
                            <span className="mb-1 block text-muted-foreground">Width (mm)</span>
                            <input
                              className={inputClass}
                              inputMode="numeric"
                              value={sizeDraft.width}
                              onChange={(e) =>
                                setSizeDraft((prev) => ({ ...prev, width: e.target.value }))
                              }
                              disabled={!engineReady || busy}
                              aria-label="Width (mm)"
                            />
                          </label>
                          <label className="block text-sm">
                            <span className="mb-1 block text-muted-foreground">Depth (mm)</span>
                            <input
                              className={inputClass}
                              inputMode="numeric"
                              value={sizeDraft.depth}
                              onChange={(e) =>
                                setSizeDraft((prev) => ({ ...prev, depth: e.target.value }))
                              }
                              disabled={!engineReady || busy}
                              aria-label="Depth (mm)"
                            />
                          </label>
                          <label className="block text-sm">
                            <span className="mb-1 block text-muted-foreground">Height (mm)</span>
                            <input
                              className={inputClass}
                              inputMode="numeric"
                              value={sizeDraft.height}
                              onChange={(e) =>
                                setSizeDraft((prev) => ({ ...prev, height: e.target.value }))
                              }
                              disabled={!engineReady || busy}
                              aria-label="Height (mm)"
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void onSaveSize(printer)}
                          >
                            Save size
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setEditingSizeId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {attaching && (
                      <div className="space-y-2 border-t border-border pt-2">
                        <ConnectionFields
                          hostType={hostType}
                          setHostType={setHostType}
                          newUrl={newUrl}
                          setNewUrl={setNewUrl}
                          apiKey={apiKey}
                          setApiKey={setApiKey}
                          username={username}
                          setUsername={setUsername}
                          password={password}
                          setPassword={setPassword}
                          bambuHost={bambuHost}
                          setBambuHost={setBambuHost}
                          accessCode={accessCode}
                          setAccessCode={setAccessCode}
                          serial={serial}
                          setSerial={setSerial}
                          disabled={!engineReady || busy}
                          inputClass={inputClass}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={!connectionReady || busy}
                            onClick={() => void onAttachConnection(printer)}
                          >
                            Save connection
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setConnectingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!linkedPrinters.length && !orphanPrinters.length && engineReady && (
          <p className="text-sm text-muted-foreground">
            No printers yet. Add one above to plan Plates and export 3MF. A connection is
            optional until you send or read status.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
