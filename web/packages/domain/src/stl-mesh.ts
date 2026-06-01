import { readFileSync } from "node:fs";
import type { StlBounds } from "./stl-bounds.js";

export type StlMesh = {
  vertices: Array<[number, number, number]>;
  faces: Array<[number, number, number]>;
  bounds: StlBounds;
};

function parseAsciiStlMesh(text: string): StlMesh | null {
  const vertices: Array<[number, number, number]> = [];
  const faces: Array<[number, number, number]> = [];
  const vertexRe = /vertex\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)/g;
  let match: RegExpExecArray | null;
  while ((match = vertexRe.exec(text)) !== null) {
    vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    faces.push([i, i + 1, i + 2]);
  }
  if (!faces.length) return null;
  const bounds = readStlBoundsFromVertices(vertices);
  return { vertices, faces, bounds };
}

function readStlBoundsFromVertices(vertices: Array<[number, number, number]>): StlBounds {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
    widthMm: 0,
    depthMm: 0,
    heightMm: 0,
  };
  for (const [x, y, z] of vertices) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  bounds.widthMm = bounds.maxX - bounds.minX;
  bounds.depthMm = bounds.maxY - bounds.minY;
  bounds.heightMm = bounds.maxZ - bounds.minZ;
  return bounds;
}

function parseBinaryStlMesh(buf: Buffer): StlMesh | null {
  if (buf.length < 84) return null;
  const triCount = buf.readUInt32LE(80);
  const expected = 84 + triCount * 50;
  if (buf.length < expected) return null;
  const vertices: Array<[number, number, number]> = [];
  const faces: Array<[number, number, number]> = [];
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12;
    const base = vertices.length;
    for (let v = 0; v < 3; v++) {
      vertices.push([
        buf.readFloatLE(offset),
        buf.readFloatLE(offset + 4),
        buf.readFloatLE(offset + 8),
      ]);
      offset += 12;
    }
    faces.push([base, base + 1, base + 2]);
    offset += 2;
  }
  if (!faces.length) return null;
  return { vertices, faces, bounds: readStlBoundsFromVertices(vertices) };
}

export function loadStlMesh(stlPath: string): StlMesh | null {
  const buf = readFileSync(stlPath);
  const header = buf.subarray(0, 80).toString("utf8", 0, 80).trim().toLowerCase();
  if (header.startsWith("solid")) {
    const ascii = parseAsciiStlMesh(buf.toString("utf8"));
    if (ascii) return ascii;
  }
  return parseBinaryStlMesh(buf);
}

export function translateMesh(
  mesh: StlMesh,
  dx: number,
  dy: number,
  dz: number,
): StlMesh {
  const vertices = mesh.vertices.map(
    ([x, y, z]) => [x + dx, y + dy, z + dz] as [number, number, number],
  );
  return {
    vertices,
    faces: mesh.faces.map((f) => [...f] as [number, number, number]),
    bounds: readStlBoundsFromVertices(vertices),
  };
}

/** Place mesh on bed: min corner at (x, y, 0). */
export function placeMeshOnBed(mesh: StlMesh, xMm: number, yMm: number): StlMesh {
  const dx = xMm - mesh.bounds.minX;
  const dy = yMm - mesh.bounds.minY;
  const dz = -mesh.bounds.minZ;
  return translateMesh(mesh, dx, dy, dz);
}
