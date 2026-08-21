import { describe, expect, it } from "vitest";
import { packAcceptedUnits } from "./accepted-plate-packer.js";

describe("packAcceptedUnits", () => {
  it("uses integer rows with a fixed gap and deterministic unit order", () => {
    const result = packAcceptedUnits({
      printer: {
        bedWidthUm: 120,
        bedDepthUm: 100,
        bedHeightUm: 80,
        marginUm: 10,
      },
      units: [
        { token: "c", widthUm: 30, depthUm: 20, heightUm: 10 },
        { token: "a", widthUm: 50, depthUm: 30, heightUm: 10 },
        { token: "b", widthUm: 40, depthUm: 40, heightUm: 10 },
      ],
    });

    expect(result).toEqual({
      kind: "packed",
      plates: [
        {
          units: [
            { token: "a", widthUm: 50, depthUm: 30, heightUm: 10, xUm: 10, yUm: 10 },
            { token: "b", widthUm: 40, depthUm: 40, heightUm: 10, xUm: 70, yUm: 10 },
            { token: "c", widthUm: 30, depthUm: 20, heightUm: 10, xUm: 10, yUm: 60 },
          ],
        },
      ],
    });
  });

  it("does not rotate a unit to make it fit", () => {
    expect(packAcceptedUnits({
      printer: {
        bedWidthUm: 100,
        bedDepthUm: 140,
        bedHeightUm: 80,
        marginUm: 10,
      },
      units: [{ token: "wide", widthUm: 100, depthUm: 70, heightUm: 10 }],
    })).toEqual({ kind: "unit_too_large", token: "wide" });
  });

  it("splits rows across stable local Plate order", () => {
    const result = packAcceptedUnits({
      printer: {
        bedWidthUm: 100,
        bedDepthUm: 100,
        bedHeightUm: 80,
        marginUm: 10,
      },
      units: [
        { token: "a", widthUm: 70, depthUm: 70, heightUm: 10 },
        { token: "b", widthUm: 70, depthUm: 70, heightUm: 10 },
      ],
    });

    expect(result).toMatchObject({
      kind: "packed",
      plates: [
        { units: [{ token: "a", xUm: 10, yUm: 10 }] },
        { units: [{ token: "b", xUm: 10, yUm: 10 }] },
      ],
    });
  });
});
