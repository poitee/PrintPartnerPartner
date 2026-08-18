// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./LoginPage";

const auth = vi.hoisted(() => ({
  loginEmail: vi.fn(),
  registerEmail: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    multiUser: true,
    loading: false,
    loginEmail: auth.loginEmail,
    registerEmail: auth.registerEmail,
  }),
}));
vi.mock("../api/engine", () => ({
  authOAuthUrl: (provider: string) => `/auth/${provider}`,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("LoginPage", () => {
  beforeEach(() => {
    auth.loginEmail.mockReset().mockResolvedValue(undefined);
    auth.registerEmail.mockReset().mockResolvedValue(undefined);
  });

  it("exposes the page title as its h1", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Print Partner");
  });

  it("submits credentials through the form keyboard-submit path", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "operator@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "shop-floor-password" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Email sign in" }));

    await waitFor(() => {
      expect(auth.loginEmail).toHaveBeenCalledWith(
        "operator@example.com",
        "shop-floor-password",
      );
    });
  });
});
