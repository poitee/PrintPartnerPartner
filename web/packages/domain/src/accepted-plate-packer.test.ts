import { describe, expect, it } from "vitest";
import { arrangeAcceptedUnits, packAcceptedUnits } from "./accepted-plate-packer.js";

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

describe("arrangeAcceptedUnits", () => {
  const printer = {
    bedWidthUm: 120,
    bedDepthUm: 100,
    bedHeightUm: 80,
    marginUm: 10,
  };

  it("keeps a pinned unit still while Arrange unplaced fills remaining space", () => {
    const pinned = {
      token: "a",
      widthUm: 50,
      depthUm: 30,
      heightUm: 10,
      xUm: 40,
      yUm: 40,
      placement: "pinned" as const,
    };
    const result = arrangeAcceptedUnits({
      mode: "unplaced",
      printer,
      units: [
        pinned,
        {
          token: "c",
          widthUm: 30,
          depthUm: 20,
          heightUm: 10,
          xUm: 10,
          yUm: 10,
          placement: "auto",
        },
      ],
    });
    expect(result.kind).toBe("packed");
    if (result.kind !== "packed") return;
    const first = result.plates[0]?.units ?? [];
    expect(first.find((unit) => unit.token === "a")).toMatchObject({ xUm: 40, yUm: 40 });
    const placedC = result.plates.flatMap((plate) => plate.units).find((unit) => unit.token === "c");
    expect(placedC).toBeDefined();
    expect(placedC).not.toMatchObject({ xUm: 40, yUm: 40 });
  });

  it("lets Arrange all replace the current layout including pinned coordinates", () => {
    const result = arrangeAcceptedUnits({
      mode: "all",
      printer,
      units: [{
        token: "a",
        widthUm: 50,
        depthUm: 30,
        heightUm: 10,
        xUm: 40,
        yUm: 40,
        placement: "pinned",
      }, {
        token: "c",
        widthUm: 30,
        depthUm: 20,
        heightUm: 10,
        xUm: 70,
        yUm: 10,
        placement: "manual",
      }],
    });
    expect(result).toEqual({
      kind: "packed",
      plates: [{
        units: [
          { token: "a", widthUm: 50, depthUm: 30, heightUm: 10, xUm: 10, yUm: 10 },
          { token: "c", widthUm: 30, depthUm: 20, heightUm: 10, xUm: 70, yUm: 10 },
        ],
      }],
    });
  });
});
