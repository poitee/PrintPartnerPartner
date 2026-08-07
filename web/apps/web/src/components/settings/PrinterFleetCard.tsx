import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import {
  deletePrinter,
  fetchPrinterPresets,
  fetchPrinters,
  savePrinterFleet,
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

type Props = {
  engineReady: boolean;
};

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

export default function PrinterFleetCard({ engineReady }: Props) {
  const [printers, setPrinters] = useState<PrinterMachine[]>([]);
  const [presets, setPresets] = useState<PrinterPreset[]>([]);
  const [presetId, setPresetId] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!engineReady) return;
    setLoadError(null);
    try {
      const [fleet, presetRows] = await Promise.all([
        fetchPrinters(),
        fetchPrinterPresets(),
      ]);
      setPrinters(fleet);
      setPresets(presetRows);
      setPresetId((prev) => prev || presetRows[0]?.id || "");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady]);

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
              Bed sizes and loaded filament slots used when exporting 3MF plates. Add machines
              from presets, then set filament color ids to match kit parts.
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
            {printers.map((printer) => (
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
                {printer.loaded_filaments.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {printer.loaded_filaments.map((slot) => (
                      <label key={slot.slot} className="block text-xs">
                        <span className="mb-1 block text-muted-foreground">
                          Slot {slot.slot} filament color id
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
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
