import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformPermission, PlatformSession } from "../api/platform-schemas";
import type { TokenPair } from "../auth/token-store";
import { usePlatformAuth } from "../auth/platform-auth-provider";
import { PlatformShell } from "./platform-shell";

vi.mock("../auth/platform-auth-provider", () => ({ usePlatformAuth: vi.fn() }));

const mockedUsePlatformAuth = vi.mocked(usePlatformAuth);
const TOKENS: TokenPair = {
  tokenType: "Bearer",
  accessToken: "platform-access-token-value-that-is-long-enough",
  accessExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "platform-refresh-token-value-that-is-long-enough",
  refreshExpiresAt: "2099-02-01T00:00:00.000Z",
};
const ALL_READ_PERMISSIONS: PlatformPermission[] = [
  "PLATFORM_OVERVIEW_READ",
  "PLATFORM_TENANT_HEALTH_READ",
  "PLATFORM_AGENT_HEALTH_READ",
  "PLATFORM_AGENT_RUN_DIAGNOSTICS_READ",
  "PLATFORM_REVIEW_MONITOR_READ",
  "PLATFORM_USAGE_READ",
  "PLATFORM_SYSTEM_HEALTH_READ",
  "PLATFORM_AUDIT_READ",
];

function renderShell(permissions: PlatformPermission[] = ALL_READ_PERMISSIONS) {
  const logout = vi.fn().mockResolvedValue(undefined);
  const session: PlatformSession = {
    schemaVersion: 1,
    principal: {
      principalKind: "PLATFORM",
      id: "platform-principal-1",
      email: "admin@buildwatch.test",
      displayName: "Atlas Platform Admin",
      role: "PLATFORM_SUPER_ADMIN",
    },
    permissions,
  };
  mockedUsePlatformAuth.mockReturnValue({
    tokens: TOKENS,
    session,
    loading: false,
    login: vi.fn(),
    logout,
    hasPlatformPermission: vi.fn((permission) => permissions.includes(permission)),
  });
  render(
    <MemoryRouter initialEntries={["/platform"]}>
      <Routes>
        <Route path="/platform" element={<PlatformShell />}>
          <Route index element={<div>Protected platform content</div>} />
        </Route>
        <Route path="/login" element={<div>Common login</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return logout;
}

describe("PlatformShell", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows only platform context and never mounts project/offline controls", () => {
    renderShell();

    expect(screen.getByText("Protected platform content")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Platform navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Control Tower/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Компаниуд/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Идэвхтэй төсөл")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Sync/)).not.toBeInTheDocument();
    expect(screen.queryByText("Төсөл сонгох")).not.toBeInTheDocument();
    expect(screen.queryByText("Atlas Platform Admin")).not.toBeInTheDocument();
  });

  it("hides navigation entries that the platform session cannot read", () => {
    renderShell(["PLATFORM_OVERVIEW_READ"]);

    expect(screen.getByRole("link", { name: /Control Tower/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Компаниуд/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Audit log/ })).not.toBeInTheDocument();
  });

  it("shows a compact logout action and returns to the common login", async () => {
    const user = userEvent.setup();
    const logout = renderShell();

    await user.click(screen.getByRole("button", { name: "Гарах" }));

    expect(logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("Common login")).toBeInTheDocument());
  });
});
