/**
 * Plate group card — one packed plate from the pack preview.
 *
 * Shows the plate's group label (what the active grouping strategy bucketed
 * it by), a height-band badge, and the parts placed on it. The height band
 * comes from `height_band` on each PlateFootprint, classified server-side by
 * classifyHeightBand() at pack time — see lib/plateHeightBand.ts.
 *
 * Under the Height Band strategy every plate is uniform and the badge names
 * that one band; under Location the plate can span bands and the badge reads
 * "Flat–Tall", which is the mixed-height case the >2× variance pack warning
 * also fires on.
 */

import { Layers, Ruler } from "lucide-react";
import type { PlatePreview } from "../../api/engine";
import { itemHeightBandBadge, plateHeightBandSummary } from "../../lib/plateHeightBand";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";

type Props = {
  plate: PlatePreview;
  /** Printer this plate is packed for, shown as context in the header. */
  printerName?: string;
  /** Show a per-part band badge in the parts list. Off by default (header badge is the summary). */
  showItemBands?: boolean;
  className?: string;
};

export default function PlateGroupCard({
  plate,
  printerName,
  showItemBands = false,
  className,
}: Props) {
  const band = plateHeightBandSummary(plate.items);
  const itemCount = plate.items.length;

  return (
    <Card className={cn("border-border shadow-sm", className)}>
      <CardHeader className="gap-1.5 pb-2 pt-3">
        <CardTitle level={4} className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold leading-snug">
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Plate {plate.index}
            {plate.group_label ? ` · ${plate.group_label}` : ""}
          </span>
          <Badge
            variant={band.variant}
            icon={Ruler}
            title={band.title}
            className="shrink-0 text-[10.5px] font-normal"
          >
            {band.label}
          </Badge>
        </CardTitle>
        <p className="text-[11.5px] text-muted-foreground">
          {itemCount} part{itemCount === 1 ? "" : "s"}
          {printerName ? ` · ${printerName}` : ""}
          {band.mixed ? " · mixed heights" : ""}
        </p>
      </CardHeader>

      <CardContent className="pt-0">
        {itemCount === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">No parts placed on this plate.</p>
        ) : (
          <ul className="space-y-0.5">
            {plate.items.map((item) => {
              const itemBand = itemHeightBandBadge(item);
              return (
                <li
                  key={`${item.match_key}-${item.unit}`}
                  className="flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate font-mono" title={item.filename}>
                    {item.filename.replace(/\.stl$/i, "")}
                  </span>
                  <span className="shrink-0 tabular-nums" title={`${item.height_mm} mm tall`}>
                    {item.height_mm.toFixed(1)} mm
                  </span>
                  {showItemBands ? (
                    <Badge
                      variant={itemBand.variant}
                      title={itemBand.title}
                      className="shrink-0 text-[10px] font-normal"
                    >
                      {itemBand.label}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
