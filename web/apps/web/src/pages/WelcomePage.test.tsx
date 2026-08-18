// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import WelcomePage from "./WelcomePage";

vi.mock("../hooks/useEngineHealth", () => ({
  useEngineHealth: () => ({ health: { ok: true }, error: null, loading: false }),
}));
vi.mock("../context/ProfileContext", () => ({
  useProfileSelection: () => ({
    profiles: [{ id: 7, name: "Voron" }],
  }),
}));
vi.mock("../queries/sources", () => ({
  useSourcesQuery: () => ({ data: [{ id: 3, name: "Kit source" }] }),
}));

function PlanDestination() {
  const location = useLocation();
  return <p>Plan destination {location.search}</p>;
}

describe("WelcomePage", () => {
  afterEach(cleanup);

  it("keeps the welcome page h1 in the completed setup state", () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Welcome to Print Partner",
    );
  });

  it("opens Plan with client-side routing instead of a document reload", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/plan" element={<PlanDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Plan" }));

    expect(screen.getByText("Plan destination ?profile=7")).toBeTruthy();
  });
});
