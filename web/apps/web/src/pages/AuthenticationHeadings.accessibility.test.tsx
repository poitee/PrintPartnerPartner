// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ForgotPasswordPage from "./ForgotPasswordPage";
import ResetPasswordPage from "./ResetPasswordPage";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    multiUser: true,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../api/engine", () => ({
  requestPasswordReset: vi.fn(),
  resetPasswordWithToken: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("authentication page headings", () => {
  it("uses an h1 for the forgot-password page title", () => {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Reset password");
  });

  it("uses an h1 for the reset-password page title", () => {
    render(
      <MemoryRouter initialEntries={["/reset-password?token=test-token"]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Choose a new password",
    );
  });
});
