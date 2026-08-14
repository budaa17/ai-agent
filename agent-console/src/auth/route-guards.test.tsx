import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "./auth-provider";
import { RequirePermission } from "./route-guards";

vi.mock("./auth-provider", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

function renderGuard(allowed: boolean) {
  mockedUseAuth.mockReturnValue({
    tokens: null,
    session: null,
    loading: false,
    login: vi.fn(),
    completeTenantSelection: vi.fn(),
    logout: vi.fn(),
    hasTenantPermission: vi.fn(() => allowed),
    hasProjectPermission: vi.fn(() => allowed),
  });
  render(
    <MemoryRouter initialEntries={["/projects/project-1/a0"]}>
      <Routes>
        <Route element={<RequirePermission permission="DESIGN_READ" />}>
          <Route path="/projects/:projectId/a0" element={<div>Authorized A0</div>} />
        </Route>
        <Route path="/projects/:projectId" element={<div>Project fallback</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("role-based route guard", () => {
  it("effective project permission байвал route нээнэ", () => {
    renderGuard(true);
    expect(screen.getByText("Authorized A0")).toBeInTheDocument();
  });

  it("permission байхгүй үед project overview руу буцаана", () => {
    renderGuard(false);
    expect(screen.getByText("Project fallback")).toBeInTheDocument();
    expect(screen.queryByText("Authorized A0")).not.toBeInTheDocument();
  });
});
