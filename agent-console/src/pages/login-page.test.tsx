import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWatchApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { usePlatformAuth } from "../auth/platform-auth-provider";
import { LoginPage } from "./login-page";

vi.mock("../auth/auth-provider", () => ({ useAuth: vi.fn() }));
vi.mock("../auth/platform-auth-provider", () => ({ usePlatformAuth: vi.fn() }));
vi.mock("../api/client", () => ({ buildWatchApi: { session: vi.fn() } }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUsePlatformAuth = vi.mocked(usePlatformAuth);
const mockedSession = vi.mocked(buildWatchApi.session);

const TWO_ORGANIZATIONS = {
  status: "TENANT_SELECTION_REQUIRED" as const,
  selectionToken: "selection-token-value",
  expiresAt: "2026-08-07T00:02:00.000Z",
  tenants: [
    { tenantSlug: "nomad-build", tenantName: "Nomad Build LLC" },
    { tenantSlug: "steppe-labs", tenantName: "Steppe Labs LLC" },
  ],
};

function renderLoginPage() {
  const login = vi.fn();
  const logout = vi.fn().mockResolvedValue(undefined);
  const completeTenantSelection = vi.fn();
  const platformLogin = vi.fn().mockRejectedValue(new Error("Invalid platform credentials"));
  mockedUseAuth.mockReturnValue({
    tokens: null,
    session: null,
    loading: false,
    login,
    completeTenantSelection,
    logout,
    hasTenantPermission: vi.fn(() => false),
    hasProjectPermission: vi.fn(() => false),
  });
  mockedUsePlatformAuth.mockReturnValue({
    tokens: null,
    session: null,
    loading: false,
    login: platformLogin,
    logout: vi.fn(),
    hasPlatformPermission: vi.fn(() => false),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Landing page</div>} />
          <Route path="/projects" element={<div>Projects</div>} />
          <Route path="/platform" element={<div>Control Tower</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { login, logout, completeTenantSelection, platformLogin };
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Имэйл"), "engineer@shared.test");
  await user.type(screen.getByLabelText(/Нууц үг/), "strong-password-123");
  await user.click(screen.getByRole("button", { name: /BuildWatch-д нэвтрэх/i }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    mockedSession.mockResolvedValue({ user: { tenantRole: "ENGINEER" } } as never);
  });

  it("never asks for a tenant slug", () => {
    renderLoginPage();

    expect(screen.getByLabelText("Имэйл")).toBeInTheDocument();
    expect(screen.queryByText(/slug/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tenant/i)).not.toBeInTheDocument();
  });

  it("returns to the public landing page", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole("link", { name: "Нүүр хуудас руу буцах" }));

    expect(await screen.findByText("Landing page")).toBeInTheDocument();
  });

  it("signs in with email and password alone", async () => {
    const user = userEvent.setup();
    const { login } = renderLoginPage();
    login.mockResolvedValue({ status: "AUTHENTICATED" });

    await signIn(user);

    expect(login).toHaveBeenCalledWith({
      email: "engineer@shared.test",
      password: "strong-password-123",
      deviceName: "BuildWatch Web PWA",
    });
    await waitFor(() => expect(screen.getByText("Projects")).toBeInTheDocument());
  });

  it("moves a separately authenticated Super Admin into Control Tower", async () => {
    const user = userEvent.setup();
    const { login, logout, platformLogin } = renderLoginPage();
    login.mockResolvedValue({ status: "AUTHENTICATED" });
    platformLogin.mockResolvedValue(undefined);
    mockedSession.mockResolvedValue({ user: { tenantRole: "SUPER_ADMIN" } } as never);

    await user.type(screen.getByLabelText("Имэйл"), "super.admin@buildwatch.demo");
    await user.type(screen.getByLabelText(/Нууц үг/), "BuildWatch-SuperAdmin-2026!");
    await user.click(screen.getByRole("button", { name: /BuildWatch-д нэвтрэх/i }));

    expect(platformLogin).toHaveBeenCalledWith({
      email: "super.admin@buildwatch.demo",
      password: "BuildWatch-SuperAdmin-2026!",
    });
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Control Tower")).toBeInTheDocument();
  });

  it("opens Control Tower for a platform-only account from the ordinary login", async () => {
    const user = userEvent.setup();
    const { login, platformLogin } = renderLoginPage();
    login.mockRejectedValue(new Error("Invalid email or password"));
    platformLogin.mockResolvedValue(undefined);

    await user.type(screen.getByLabelText("Имэйл"), "operator@buildwatch.test");
    await user.type(screen.getByLabelText(/Нууц үг/), "strong-password-123");
    await user.click(screen.getByRole("button", { name: /BuildWatch-д нэвтрэх/i }));

    expect(platformLogin).toHaveBeenCalledWith({
      email: "operator@buildwatch.test",
      password: "strong-password-123",
    });
    expect(await screen.findByText("Control Tower")).toBeInTheDocument();
  });

  it("does not fall through to the Company Admin shell without platform proof", async () => {
    const user = userEvent.setup();
    const { login, logout, platformLogin } = renderLoginPage();
    login.mockResolvedValue({ status: "AUTHENTICATED" });
    platformLogin.mockRejectedValue(new Error("Invalid email or password"));
    mockedSession.mockResolvedValue({ user: { tenantRole: "SUPER_ADMIN" } } as never);

    await user.type(screen.getByLabelText("Имэйл"), "legacy.admin@example.com");
    await user.type(screen.getByLabelText(/Нууц үг/), "strong-password-123");
    await user.click(screen.getByRole("button", { name: /BuildWatch-д нэвтрэх/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Platform Super Admin бүртгэл тохируулагдаагүй",
    );
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
  });

  it("asks which organization when the password unlocked several", async () => {
    const user = userEvent.setup();
    const { login } = renderLoginPage();
    login.mockResolvedValue(TWO_ORGANIZATIONS);

    await signIn(user);

    expect(
      await screen.findByRole("heading", { name: "Та аль байгууллагаар нэвтрэх вэ?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nomad Build LLC/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Steppe Labs LLC/ })).toBeInTheDocument();
  });

  it("shows organization names, never their slugs", async () => {
    const user = userEvent.setup();
    const { login } = renderLoginPage();
    login.mockResolvedValue(TWO_ORGANIZATIONS);

    await signIn(user);

    await screen.findByRole("button", { name: /Nomad Build LLC/ });
    expect(screen.queryByText("nomad-build")).not.toBeInTheDocument();
    expect(screen.queryByText("steppe-labs")).not.toBeInTheDocument();
  });

  it("exchanges the chosen organization for a session", async () => {
    const user = userEvent.setup();
    const { login, completeTenantSelection } = renderLoginPage();
    login.mockResolvedValue(TWO_ORGANIZATIONS);
    completeTenantSelection.mockResolvedValue(undefined);

    await signIn(user);
    await user.click(await screen.findByRole("button", { name: /Steppe Labs LLC/ }));

    expect(completeTenantSelection).toHaveBeenCalledWith({
      selectionToken: "selection-token-value",
      tenantSlug: "steppe-labs",
      deviceName: "BuildWatch Web PWA",
    });
    await waitFor(() => expect(screen.getByText("Projects")).toBeInTheDocument());
  });

  it("skips the question next time by reusing the remembered organization", async () => {
    const user = userEvent.setup();
    const { login, completeTenantSelection } = renderLoginPage();
    login.mockResolvedValue(TWO_ORGANIZATIONS);
    completeTenantSelection.mockResolvedValue(undefined);
    window.localStorage.setItem("buildwatch.lastOrganization.v1", "steppe-labs");

    await signIn(user);

    await waitFor(() =>
      expect(completeTenantSelection).toHaveBeenCalledWith(
        expect.objectContaining({ tenantSlug: "steppe-labs" }),
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "Та аль байгууллагаар нэвтрэх вэ?" }),
    ).not.toBeInTheDocument();
  });

  it("still asks when the remembered organization is not one the password unlocked", async () => {
    const user = userEvent.setup();
    const { login, completeTenantSelection } = renderLoginPage();
    login.mockResolvedValue(TWO_ORGANIZATIONS);
    window.localStorage.setItem("buildwatch.lastOrganization.v1", "some-other-company");

    await signIn(user);

    expect(
      await screen.findByRole("heading", { name: "Та аль байгууллагаар нэвтрэх вэ?" }),
    ).toBeInTheDocument();
    expect(completeTenantSelection).not.toHaveBeenCalled();
  });

  it("reports a rejected sign-in without moving on", async () => {
    const user = userEvent.setup();
    const { login } = renderLoginPage();
    login.mockRejectedValue(new Error("Invalid email or password"));

    await signIn(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
  });

  it("rejects a too-short password before calling the API", async () => {
    const user = userEvent.setup();
    const { login } = renderLoginPage();

    await user.type(screen.getByLabelText("Имэйл"), "engineer@shared.test");
    await user.type(screen.getByLabelText(/Нууц үг/), "short");
    await user.click(screen.getByRole("button", { name: /BuildWatch-д нэвтрэх/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нууц үг 12-оос доошгүй тэмдэгт байна",
    );
    expect(login).not.toHaveBeenCalled();
  });

  // The email input is type="email", so the browser blocks submission itself
  // before the form handler ever runs. Assert the request is not made rather
  // than expecting our own message.
  it("does not call the API with a malformed email", async () => {
    const user = userEvent.setup();
    const { login } = renderLoginPage();

    await user.type(screen.getByLabelText("Имэйл"), "not-an-email");
    await user.type(screen.getByLabelText(/Нууц үг/), "strong-password-123");
    await user.click(screen.getByRole("button", { name: /BuildWatch-д нэвтрэх/i }));

    expect(login).not.toHaveBeenCalled();
  });
});
