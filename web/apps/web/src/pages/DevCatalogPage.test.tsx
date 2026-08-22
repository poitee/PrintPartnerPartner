// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DevCatalogPage from "./DevCatalogPage";

describe("DevCatalogPage", () => {
  afterEach(cleanup);

  it("shows Keep/Revise/Remove inventory and three visual sketches", () => {
    render(
      <MemoryRouter>
        <DevCatalogPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Component catalog" }).textContent).toBe(
      "Component catalog",
    );
    expect(screen.getByRole("group", { name: "Visual sketch" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Workshop ledger" }).textContent).toContain(
      "Workshop",
    );
    fireEvent.click(screen.getByRole("button", { name: "Production console" }));
    expect(screen.getByTestId("catalog-stage").getAttribute("data-sketch")).toBe("console");
    expect(screen.getByRole("button", { name: "Retry" }).textContent).toBe("Retry");
    expect(screen.getAllByText("Keep").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Revise").length).toBeGreaterThan(0);
    expect(screen.getByText("Remove").textContent).toBe("Remove");
    expect(screen.queryByText("Merge")).toBeNull();
    expect(screen.getByText("settings/PrintersSettingsCard")).toBeTruthy();
    expect(screen.getByText(/Global Printers owns setup/)).toBeTruthy();
  });

  it("covers empty, loading, error, and disabled primitive states", () => {
    render(
      <MemoryRouter>
        <DevCatalogPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("No Builds yet.").textContent).toBe("No Builds yet.");
    expect(screen.getByText("Connecting to the engine…").textContent).toBe(
      "Connecting to the engine…",
    );
    expect(screen.getByRole("alert").textContent).toContain("Could not load builds");
    expect((screen.getByRole("button", { name: "Disabled" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
