// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Preview3D from "./Preview3D";

vi.mock("../lib/fetchWithRetry", () => ({
  fetchWithRetry: vi.fn(() => new Promise(() => {})),
}));

describe("Preview3D accessibility", () => {
  it("offers a keyboard-focusable 3D view with operating instructions", () => {
    render(<Preview3D partId={7} filename="gantry.stl" />);

    const preview = screen.getByRole("application", {
      name: "Interactive 3D preview of gantry.stl",
    });
    const descriptionId = preview.getAttribute("aria-describedby");
    const instructions = descriptionId ? document.getElementById(descriptionId) : null;

    expect(preview.tabIndex).toBe(0);
    expect(instructions?.textContent).toMatch(/arrow keys/i);

    fireEvent.keyDown(preview, { key: "ArrowLeft" });
    expect(preview.getAttribute("aria-keyshortcuts")).toContain("ArrowLeft");
  });
});
