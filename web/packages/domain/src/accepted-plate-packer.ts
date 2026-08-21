export type AcceptedPlatePrinterGeometry = Readonly<{
  bedWidthUm: number;
  bedDepthUm: number;
  bedHeightUm: number;
  marginUm: number;
}>;

export type AcceptedPackingUnit = Readonly<{
  token: string;
  widthUm: number;
  depthUm: number;
  heightUm: number;
}>;

export type AcceptedPackedUnit = AcceptedPackingUnit & Readonly<{
  xUm: number;
  yUm: number;
}>;

export type PackAcceptedUnitsResult =
  | {
      readonly kind: "packed";
      readonly plates: readonly Readonly<{ units: readonly AcceptedPackedUnit[] }>[];
    }
  | { readonly kind: "unit_too_large"; readonly token: string };

function compareUnits(left: AcceptedPackingUnit, right: AcceptedPackingUnit): number {
  const longest = Math.max(right.widthUm, right.depthUm) - Math.max(left.widthUm, left.depthUm);
  if (longest !== 0) return longest;
  const leftArea = BigInt(left.widthUm) * BigInt(left.depthUm);
  const rightArea = BigInt(right.widthUm) * BigInt(right.depthUm);
  if (rightArea !== leftArea) return rightArea > leftArea ? 1 : -1;
  return left.token < right.token ? -1 : left.token > right.token ? 1 : 0;
}

export function packAcceptedUnits(input: Readonly<{
  printer: AcceptedPlatePrinterGeometry;
  units: readonly AcceptedPackingUnit[];
}>): PackAcceptedUnitsResult {
  const { printer } = input;
  const usableWidth = printer.bedWidthUm - 2 * printer.marginUm;
  const usableDepth = printer.bedDepthUm - 2 * printer.marginUm;
  const units = [...input.units].sort(compareUnits);

  for (const unit of units) {
    if (
      unit.widthUm > usableWidth ||
      unit.depthUm > usableDepth ||
      unit.heightUm > printer.bedHeightUm
    ) {
      return { kind: "unit_too_large", token: unit.token };
    }
  }

  const plates: Array<{ units: AcceptedPackedUnit[] }> = [];
  let current: AcceptedPackedUnit[] = [];
  let xUm = printer.marginUm;
  let yUm = printer.marginUm;
  let rowDepthUm = 0;

  const flush = () => {
    if (current.length === 0) return;
    plates.push({ units: current });
    current = [];
    xUm = printer.marginUm;
    yUm = printer.marginUm;
    rowDepthUm = 0;
  };

  for (const unit of units) {
    if (xUm > printer.marginUm && xUm + unit.widthUm > printer.bedWidthUm - printer.marginUm) {
      xUm = printer.marginUm;
      yUm += rowDepthUm + printer.marginUm;
      rowDepthUm = 0;
    }
    if (yUm + unit.depthUm > printer.bedDepthUm - printer.marginUm) flush();
    current.push({ ...unit, xUm, yUm });
    xUm += unit.widthUm + printer.marginUm;
    rowDepthUm = Math.max(rowDepthUm, unit.depthUm);
  }
  flush();
  return { kind: "packed", plates };
}
