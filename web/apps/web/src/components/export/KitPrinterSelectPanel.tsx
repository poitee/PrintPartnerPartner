/**
 * Per-plan printer enablement — which fleet machines pack/export this kit.
 * Empty enabled list means "use the whole fleet" (same as resolveEnabledPrinters).
 */
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { usePlateWorkspaceQuery } from "../../queries/plateWorkspace";
import { useEnabledPrintersMutation } from "../../queries/printAssignments";
import { settingsPrintersRoute } from "../../lib/routes";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type Props = {
  profileId: number | null;
  engineReady: boolean;
};

function slotLabel(slot: { slot: number; filament_color_id: string | null; label: string }): string {
  const name = slot.label.trim() || slot.filament_color_id;
  return name ? `S${slot.slot}: ${name}` : `S${slot.slot}: empty`;
}

export default function KitPrinterSelectPanel({ profileId, engineReady }: Props) {
  const enabled = engineReady && profileId != null;
  const { data, isLoading, error } = usePlateWorkspaceQuery(profileId, enabled);
  const mutation = useEnabledPrintersMutation(profileId);

  const printers = data?.printers ?? [];
  const savedIds = data?.plan?.enabled_printer_ids ?? [];
  const treatAllAsEnabled = savedIds.length === 0;

  const onToggle = (printerId: string, nextChecked: boolean) => {
    if (profileId == null) return;
    const current = treatAllAsEnabled ? printers.map((p) => p.id) : [...savedIds];
    const next = nextChecked
      ? [...new Set([...current, printerId])]
      : current.filter((id) => id !== printerId);
    mutation.mutate(next, {
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    });
  };

  if (!enabled) return null;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-[13.5px] font-semibold leading-snug">
          <Printer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          Printers for this plan
        </CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          Enable machines and load matching filament in{" "}
          <Link to={settingsPrintersRoute()} className="underline underline-offset-2">
            Settings
          </Link>
          . Same-color parts pack onto the printer that has that spool loaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading printers…</p>
        ) : error ? (
          <p className="text-[12.5px] text-destructive">
            Could not load printers: {error instanceof Error ? error.message : String(error)}
          </p>
        ) : printers.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No printers yet —{" "}
            <Link to={settingsPrintersRoute()} className="underline underline-offset-2">
              add one in Settings
            </Link>{" "}
            before exporting 3MF.
          </p>
        ) : (
          <ul className="space-y-2">
            {printers.map((printer) => {
              const checked = treatAllAsEnabled || savedIds.includes(printer.id);
              const slots = printer.loaded_filaments ?? [];
              return (
                <li
                  key={printer.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={mutation.isPending}
                      onChange={(e) => onToggle(printer.id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium leading-snug">
                        {printer.name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {printer.bed_width_mm}×{printer.bed_depth_mm} mm
                        {slots.length
                          ? ` · ${slots.map(slotLabel).join(" · ")}`
                          : ""}
                      </span>
                    </span>
                  </label>
                  {checked ? (
                    <Badge variant="success" className="text-[10px]">
                      Used
                    </Badge>
                  ) : (
                    <Badge variant="muted" className="text-[10px]">
                      Off
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && data.plate_count > 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Estimated {data.plate_count} plate{data.plate_count === 1 ? "" : "s"}
            {data.warnings.length ? ` · ${data.warnings.length} warning(s)` : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
