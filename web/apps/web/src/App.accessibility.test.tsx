// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/JobContext", () => ({
  JobProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/ProfileContext", () => ({
  ProfileProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/PlanActionsContext", () => ({
  PlanActionsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/PlanWorkspaceContext", () => ({
  PlanWorkspaceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/StlAutoSyncContext", () => ({
  StlAutoSyncProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/ImportRulesSaveContext", () => ({
  ImportRulesSaveProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/KitManifestSaveContext", () => ({
  KitManifestSaveProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./context/SaveStatusContext", () => ({
  SaveStatusProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./pages/LoginPage", () => new Promise(() => {}));

describe("lazy route loading", () => {
  it("announces page loading as a polite live status", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );

    const loading = screen.getByRole("status");
    expect(loading.getAttribute("aria-live")).toBe("polite");
    expect(loading.textContent).toContain("Loading");
  });
});
