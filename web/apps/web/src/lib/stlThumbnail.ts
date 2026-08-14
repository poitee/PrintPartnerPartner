import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { partMeshUrl, uploadPartThumbnail } from "../api/engine";
import { fetchWithRetry } from "./fetchWithRetry";

const SIZE = 256;
const MESH_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_COLOR = "#c41230";
/** Cap in-memory STL buffers so color re-renders skip network + parse. */
const MESH_CACHE_MAX = 48;

let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedLoader: STLLoader | null = null;

type CachedMesh = {
  buffer: ArrayBuffer;
  lastUsed: number;
};

const meshBufferCache = new Map<number, CachedMesh>();

/**
 * One reused WebGL context for ALL thumbnails — browsers cap live contexts
 * (~16), so rendering 145 part cards each needs its own canvas would fail. We
 * render sequentially into a single offscreen canvas and read it to a PNG blob.
 */
function getRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    sharedRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    sharedRenderer.setPixelRatio(1);
    sharedRenderer.setSize(SIZE, SIZE, false);
  }
  return sharedRenderer;
}

function rememberMeshBuffer(partId: number, buffer: ArrayBuffer): void {
  meshBufferCache.set(partId, { buffer, lastUsed: Date.now() });
  if (meshBufferCache.size <= MESH_CACHE_MAX) return;
  let oldestId: number | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [id, entry] of meshBufferCache) {
    if (entry.lastUsed < oldestAt) {
      oldestAt = entry.lastUsed;
      oldestId = id;
    }
  }
  if (oldestId != null) meshBufferCache.delete(oldestId);
}

function cachedMeshBuffer(partId: number): ArrayBuffer | null {
  const hit = meshBufferCache.get(partId);
  if (!hit) return null;
  hit.lastUsed = Date.now();
  return hit.buffer;
}

function renderBufferToBlob(buffer: ArrayBuffer, hex: string): Promise<Blob | null> {
  const renderer = getRenderer();
  const loader = (sharedLoader ??= new STLLoader());
  const geometry = loader.parse(buffer);
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const dims = new THREE.Vector3();
  geometry.boundingBox?.getSize(dims);
  const maxDim = Math.max(dims.x, dims.y, dims.z, 1);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex || DEFAULT_COLOR),
    metalness: 0.15,
    roughness: 0.65,
  });
  const mesh = new THREE.Mesh(geometry, material);

  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(1, 1.2, 0.8);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-0.8, 0.4, -1);
  scene.add(key, fill);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, maxDim * 20);
  camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.6);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);

  return new Promise((resolve) => {
    renderer.domElement.toBlob((blob) => {
      geometry.dispose();
      material.dispose();
      resolve(blob);
    }, "image/png");
  });
}

// Serialize render work; the single renderer cannot run two renders at once.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Read a response body with a hard byte budget so oversized meshes never
 * materialize in memory. Rejects when Content-Length exceeds the cap before
 * reading; for chunked bodies, aborts once the budget is exhausted.
 */
async function readResponseBounded(
  res: Response,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const declared = res.headers.get("content-length");
  if (declared != null) {
    const n = Number(declared);
    if (Number.isFinite(n) && (n <= 0 || n > maxBytes)) return null;
  }

  if (!res.body) {
    // Fallback for environments without streams — still check length after.
    try {
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;
      return buffer;
    } catch {
      return null;
    }
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  if (total === 0) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function loadMeshBuffer(partId: number): Promise<ArrayBuffer | null> {
  const cached = cachedMeshBuffer(partId);
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetchWithRetry(() => partMeshUrl(partId));
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buffer = await readResponseBounded(res, MESH_MAX_BYTES);
  if (!buffer) return null;
  rememberMeshBuffer(partId, buffer);
  return buffer;
}

/**
 * Fetch a part's STL mesh (or reuse an in-memory buffer), render a color-accurate
 * isometric PNG, upload it to warm the server cache, and return an object URL.
 * Color changes skip the network when the mesh buffer is already cached.
 */
export function generatePartThumbnail(
  partId: number,
  hex: string | null | undefined,
): Promise<string | null> {
  return enqueue(async () => {
    const buffer = await loadMeshBuffer(partId);
    if (!buffer) return null;
    let blob: Blob | null;
    try {
      blob = await renderBufferToBlob(buffer, hex ?? DEFAULT_COLOR);
    } catch {
      return null;
    }
    if (!blob) return null;
    void uploadPartThumbnail(partId, blob).catch(() => {});
    return URL.createObjectURL(blob);
  });
}
