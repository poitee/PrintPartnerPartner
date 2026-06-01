import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { partMeshUrl, uploadPartThumbnail } from "../api/engine";

const SIZE = 256;
const MESH_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_COLOR = "#c41230";

let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedLoader: STLLoader | null = null;

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
 * Fetch a part's STL mesh, render it to a PNG once, upload it as the cached
 * thumbnail, and return an object URL for immediate display. Returns null when
 * the mesh is missing or too large for client-side rendering.
 */
export function generatePartThumbnail(
  partId: number,
  hex: string | null | undefined,
): Promise<string | null> {
  return enqueue(async () => {
    let res: Response;
    try {
      res = await fetch(await partMeshUrl(partId));
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MESH_MAX_BYTES) return null;
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
