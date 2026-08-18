// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Preview3D from "./Preview3D";

const previewRuntime = vi.hoisted(() => ({
  camera: null as {
    position: {
      clone: () => {
        distanceTo: (target: { x: number; y: number; z: number }) => number;
        toArray: () => number[];
      };
    };
  } | null,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class TestWebGLRenderer {
    domElement = document.createElement("canvas");

    setPixelRatio() {}
    setSize() {}
    dispose() {}
    render(_scene: unknown, camera: NonNullable<typeof previewRuntime.camera>) {
      previewRuntime.camera = camera;
    }
  }

  return {
    ...actual,
    WebGLRenderer: TestWebGLRenderer,
  };
});

const STL = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test`;

vi.mock("../lib/fetchWithRetry", () => ({
  fetchWithRetry: vi.fn(async () => new Response(STL, { status: 200 })),
}));
vi.mock("../api/engine", () => ({
  partMeshUrl: (partId: number) => `/parts/${partId}/mesh`,
  partPreviewUrl: (partId: number) => `/parts/${partId}/preview`,
  sourceStlMeshUrl: () => "/source/mesh",
  sourceStlPreviewUrl: () => "/source/preview",
  uploadPartThumbnail: vi.fn().mockResolvedValue(undefined),
}));

describe("Preview3D accessibility", () => {
  beforeEach(() => {
    previewRuntime.camera = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers concise operating instructions when the interactive mesh is ready", async () => {
    render(<Preview3D partId={7} filename="gantry.stl" />);

    const preview = await screen.findByRole("application", {
      name: "Interactive 3D preview of gantry.stl",
    });

    const descriptionId = preview.getAttribute("aria-describedby");
    const instructions = descriptionId ? document.getElementById(descriptionId) : null;

    expect(preview.tabIndex).toBe(0);
    expect(instructions?.textContent).toMatch(/arrow keys/i);
    expect(instructions?.textContent.length).toBeLessThan(180);
  });

  it("rotates the real preview camera with arrow keys", async () => {
    render(<Preview3D partId={7} filename="gantry.stl" />);
    const preview = await screen.findByRole("application");

    await waitFor(() => expect(previewRuntime.camera).not.toBeNull());
    const before = previewRuntime.camera!.position.clone().toArray();
    const dispatched = fireEvent.keyDown(preview, { key: "ArrowLeft" });
    const after = previewRuntime.camera!.position.clone().toArray();

    expect(dispatched).toBe(false);
    expect(after).not.toEqual(before);
  });

  it("clamps keyboard zoom to the OrbitControls distance limits", async () => {
    render(<Preview3D partId={7} filename="gantry.stl" />);
    const preview = await screen.findByRole("application");

    await waitFor(() => expect(previewRuntime.camera).not.toBeNull());
    for (let index = 0; index < 100; index += 1) {
      fireEvent.keyDown(preview, { key: "+" });
    }
    const minimumDistance = previewRuntime.camera!.position
      .clone()
      .distanceTo({ x: 0, y: 0, z: 0 });
    expect(minimumDistance).toBeCloseTo(0.25, 5);

    for (let index = 0; index < 200; index += 1) {
      fireEvent.keyDown(preview, { key: "-" });
    }
    const maximumDistance = previewRuntime.camera!.position
      .clone()
      .distanceTo({ x: 0, y: 0, z: 0 });
    expect(maximumDistance).toBeCloseTo(8, 5);
  });
});
