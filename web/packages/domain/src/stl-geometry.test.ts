import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStlBounds } from "./stl-bounds.js";
import { loadStlMesh } from "./stl-mesh.js";

describe("STL bounds and mesh integrity", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function writeFixture(name: string, contents: string | Buffer): string {
    const dir = mkdtempSync(join(tmpdir(), "pp-stl-integrity-"));
    dirs.push(dir);
    const path = join(dir, name);
    writeFileSync(path, contents);
    return path;
  }

  it("computes matching finite bounds for signed and exponential ASCII coordinates", () => {
    const path = writeFixture(
      "valid.stl",
      `solid valid
facet normal 0 0 1
outer loop
vertex -1.5 2e0 -3
vertex 4.5 2 1
vertex 0 -2.5 5e0
endloop
endfacet
endsolid valid`,
    );

    const expected = {
      minX: -1.5,
      minY: -2.5,
      minZ: -3,
      maxX: 4.5,
      maxY: 2,
      maxZ: 5,
      widthMm: 6,
      depthMm: 4.5,
      heightMm: 8,
    };
    expect(readStlBounds(path)).toEqual(expected);
    expect(loadStlMesh(path)?.bounds).toEqual(expected);
  });

  it("rejects ASCII input with an incomplete trailing triangle", () => {
    const path = writeFixture(
      "partial.stl",
      `solid partial
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
vertex 999 999 999
endsolid partial`,
    );

    expect(readStlBounds(path)).toBeNull();
    expect(loadStlMesh(path)).toBeNull();
  });

  it("rejects non-finite ASCII coordinates instead of returning poisoned bounds", () => {
    const path = writeFixture(
      "infinite.stl",
      `solid infinite
vertex 0 0 0
vertex 1e999 0 0
vertex 0 1 0
endsolid infinite`,
    );

    expect(readStlBounds(path)).toBeNull();
    expect(loadStlMesh(path)).toBeNull();
  });

  it("rejects non-finite binary coordinates", () => {
    const path = writeFixture(
      "non-finite-binary.stl",
      binaryStl([
        [0, 0, 0],
        [Number.NaN, 1, 0],
        [0, 0, Number.POSITIVE_INFINITY],
      ]),
    );

    expect(readStlBounds(path)).toBeNull();
    expect(loadStlMesh(path)).toBeNull();
  });

  it("falls back to binary parsing when a binary header starts with solid", () => {
    const path = writeFixture(
      "solid-header-binary.stl",
      binaryStl(
        [
          [-2, 0, 1],
          [3, 0, 1],
          [0, 4, 6],
        ],
        "solid but binary",
      ),
    );

    expect(readStlBounds(path)).toMatchObject({
      minX: -2,
      maxX: 3,
      maxY: 4,
      minZ: 1,
      maxZ: 6,
    });
    expect(loadStlMesh(path)?.faces).toEqual([[0, 1, 2]]);
  });
});

function binaryStl(
  vertices: [[number, number, number], [number, number, number], [number, number, number]],
  header = "binary fixture",
): Buffer {
  const buffer = Buffer.alloc(84 + 50);
  buffer.write(header, 0, "ascii");
  buffer.writeUInt32LE(1, 80);
  let offset = 84 + 12;
  for (const [x, y, z] of vertices) {
    buffer.writeFloatLE(x, offset);
    buffer.writeFloatLE(y, offset + 4);
    buffer.writeFloatLE(z, offset + 8);
    offset += 12;
  }
  buffer.writeUInt16LE(0, offset);
  return buffer;
}
