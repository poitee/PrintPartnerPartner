/**
 * Result panel for the auto-slice job: one card per plate showing the slicer
 * thumbnail the sidecar returned, which slicer produced it, and a download for
 * the stored gcode.
 *
 * This is where a slice failure becomes visible rather than only a toast that
 * scrolls away: a failed plate keeps its slot and shows the sidecar's error
 * plus the slicer CLI's captured stderr, which is the only place the real cause
 * ("unknown config option …") is stated.
 */

import { AlertTriangle, Download, ImageOff } from "lucide-react";
import { downloadExport, engineAssetUrl, type AutoSliceJobResultBody } from "../../api/engine";
import { slicerLabel } from "../../lib/autoSliceJobResult";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type Props = {
  result: AutoSliceJobResultBody | null;
};

export default function SlicedPlatesPanel({ result }: Props) {
  if (!result || !result.plates.length) return null;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-[13.5px] font-semibold leading-snug">Sliced plates</CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          {result.plate_count} of {result.attempted_count} plate(s) sliced. G-code and thumbnails
          are saved in the plan&apos;s export folder.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {result.plates.map((plate) => {
          const failed = plate.status === "error";
          return (
            <div
              key={`${plate.printer_id}-${plate.plate_index}`}
              className="flex gap-3 rounded-md border border-border p-2.5"
            >
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                {plate.thumbnail_url ? (
                  <img
                    src={engineAssetUrl(plate.thumbnail_url)}
                    alt={`Plate ${plate.plate_index} preview`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold leading-snug">
                    Plate {plate.plate_index}
                  </span>
                  <Badge
                    variant="muted"
                    className="rounded-full px-2 py-0.5 font-mono text-[10.5px] font-normal"
                  >
                    {slicerLabel(plate.slicer)}
                  </Badge>
                </div>
                <span className="truncate text-[11.5px] text-muted-foreground">
                  {plate.printer_name}
                </span>

                {failed ? (
                  <div className="space-y-1">
                    <p className="flex items-start gap-1 text-[11.5px] text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 break-words">
                        {plate.error ?? "Slicing failed"}
                      </span>
                    </p>
                    {plate.stderr ? (
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted p-1.5 font-mono text-[10px] leading-snug text-muted-foreground">
                        {plate.stderr}
                      </pre>
                    ) : null}
                  </div>
                ) : plate.download_url ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-auto w-fit gap-1"
                    onClick={() => downloadExport(plate.download_url!)}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    G-code
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
