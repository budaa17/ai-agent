import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PlatformLoginPage } from "./platform-login-page";

function LoginLocationProbe() {
  const location = useLocation();
  const state = location.state as {
    audience?: unknown;
    from?: unknown;
    email?: unknown;
  } | null;
  return (
    <div>
      <span>Common login</span>
      <span data-testid="audience">{String(state?.audience ?? "")}</span>
      <span data-testid="from">{String(state?.from ?? "")}</span>
      <span data-testid="email">{String(state?.email ?? "")}</span>
    </div>
  );
}

function renderPlatformLogin(
  initialEntry: string | { pathname: string; state: unknown } = "/platform/login",
) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route path="/login" element={<LoginLocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlatformLoginPage", () => {
  it("redirects the old platform URL to the common login", () => {
    renderPlatformLogin();

    expect(screen.getByText("Common login")).toBeInTheDocument();
    expect(screen.getByTestId("audience")).toHaveTextContent("PLATFORM");
    expect(screen.getByTestId("from")).toHaveTextContent("/platform");
  });

  it("preserves the protected destination and prefilled email", () => {
    renderPlatformLogin({
      pathname: "/platform/login",
      state: { from: "/platform/agents", email: "super.admin@buildwatch.demo" },
    });

    expect(screen.getByTestId("from")).toHaveTextContent("/platform/agents");
    expect(screen.getByTestId("email")).toHaveTextContent("super.admin@buildwatch.demo");
  });

  it("rejects a non-platform return path", () => {
    renderPlatformLogin({
      pathname: "/platform/login",
      state: { from: "/projects" },
    });

    expect(screen.getByTestId("from")).toHaveTextContent("/platform");
  });
});
