import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  partMeshUrl,
  partPreviewUrl,
  sourceStlMeshUrl,
  sourceStlPreviewUrl,
  uploadPartThumbnail,
} from "../api/engine";

type Props = {
  partId: number | null;
  sourceId?: number | null;
  relativePath?: string | null;
  /** When set, preview the synced source STL instead of the plan part row. */
  preferSource?: boolean;
  filename?: string;
  meshColor?: string;
  className?: string;
};

const DEFAULT_COLOR = "#c41230";
const MESH_MAX_BYTES = 15 * 1024 * 1024;

type PreviewTarget =
  | { kind: "part"; partId: number }
  | { kind: "source"; sourceId: number; relativePath: string };

function previewTarget(
  partId: number | null,
  sourceId: number | null | undefined,
  relativePath: string | null | undefined,
  preferSource = false,
): PreviewTarget | null {
  if (preferSource && sourceId != null && relativePath) {
    return { kind: "source", sourceId, relativePath };
  }
  if (partId != null) return { kind: "part", partId };
  if (sourceId != null && relativePath) {
    return { kind: "source", sourceId, relativePath };
  }
  return null;
}

function previewErrorMessage(status: number, kind: "mesh" | "png"): string {
  if (status === 404 && kind === "mesh") {
    return "STL preview not found. Sync the source, then restart the Print Partner engine if preview still fails.";
  }
  if (status === 413) {
    return "STL is too large for live 3D preview — showing PNG instead.";
  }
  if (status === 404) {
    return "Preview image not available for this part.";
  }
  return `Preview unavailable (HTTP ${status}).`;
}

