import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable } from "lucide-react";
import {
  createIntegration,
  deleteIntegration,
  fetchIntegrations,
  testIntegration,
  updateIntegration,
  type IntegrationSummary,
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

type Props = {
  engineReady: boolean;
};

type HostType = "moonraker" | "prusalink" | "bambu";

const HOST_TYPES = new Set(["moonraker", "prusalink", "bambu"]);

const DEFAULT_URLS: Record<"moonraker" | "prusalink", string> = {
  moonraker: "http://192.168.1.40:7125",
  prusalink: "http://192.168.1.50",
};

export default function PrinterHostsSettingsCard({ engineReady }: Props) {
  const [items, setItems] = useState<IntegrationSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [hostType, setHostType] = useState<HostType>("moonraker");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState(DEFAULT_URLS.moonraker);
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bambuHost, setBambuHost] = useState("192.168.1.60");
  const [accessCode, setAccessCode] = useState("");
  const [serial, setSerial] = useState("");

  const hostItems = useMemo(
    () => items.filter((i) => HOST_TYPES.has(i.type)),
    [items],
  );

  const refresh = useCallback(async () => {
    if (!engineReady) return;
    setLoadError(null);
    try {
      setItems(await fetchIntegrations());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady]);

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
  }, [hostType]);

  const onAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      if (hostType === "bambu") {
        const host = bambuHost.trim();
        const access_code = accessCode.trim();
        const deviceSerial = serial.trim();
        if (!host || !access_code || !deviceSerial) return;
        await createIntegration({
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
        setMessage(
          "Bambu host added (LAN status). Link it to a fleet printer for the Progress live strip. Send-to-printer stays Moonraker/PrusaLink until official Connect / Local Server.",
        );
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
        await createIntegration({ type: hostType, name, config });
        setApiKey("");
        setUsername("");
        setPassword("");
        setMessage(
          hostType === "moonraker"
            ? "Moonraker host added. Link it to a fleet printer below."
            : "PrusaLink host added. Link it to a fleet printer below.",
        );
      }
      setNewName("");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (id: string) => {
    setTestingId(id);
    setMessage(null);
    setLoadError(null);
    try {
      const result = await testIntegration(id);
      setMessage(result.ok ? result.message ?? "Connected." : result.message ?? "Test failed.");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingId(null);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setLoadError(null);
    try {
      await deleteIntegration(id);
      setMessage("Host removed. Fleet links to this host were cleared.");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onToggleEnabled = async (item: IntegrationSummary, enabled: boolean) => {
    setBusy(true);
    setLoadError(null);
    try {
      await updateIntegration(item.id, { config: { enabled } });
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canAdd =
    engineReady &&
    !busy &&
    Boolean(newName.trim()) &&
    (hostType === "bambu"
      ? Boolean(bambuHost.trim()) &&
        Boolean(accessCode.trim()) &&
        Boolean(serial.trim())
      : Boolean(newUrl.trim()) &&
        (hostType === "moonraker" || Boolean(password.trim())));

  const inputClass =
    "rounded-md border border-input bg-background px-2 py-1.5 text-sm w-full";

  const addButtonLabel =
    hostType === "moonraker"
      ? "Moonraker"
      : hostType === "prusalink"
        ? "PrusaLink"
        : "Bambu";

  const namePlaceholder =
    hostType === "moonraker"
      ? "Shop Voron"
      : hostType === "prusalink"
        ? "MK4"
        : "X1C desk";

  return (
    <Card>
      <CardHeader accent>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-brand/10 text-accent-brand">
            <Cable className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <CardTitle className="text-base">Printer hosts</CardTitle>
            <CardDescription>
              Live Moonraker, PrusaLink, and Bambu (LAN status) on your LAN. Link a host
              to a fleet machine for Progress status; send sliced G-code from Export for
              Moonraker / PrusaLink only.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Add host</p>
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
                <SelectItem value="moonraker">Moonraker (Klipper)</SelectItem>
                <SelectItem value="prusalink">PrusaLink</SelectItem>
                <SelectItem value="bambu">Bambu (LAN status)</SelectItem>
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
                <span className="mb-1 block text-muted-foreground">
                  LAN access code
                </span>
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
                Status via local MQTT (<span className="font-mono">IP:8883</span>, user{" "}
                <span className="font-mono">bblp</span>). Send-to-printer is not enabled for
                Bambu — see Printer setup docs for Developer Mode / official Connect-Local
                Server.
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
          <Button className="min-h-10" disabled={!canAdd} onClick={() => void onAdd()}>
            Add {addButtonLabel} host
          </Button>
        </div>

        <ul className="space-y-2">
          {hostItems.map((item) => {
            const enabled = item.config.enabled !== false;
            const typeLabel =
              item.type === "moonraker"
                ? "Moonraker"
                : item.type === "prusalink"
                  ? "PrusaLink"
                  : "Bambu";
            const detail =
              item.type === "bambu"
                ? String(item.config.host ?? item.config.hostname ?? "")
                : String(item.config.base_url ?? item.config.baseUrl ?? "");
            const serialHint =
              item.type === "bambu"
                ? String(item.config.serial ?? item.config.device_id ?? "")
                : "";
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {item.name}{" "}
                    <span className="font-normal text-muted-foreground">({typeLabel})</span>
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {detail}
                    {serialHint ? ` · ${serialHint}` : ""}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={busy}
                    onChange={(e) => void onToggleEnabled(item, e.target.checked)}
                  />
                  Enabled
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!engineReady || testingId === item.id}
                  onClick={() => void onTest(item.id)}
                >
                  {testingId === item.id ? "Testing…" : "Test connection"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void onDelete(item.id)}
                >
                  Delete
                </Button>
              </li>
            );
          })}
        </ul>

        {!hostItems.length && engineReady && (
          <p className="text-sm text-muted-foreground">
            No printer hosts yet. Add Moonraker, PrusaLink, or Bambu (status) to get
            started.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
