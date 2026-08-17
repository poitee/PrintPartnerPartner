/**
 * Open-the-slicer buttons — SLICER_LINKS rendered as external links so the
 * user can see and interact with the running slicer GUIs (OrcaSlicer,
 * PrusaSlicer, BambuStudio) without leaving Print Partner.
 *
 * Each slicer runs as its own always-on container (see docker-media-stack);
 * PP never embeds them, it only opens a new tab to the host's own web UI.
 */
import { ExternalLink } from "lucide-react";
import { SLICER_LINKS } from "../../lib/slicerLinks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";

export default function SlicerLinksPanel() {
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="text-[13.5px] font-semibold leading-snug">Open a slicer</CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          Jump into the running slicer GUI to inspect or tweak a plate directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 pt-0">
        {SLICER_LINKS.map((link) => (
          <Button key={link.slicer} variant="outline" size="sm" asChild className="gap-1.5" title={link.hint}>
            <a href={link.url} target="_blank" rel="noreferrer noopener">
              {link.label}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
