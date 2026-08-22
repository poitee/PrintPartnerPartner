// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VariantDimensionDialog from "./VariantDimensionDialog";

const api = vi.hoisted(() => ({
  fetchPlanVariantDimensions: vi.fn(),
  applyPlanVariantSelection: vi.fn(),
}));

vi.mock("../api/engine", () => ({
  fetchPlanVariantDimensions: (...args: unknown[]) =>
    api.fetchPlanVariantDimensions(...args),
  applyPlanVariantSelection: (...args: unknown[]) =>
    api.applyPlanVariantSelection(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VariantDimensionDialog", () => {
  it("still finishes when onDone identity changes during the empty-dimension fetch", async () => {
    let resolveFetch: (value: { dimensions: Record<string, never>; selection: Record<string, never> }) => void =
      () => {};
    api.fetchPlanVariantDimensions.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(
      <VariantDimensionDialog profileId={1} onDone={first} />,
    );
    rerender(<VariantDimensionDialog profileId={1} onDone={second} />);
    resolveFetch({ dimensions: {}, selection: {} });

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    expect(api.fetchPlanVariantDimensions).toHaveBeenCalledTimes(1);
  });
});
