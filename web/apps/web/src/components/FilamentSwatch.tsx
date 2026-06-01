import type { CatalogColor, FilamentCatalog } from "../api/engine";

type Props = {
  hex?: string | null;
  label?: string;
  className?: string;
};

export function allCatalogColors(catalog: FilamentCatalog | null): CatalogColor[] {
  if (!catalog) return [];
  return [...catalog.colors, ...catalog.custom_colors];
}

export default function FilamentSwatch({ hex, label, className }: Props) {
  const style = hex ? { backgroundColor: hex } : undefined;
  return (
    <span
      className={`filament-swatch inline-block h-4 w-4 shrink-0 rounded border border-border ${className ?? ""}`}
      style={style}
      title={label ?? hex ?? "No filament color"}
      aria-hidden={!label}
    />
  );
}
