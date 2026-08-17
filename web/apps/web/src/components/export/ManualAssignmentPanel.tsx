/**
 * Manual print-assignment override — surfaces the previously-dead
 * PUT /plans/:id/print-assignments endpoint (and its buildPrintGroupRows
 * groups, also unused until now) so a user can pin a specific filament +
 * source group to a specific printer instead of relying purely on
 * assignPartsToPrinters' automatic filament-slot matching.
 *
 * Reads from the same plate-workspace query PlatePreviewPanel uses (React
 * Query dedupes the two components against the one fetch); saving posts the
 * plan's *entire* group_assignments map back — the server route replaces it
 * wholesale — so an edit always spreads the previously-loaded map and only
 * overwrites the one key the user changed.
 */
import { useMemo } from "react";
import { toast } from "sonner";
import { ListTree } from "lucide-react";
import { usePlateWorkspaceQuery } from "../../queries/plateWorkspace";
import { useSavePrintAssignmentsMutation } from "../../queries/printAssignments";
import { guessSlicerForPrinterName } from "../../lib/printerSlicerGuess";
import { SLICER_LINKS } from "../../lib/slicerLinks";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type Props = {
  profileId: number | null;
  engineReady: boolean;
};

const AUTO_VALUE = "__auto__";

export default function ManualAssignmentPanel({ profileId, engineReady }: Props) {
  const enabled = engineReady && profileId != null;
  const { data, isLoading, error } = usePlateWorkspaceQuery(profileId, enabled);
  const mutation = useSavePrintAssignmentsMutation(profileId);

  const printers = useMemo(() => data?.printers ?? [], [data?.printers]);
  const groups = data?.groups ?? [];
  const currentAssignments = data?.plan?.group_assignments ?? {};

  const slicerByPrinterId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of printers) map.set(p.id, guessSlicerForPrinterName(p.name));
    return map;
  }, [printers]);

  const slicerLabel = (printerId: string): string => {
    const slicer = slicerByPrinterId.get(printerId);
    return SLICER_LINKS.find((l) => l.slicer === slicer)?.label ?? "";
  };

  const onAssign = (groupKey: string, printerId: string) => {
    if (profileId == null) return;
    const next = { ...currentAssignments };
    if (printerId === AUTO_VALUE) {
      delete next[groupKey];
    } else {
      next[groupKey] = printerId;
    }
    mutation.mutate(next, {
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      onSuccess: () => {
        toast.success(
          printerId === AUTO_VALUE
            ? "Reverted to automatic printer assignment"
            : "Print assignment updated",
        );
      },
    });
  };

  if (!enabled) return null;
  if (!isLoading && !error && groups.length === 0) return null;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-[13.5px] font-semibold leading-snug">
          <ListTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          Printer assignment
        </CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          Override which printer (and slicer) each filament/source group is packed onto. Leave on
          Auto to use PP&apos;s automatic filament-slot matching.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading groups…</p>
        ) : error ? (
          <p className="text-[12.5px] text-destructive">
            Could not load print groups: {error instanceof Error ? error.message : String(error)}
          </p>
        ) : printers.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No printers configured yet — add one in Settings to assign groups.
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((group) => {
              const assignedId = currentAssignments[group.group_key] ?? AUTO_VALUE;
              return (
                <li
                  key={group.group_key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium leading-snug">
                      {group.label}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>
                        {group.part_count} part{group.part_count === 1 ? "" : "s"}
                      </span>
                      {group.suggested_printer_name ? (
                        <span>· suggested: {group.suggested_printer_name}</span>
                      ) : null}
                      {group.warning ? (
                        <Badge variant="warning" className="text-[10px] font-normal">
                          {group.warning}
                        </Badge>
                      ) : null}
                      {currentAssignments[group.group_key] ? (
                        <Badge variant="info" className="text-[10px] font-normal">
                          manually assigned
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <Select
                    value={assignedId}
                    onValueChange={(value) => onAssign(group.group_key, value)}
                    disabled={mutation.isPending}
                  >
                    <SelectTrigger className="h-8 w-56 shrink-0 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_VALUE}>Auto (recommended)</SelectItem>
                      {printers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {slicerLabel(p.id) ? ` · ${slicerLabel(p.id)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
