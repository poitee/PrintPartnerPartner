import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { partMeshUrl, uploadPartThumbnail } from "../api/engine.js";
import { fetchWithRetry } from "./fetchWithRetry.js";
import { getCachedMeshBuffer, cacheMeshBuffer } from "./meshCache.js";

const SIZE = 256;
const MESH_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_COLOR = "#c41230";
/** Cap in-memory STL buffers so color re-renders skip network + parse. */
const MESH_CACHE_MAX = 48;
/** Cap in-memory rendered blobs by (partId:hex). */
const BLOB_CACHE_MAX = 96;
/** Max vertices before we decimate for preview rendering. */
const DECIMATE_THRESHOLD = 80_000;
/** Max fetch attempts with exponential backoff. */
const MAX_FETCH_ATTEMPTS = 3;

// ─── Shared WebGL renderer ────────────────────────────────────────────────────

let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedLoader: STLLoader | null = null;

type CachedMesh = {
  buffer: ArrayBuffer;
  lastUsed: number;
};

const meshBufferCache = new Map<number, CachedMesh>();

/**
 * One reused WebGL context for ALL thumbnails — browsers cap live contexts
 * (~16), so rendering 145 part cards each needs its own canvas would fail.
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

// ─── In-memory mesh buffer cache ─────────────────────────────────────────────

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

// ─── Fix #3: Blob cache by (partId, hex) ─────────────────────────────────────
// Reuses already-rendered PNG blobs without re-parsing STL or re-rendering.
// When a color changes, only parts with that new hex miss the cache; all others
// return instantly from memory.

type BlobEntry = { blob: Blob; lastUsed: number };
const blobCache = new Map<string, BlobEntry>();

function blobCacheKey(partId: number, hex: string): string {
  return `${partId}:${hex.toLowerCase().replace(/^#/, "")}`;
}

function getCachedBlob(partId: number, hex: string): Blob | null {
  const entry = blobCache.get(blobCacheKey(partId, hex));
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry.blob;
}

function rememberBlob(partId: number, hex: string, blob: Blob): void {
  blobCache.set(blobCacheKey(partId, hex), { blob, lastUsed: Date.now() });
  if (blobCache.size <= BLOB_CACHE_MAX) return;
  // Evict LRU entry
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, entry] of blobCache) {
    if (entry.lastUsed < oldestAt) {
      oldestAt = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey != null) blobCache.delete(oldestKey);
}

// ─── Fix #4: Mesh optimization (vertex decimation) ───────────────────────────
// For large meshes (>80k vertices) we thin the geometry before rendering so the
// browser doesn't choke on 200k+ vertex STLs. Quality is still fine at 256×256.

function decimateGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.getAttribute("position");
  if (!pos || pos.count <= DECIMATE_THRESHOLD) return geometry;

  // Keep every Nth vertex to reach ~DECIMATE_THRESHOLD
  const step = Math.ceil(pos.count / DECIMATE_THRESHOLD);
  const kept = Math.floor(pos.count / step);
  const newPos = new Float32Array(kept * 3);
  for (let i = 0; i < kept; i++) {
    newPos[i * 3 + 0] = (pos as THREE.BufferAttribute).getX(i * step);
    newPos[i * 3 + 1] = (pos as THREE.BufferAttribute).getY(i * step);
    newPos[i * 3 + 2] = (pos as THREE.BufferAttribute).getZ(i * step);
  }
  const slim = new THREE.BufferGeometry();
  slim.setAttribute("position", new THREE.BufferAttribute(newPos, 3));
  return slim;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderBufferToBlob(buffer: ArrayBuffer, hex: string): Promise<Blob | null> {
  const renderer = getRenderer();
  const loader = (sharedLoader ??= new STLLoader());
  let geometry = loader.parse(buffer);
  geometry = decimateGeometry(geometry); // Fix #4
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

// ─── Fix #1: Concurrent render queue ─────────────────────────────────────────

class RenderQueue {
  private pending: Array<{
    task: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    priority: number;
  }> = [];
  private active = 0;
  private readonly maxConcurrent = 4;

  enqueue<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        task: task as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        priority,
      });
      // Fix #6: higher priority tasks run first
      this.pending.sort((a, b) => b.priority - a.priority);
      this.process();
    });
  }

  private process() {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const item = this.pending.shift();
      if (!item) break;
      this.active++;
      item
        .task()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active--;
          this.process();
        });
    }
  }
}

const renderQueue = new RenderQueue();

// ─── Bounded response reader ──────────────────────────────────────────────────

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

// ─── Fix #5: Mesh loader with exponential backoff retry ──────────────────────

async function loadMeshBuffer(partId: number): Promise<ArrayBuffer | null> {
  // Tier 1: in-memory cache (instant)
  const memCached = cachedMeshBuffer(partId);
  if (memCached) return memCached;

  // Tier 2: IndexedDB cache (persistent across sessions)
  const dbCached = await getCachedMeshBuffer(partId);
  if (dbCached) {
    rememberMeshBuffer(partId, dbCached);
    return dbCached;
  }

  // Tier 3: network with exponential backoff retry
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1000ms, 2000ms…
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
    let res: Response;
    try {
      res = await fetchWithRetry(() => partMeshUrl(partId));
    } catch {
      continue; // retry
    }
    if (!res.ok) {
      if (res.status === 404) return null; // no point retrying 404
      continue;
    }
    const buffer = await readResponseBounded(res, MESH_MAX_BYTES);
    if (!buffer) continue;

    rememberMeshBuffer(partId, buffer);
    void cacheMeshBuffer(partId, buffer).catch(() => {});
    return buffer;
  }

  return null; // all retries exhausted
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a color-accurate isometric thumbnail for a part.
 *
 * Priority bumps visible parts ahead of off-screen parts in the queue.
 * Blob cache (Fix #3) means color changes skip re-parsing for already-rendered
 * (partId, hex) combinations.
 */
export function generatePartThumbnail(
  partId: number,
  hex: string | null | undefined,
  options?: { priority?: number },
): Promise<string | null> {
  const resolvedHex = hex ?? DEFAULT_COLOR;

  return renderQueue.enqueue(async () => {
    // Fix #3: return cached blob without touching the network or GPU
    const cachedBlob = getCachedBlob(partId, resolvedHex);
    if (cachedBlob) {
      return URL.createObjectURL(cachedBlob);
    }

    const buffer = await loadMeshBuffer(partId);
    if (!buffer) return null;

    let blob: Blob | null;
    try {
      blob = await renderBufferToBlob(buffer, resolvedHex);
    } catch {
      return null;
    }
    if (!blob) return null;

    rememberBlob(partId, resolvedHex, blob); // Fix #3: cache for next call
    void uploadPartThumbnail(partId, blob).catch(() => {});
    return URL.createObjectURL(blob);
  }, options?.priority ?? 0);
}