function previewUrlWithColor(url: string, meshColor: string): string {
  const hex = meshColor.trim();
  if (!hex) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}hex=${encodeURIComponent(hex)}`;
}

export default function Preview3D({
  partId,
  sourceId = null,
  relativePath = null,
  preferSource = false,
  filename,
  meshColor = DEFAULT_COLOR,
  className = "",
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const [mode, setMode] = useState<"loading" | "mesh" | "png" | "empty" | "error">("empty");
  const [pngSrc, setPngSrc] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const target = previewTarget(partId, sourceId, relativePath, preferSource);
  const resolvedColor = meshColor || DEFAULT_COLOR;

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.color.set(resolvedColor);
  }, [resolvedColor]);

  useEffect(() => {
    if (target == null) {
      setMode("empty");
      setPngSrc(null);
      setErrorMessage(null);
      materialRef.current = null;
      return;
    }

    let cancelled = false;
    let frameId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const cleanupThree = () => {
      if (frameId) cancelAnimationFrame(frameId);
      controls?.dispose();
      materialRef.current = null;
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };

    const meshUrlFor = async () => {
      if (target.kind === "part") return partMeshUrl(target.partId);
      return sourceStlMeshUrl(target.sourceId, target.relativePath);
    };

    const previewUrlFor = async () => {
      if (target.kind === "part") return partPreviewUrl(target.partId);
      return sourceStlPreviewUrl(target.sourceId, target.relativePath);
    };

    const showPngFallback = async (meshStatus?: number) => {
      try {
        const url = previewUrlWithColor(await previewUrlFor(), resolvedColor);
        const response = await fetch(url);
        if (cancelled) return;
        if (!response.ok) {
          setMode("error");
          setErrorMessage(
            meshStatus === 404 && response.status === 404
              ? previewErrorMessage(404, "mesh")
              : previewErrorMessage(response.status, "png"),
          );
          setPngSrc(null);
          return;
        }
        setPngSrc(url);
        setMode("png");
      } catch {
        if (!cancelled) {
          setMode("error");
          setErrorMessage("Could not load preview — check that the engine is running.");
          setPngSrc(null);
        }
      }
    };

    const initMesh = async () => {
      setMode("loading");
      setPngSrc(null);
      setErrorMessage(null);
      cleanupThree();

      try {
        const url = await meshUrlFor();
        const response = await fetch(url);
        if (cancelled) return;

        if (response.status === 413 || !response.ok) {
          await showPngFallback(response.status);
          return;
        }

        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        if (buffer.byteLength > MESH_MAX_BYTES) {
          await showPngFallback(413);
          return;
        }

        const mount = mountRef.current;
        if (!mount) return;

        const loader = new STLLoader();
        const geometry = loader.parse(buffer);
        geometry.computeBoundingBox();
        geometry.center();
        geometry.computeVertexNormals();

        const bbox = geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox?.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 1);

        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(resolvedColor),
          metalness: 0.15,
          roughness: 0.65,
        });
        materialRef.current = material;
        const mesh = new THREE.Mesh(geometry, material);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0e14);
        scene.add(mesh);

        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const key = new THREE.DirectionalLight(0xffffff, 0.85);
        key.position.set(1, 1.2, 0.8);
        const fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(-0.8, 0.4, -1);
        scene.add(key, fill);

        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, maxDim * 20);
        camera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.6);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        const resize = () => {
          if (!mount || !renderer) return;
          const width = mount.clientWidth || 320;
          const height = Math.max(220, Math.min(360, width * 0.75));
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        resize();

        const animate = () => {
          if (cancelled) return;
          controls?.update();
          renderer?.render(scene, camera);
          frameId = requestAnimationFrame(animate);
        };
        animate();

        setMode("mesh");
        if (target.kind === "part") {
          const partIdForThumb = target.partId;
          setTimeout(() => {
            if (cancelled || !renderer) return;
            renderer.domElement.toBlob((blob) => {
              if (blob) void uploadPartThumbnail(partIdForThumb, blob).catch(() => {});
            }, "image/png");
          }, 900);
        }
      } catch {
        if (!cancelled) await showPngFallback();
      }
    };

    void initMesh();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      cleanupThree();
    };
  }, [
    target?.kind,
    target?.kind === "part" ? target.partId : null,
    target?.kind === "source" ? target.sourceId : null,
    target?.kind === "source" ? target.relativePath : null,
  ]);

  useEffect(() => {
    if (target == null || mode !== "png") return;
    let cancelled = false;

    const reloadPng = async () => {
      try {
        const base =
          target.kind === "part"
            ? await partPreviewUrl(target.partId)
            : await sourceStlPreviewUrl(target.sourceId, target.relativePath);
        const url = previewUrlWithColor(base, resolvedColor);
        const response = await fetch(url);
        if (cancelled) return;
        if (!response.ok) return;
        setPngSrc(url);
      } catch {
        /* keep previous png */
      }
    };

    void reloadPng();
    return () => {
      cancelled = true;
    };
  }, [resolvedColor, mode, target?.kind, target?.kind === "part" ? target.partId : null, target?.kind === "source" ? target.sourceId : null, target?.kind === "source" ? target.relativePath : null]);

  if (target == null) {
    return (
      <div className={`preview3d ${className}`.trim()}>
        <p className="muted">Select a file to preview its STL.</p>
      </div>
    );
  }

  return (
    <div className={`preview3d ${className}`.trim()}>
      {filename && <p className="preview-filename">{filename}</p>}
      {mode === "loading" && <p className="muted">Loading 3D preview…</p>}
      {mode === "png" && pngSrc && (
        <>
          <p className="muted small">Large mesh — showing PNG preview.</p>
          <img
            className="preview-image"
            src={pngSrc}
            alt={filename ? `Preview of ${filename}` : "Part preview"}
            onError={() => {
              setMode("error");
              setErrorMessage("Preview image failed to load.");
              setPngSrc(null);
            }}
          />
        </>
      )}
      {mode === "error" && (
        <p className="preview-error text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      <div
        ref={mountRef}
        className="preview3d-canvas"
        hidden={mode !== "mesh"}
        aria-label="3D STL preview"
      />
    </div>
  );
}
