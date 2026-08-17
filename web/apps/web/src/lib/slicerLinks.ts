/**
 * Direct links to the running slicer GUIs so a user can open a slicer (to
 * inspect a plate, tweak a setting, or watch a slice run) without leaving
 * Print Partner.
 *
 * These are fixed local hostnames for the self-hosted slicer containers —
 * not something PP discovers at runtime, so there is no server endpoint for
 * them. If the deployment's hostnames ever change, update this list.
 */
export type SlicerKind = "orca" | "prusa" | "bambu";

export type SlicerLink = {
  slicer: SlicerKind;
  label: string;
  url: string;
  hint: string;
};

export const SLICER_LINKS: SlicerLink[] = [
  {
    slicer: "orca",
    label: "OrcaSlicer",
    url: "https://orca.home",
    hint: "Klipper / Voron plates route here",
  },
  {
    slicer: "prusa",
    label: "PrusaSlicer",
    url: "https://prusa.home",
    hint: "Prusa XL plates route here",
  },
  {
    slicer: "bambu",
    label: "BambuStudio",
    url: "https://bambu.home",
    hint: "Bambu plates route here",
  },
];
