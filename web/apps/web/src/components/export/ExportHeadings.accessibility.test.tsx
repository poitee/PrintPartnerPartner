// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlateApprovalCard from "./PlateApprovalCard";
import PlateGroupCard from "./PlateGroupCard";
import SlicedPlatesPanel from "./SlicedPlatesPanel";

describe("nested Export card headings", () => {
  afterEach(cleanup);

  it("uses h3 for cards nested under the Slicer input section", () => {
    render(
      <SlicedPlatesPanel
        result={{
          plate_count: 1,
          attempted_count: 1,
          plates: [
            {
              printer_id: "printer-1",
              printer_name: "Workshop",
              plate_index: 1,
              slicer: "orca",
              status: "error",
              error: "Slice failed",
            },
          ],
        } as never}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Sliced plates" }).tagName,
    ).toBe("H3");
  });

  it("uses h4 for plate cards nested inside the Plates card", () => {
    render(
      <PlateGroupCard
        plate={{ index: 1, group_label: "ABS", items: [] } as never}
        printerName="Workshop"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 4, name: /Plate 1 · ABS/ }).tagName,
    ).toBe("H4");
  });

  it("uses h3 for the approval card nested inside Send to printer", () => {
    render(
      <PlateApprovalCard
        printerName="Workshop"
        plateIndex={1}
        plateTotal={1}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: /Workshop/ }).tagName,
    ).toBe("H3");
  });
});
