import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWatchApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { RegisterPage } from "./register-page";
import { completeCompanyAccountSetup } from "../api/public-billing";

vi.mock("../auth/auth-provider", () => ({ useAuth: vi.fn() }));

vi.mock("../api/client", () => ({
  buildWatchApi: { acceptInvitation: vi.fn() },
}));
vi.mock("../api/public-billing", () => ({ completeCompanyAccountSetup: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedAcceptInvitation = vi.mocked(buildWatchApi.acceptInvitation);
const mockedCompleteAccountSetup = vi.mocked(completeCompanyAccountSetup);

const VALID_TOKEN = "abc123def456ghi789jkl012mno345pqr678";

/** Renders whatever /login was handed so the register -> login handoff is observable. */
function LoginProbe() {
  const location = useLocation();
  return <pre data-testid="login-state">{JSON.stringify(location.state)}</pre>;
}

function renderRegisterPage(initialEntry = "/register") {
  mockedUseAuth.mockReturnValue({
    tokens: null,
    session: null,
    loading: false,
    login: vi.fn(),
    completeTenantSelection: vi.fn(),
    logout: vi.fn(),
    hasTenantPermission: vi.fn(() => false),
    hasProjectPermission: vi.fn(() => false),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Field renders its hint inside the <label>, so the accessible name of the
 * password input is "Нууц үг" plus its hint. Match both password fields in DOM
 * order instead of by exact name.
 */
function passwordInputs() {
  const [password, confirmPassword] = screen.getAllByLabelText(/Нууц үг/);
  return { password: password!, confirmPassword: confirmPassword! };
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  confirmPassword = "strong-password-123",
) {
  const fields = passwordInputs();
  await user.type(screen.getByLabelText("Нэр"), "Батбаяр");
  await user.type(fields.password, "strong-password-123");
  await user.type(fields.confirmPassword, confirmPassword);
}

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders invitation registration form", () => {
    renderRegisterPage();
    expect(screen.getByRole("heading", { name: "Бүртгүүлэх" })).toBeInTheDocument();
    expect(screen.getByText("Урилгын токен")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Бүртгэл үүсгэх/i })).toBeInTheDocument();
  });

  it("accepts a pasted register link in place of the bare token", async () => {
    const user = userEvent.setup();
    mockedAcceptInvitation.mockResolvedValue({
      userId: "user-1",
      email: "engineer@nomad.mn",
      tenantSlug: "nomad-build",
    });
    renderRegisterPage();

    await user.type(
      screen.getByLabelText(/Урилгын токен/),
      `http://127.0.0.1:4173/register?token=${VALID_TOKEN}`,
    );
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /Бүртгэл үүсгэх/i }));

    await waitFor(() =>
      expect(mockedAcceptInvitation).toHaveBeenCalledWith(
        expect.objectContaining({ invitationToken: VALID_TOKEN }),
      ),
    );
  });

  it("prefills invitation token from query string", () => {
    renderRegisterPage(`/register?token=${VALID_TOKEN}`);
    expect(screen.getByDisplayValue(VALID_TOKEN)).toBeInTheDocument();
  });

  it("activates a paid Company Admin from the emailed setup link", async () => {
    const user = userEvent.setup();
    mockedCompleteAccountSetup.mockResolvedValue({
      tenantSlug: "nomad-build",
      email: "admin@nomad.mn",
    });
    renderRegisterPage(`/register?setup=${VALID_TOKEN}&tenant=tenant-1`);

    const fields = passwordInputs();
    await user.type(fields.password, "strong-password-123");
    await user.type(fields.confirmPassword, "strong-password-123");
    await user.click(screen.getByRole("button", { name: /Бүртгэл идэвхжүүлэх/i }));

    await waitFor(() => expect(screen.getByTestId("login-state")).toBeInTheDocument());
    expect(mockedCompleteAccountSetup).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      setupToken: VALID_TOKEN,
      password: "strong-password-123",
    });
    expect(mockedAcceptInvitation).not.toHaveBeenCalled();
  });

  it("hands the tenant slug and email to the login form after accepting", async () => {
    const user = userEvent.setup();
    mockedAcceptInvitation.mockResolvedValue({
      userId: "user-1",
      email: "engineer@nomad.mn",
      tenantSlug: "nomad-build",
    });
    renderRegisterPage(`/register?token=${VALID_TOKEN}`);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /Бүртгэл үүсгэх/i }));

    await waitFor(() => expect(screen.getByTestId("login-state")).toBeInTheDocument());
    expect(JSON.parse(screen.getByTestId("login-state").textContent ?? "{}")).toMatchObject({
      registered: true,
      displayName: "Батбаяр",
      tenantSlug: "nomad-build",
      email: "engineer@nomad.mn",
    });
    expect(mockedAcceptInvitation).toHaveBeenCalledWith({
      invitationToken: VALID_TOKEN,
      displayName: "Батбаяр",
      password: "strong-password-123",
    });
  });

  it("rejects mismatched passwords without calling the API", async () => {
    const user = userEvent.setup();
    renderRegisterPage(`/register?token=${VALID_TOKEN}`);

    await fillValidForm(user, "different-password-1");
    await user.click(screen.getByRole("button", { name: /Бүртгэл үүсгэх/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Нууц үг таарахгүй байна");
    expect(mockedAcceptInvitation).not.toHaveBeenCalled();
  });

  it("rejects a short invitation token without calling the API", async () => {
    const user = userEvent.setup();
    renderRegisterPage("/register?token=too-short");

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /Бүртгэл үүсгэх/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation token дутуу байна");
    expect(mockedAcceptInvitation).not.toHaveBeenCalled();
  });

  it("shows the server error and stays on the form when the invitation is rejected", async () => {
    const user = userEvent.setup();
    mockedAcceptInvitation.mockRejectedValue(new Error("Invitation expired"));
    renderRegisterPage(`/register?token=${VALID_TOKEN}`);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /Бүртгэл үүсгэх/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation expired");
    expect(screen.queryByTestId("login-state")).not.toBeInTheDocument();
  });
});
