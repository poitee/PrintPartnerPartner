// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlateApprovalCard from "./PlateApprovalCard";

afterEach(cleanup);

describe("PlateApprovalCard ambiguous Object names", () => {
  it("requires confirmation before Approve when Object names are unmatched", () => {
    const onApprove = vi.fn();
    render(
      <PlateApprovalCard
        printerName="Voron"
        plateIndex={1}
        plateTotal={1}
        unmatchedNames={["bracket_01", "bracket.stl"]}
        onApprove={onApprove}
        onReject={() => undefined}
      />,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    if (!(approve instanceof HTMLButtonElement)) throw new Error("Expected Approve button");
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledOnce();
  });
});
