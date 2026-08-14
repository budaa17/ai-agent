import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "../auth/auth-provider";
import { ToastProvider } from "../components/toast";
import { AdminPage } from "./admin-page";

vi.mock("../auth/auth-provider", () => ({ useAuth: vi.fn() }));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    buildWatchApi: {
      ...actual.buildWatchApi,
      projects: vi.fn(async () => ({
        data: [
          {
            id: "project-1",
            code: "BW-001",
            name: "Test Project",
            status: "ACTIVE",
            role: "COMPANY_ADMIN",
            plannedStart: "2026-01-01T00:00:00Z",
            plannedEnd: "2026-12-01T00:00:00Z",
            rowVersion: 1,
          },
        ],
        page: { nextCursor: null, hasMore: false },
      })),
    },
  };
});

const mockedUseAuth = vi.mocked(useAuth);

function renderAdminPage() {
  mockedUseAuth.mockReturnValue({
    tokens: null,
    session: {
      schemaVersion: 1,
      user: {
        id: "user-1",
        tenantId: "tenant-1",
        email: "admin@example.com",
        displayName: "Админ Хэрэглэгч",
        tenantRole: "COMPANY_ADMIN",
      },
      tenantPermissions: ["TENANT_ADMIN", "USER_INVITE"],
      projectMemberships: [],
    },
    loading: false,
    login: vi.fn(),
    completeTenantSelection: vi.fn(),
    logout: vi.fn(),
    hasTenantPermission: vi.fn(() => true),
    hasProjectPermission: vi.fn(() => true),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AdminPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Admin page", () => {
  it("tenant role болон RBAC хүснэгтийг харуулна", async () => {
    renderAdminPage();
    await waitFor(() => expect(screen.getByText("Шинэ хэрэглэгч урих")).toBeInTheDocument());
    expect(screen.getAllByText("COMPANY_ADMIN").length).toBeGreaterThan(0);
    expect(screen.getByText("7 үүргийн товч хязгаар")).toBeInTheDocument();
  });
});
