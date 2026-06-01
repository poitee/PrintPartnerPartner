const JOB_KIND_LABELS: Record<string, string> = {
  recompute: "Recompute",
  "export-3mf": "Export 3MF",
  export: "Export",
  "pack-preview": "Pack preview",
  kit: "Kit bundle",
  "stl-export": "STL export",
  sync: "Sync",
  scan: "Import scan",
  job: "Background job",
};

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind] ?? kind.replace(/-/g, " ");
}
