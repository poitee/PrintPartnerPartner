/**
 * Plate preview panel — the packed plates for the active plan, one
 * PlateGroupCard per plate, with the grouping-strategy switch that re-packs
 * them.
 *
 * This is the surface that makes height bands visible: the server classifies
 * every part at pack time (classifyHeightBand in plate-packer.ts) and returns
 * `height_band` on each placed item, which each card summarises into a badge.
 * Switching strategy saves the plan and refetches, so the badges follow the
 * new packing; changing the plan's parts invalidates the same query.
 */

import { useMemo } from "react";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import type { GroupingStrategy } from "../../api/engine";
import {
  useGroupingStrategyMutation,
  usePlateWorkspaceQuery,
} from "../../queries/plateWorkspace";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { SegmentedControl } from "../ui/segmented-control";
import PlateGroupCard from "./PlateGroupCard";

type Props = {
  profileId: number | null;
  engineReady: boolean;
};

const STRATEGY_OPTIONS: Array<{ value: GroupingStrategy; label: string; title: string }> = [
  {
    value: "location",
    label: "Location",
    title: "Group plates by filament + source repo/folder",
  },
  {
    value: "height_band",
    label: "Height band",
    title: "Group plates by part height band (flat → very tall)",
  },
];

export default function PlatePreviewPanel({ profileId, engineReady }: Props) {
  const enabled = engineReady && profileId != null;
  const { data, isLoading, error } = usePlateWorkspaceQuery(profileId, enabled);
  const strategyMutation = useGroupingStrategyMutation(profileId);

  const strategy: GroupingStrategy = data?.plan?.grouping_strategy ?? "location";

  /** Flatten printer → plates so each card can name its printer. */
  const plates = useMemo(() => {
    if (!data) return [];
    return data.preview.flatMap((bed) =>
      bed.plates.map((plate) => ({ plate, printerId: bed.printer_id })),
    );
  }, [data]);

  const printerName = useMemo(() => {
    const byId = new Map((data?.printers ?? []).map((p) => [p.id, p.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [data?.printers]);

  const onStrategyChange = (next: GroupingStrategy) => {
    if (next === strategy || profileId == null) return;
    strategyMutation.mutate(next, {
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    });
  };

  if (!enabled) return null;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="gap-2 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-[13.5px] font-semibold leading-snug">
              <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              Plates
              {data ? (
                <Badge variant="muted" className="font-mono text-[10.5px] font-normal">
                  {data.plate_count}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="text-[12.5px] leading-relaxed">
              How parts are packed onto plates. Each plate shows its height band.
            </CardDescription>
          </div>
          <SegmentedControl
            aria-label="Plate grouping strategy"
            value={strategy}
            onValueChange={onStrategyChange}
            options={STRATEGY_OPTIONS}
            className="shrink-0"
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-1">
        {data?.warnings?.length ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-2">
            <p className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-warning">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              {data.warnings.length} pack warning{data.warnings.length === 1 ? "" : "s"}
            </p>
            <ul className="space-y-0.5 pl-4">
              {data.warnings.slice(0, 5).map((w) => (
                <li key={w} className="text-[10.5px] text-warning/80">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Packing plates…</p>
        ) : error ? (
          <p className="text-[12.5px] text-destructive">
            Could not load plates: {error instanceof Error ? error.message : String(error)}
          </p>
        ) : plates.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No plates yet — assign parts to a printer to see the packed plates here.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {plates.map(({ plate, printerId }) => (
              <PlateGroupCard
                key={`${printerId}-${plate.index}`}
                plate={plate}
                printerName={printerName(printerId)}
                showItemBands={strategy === "location"}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
