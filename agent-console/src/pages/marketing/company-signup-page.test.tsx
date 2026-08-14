import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const billingApi = vi.hoisted(() => ({
  createCompanySignup: vi.fn(),
  verifyCompanySignup: vi.fn(),
  startCompanyCheckout: vi.fn(),
  resendCompanySignupCode: vi.fn(),
}));

vi.mock("../../api/public-billing", () => billingApi);
import { CompanySignupPage, slugifyCompanyName } from "./company-signup-page";

describe("company signup workspace slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billingApi.createCompanySignup.mockResolvedValue({
      signupIntentId: "signup-1",
      status: "PENDING_VERIFICATION",
    });
    billingApi.verifyCompanySignup.mockResolvedValue({ status: "CONFIRMING" });
    billingApi.resendCompanySignupCode.mockResolvedValue({ status: "PENDING_VERIFICATION" });
  });
  it("transliterates a Mongolian company name into the backend's ASCII contract", () => {
    expect(slugifyCompanyName("Өргөө Констракшн ХХК")).toBe("urguu-konstrakshn-khkhk");
    expect(slugifyCompanyName("Sky-Cons 101")).toBe("sky-cons-101");
  });

  it("keeps updating the generated slug while the company name is typed", async () => {
    render(
      <MemoryRouter initialEntries={["/company-signup?plan=starter&interval=YEAR"]}>
        <CompanySignupPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Компанийн нэр"), "Өргөө Констракшн");
    expect(screen.getByLabelText("Ажлын талбарын хаяг")).toHaveValue("urguu-konstrakshn");
  });

  it("stops replacing a workspace key after the user edits it", async () => {
    render(
      <MemoryRouter initialEntries={["/company-signup?plan=starter&interval=YEAR"]}>
        <CompanySignupPage />
      </MemoryRouter>,
    );

    const company = screen.getByLabelText("Компанийн нэр");
    const slug = screen.getByLabelText("Ажлын талбарын хаяг");
    await userEvent.type(company, "Өргөө");
    await userEvent.clear(slug);
    await userEvent.type(slug, "minii-company");
    await userEvent.type(company, " Констракшн");
    expect(slug).toHaveValue("minii-company");
  });

  it("starts Checkout immediately after a verification code succeeds", async () => {
    billingApi.startCompanyCheckout.mockImplementation(() => new Promise(() => undefined));
    render(
      <MemoryRouter initialEntries={["/company-signup?plan=starter&interval=YEAR"]}>
        <CompanySignupPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Компанийн нэр"), "Тест компани");
    await userEvent.type(screen.getByLabelText("Администраторын нэр"), "Тест админ");
    await userEvent.type(screen.getByLabelText("Администраторын имэйл"), "admin@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Үргэлжлүүлэх" }));
    await userEvent.type(await screen.findByLabelText("Баталгаажуулах код"), "123456");
    await userEvent.click(
      screen.getByRole("button", { name: /Баталгаажуулж, төлбөр рүү шилжих/u }),
    );

    await waitFor(() =>
      expect(billingApi.verifyCompanySignup).toHaveBeenCalledWith("signup-1", "123456"),
    );
    expect(billingApi.startCompanyCheckout).toHaveBeenCalledWith("signup-1");
  });

  it("shows and fills the development code when no SMTP transport exists", async () => {
    billingApi.createCompanySignup.mockResolvedValueOnce({
      signupIntentId: "signup-dev",
      status: "PENDING",
      verificationCode: "482615",
    });
    render(
      <MemoryRouter initialEntries={["/company-signup?plan=starter&interval=YEAR"]}>
        <CompanySignupPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Компанийн нэр"), "Demo компани");
    await userEvent.type(screen.getByLabelText("Администраторын нэр"), "Demo админ");
    await userEvent.type(screen.getByLabelText("Администраторын имэйл"), "demo@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Үргэлжлүүлэх" }));

    expect(await screen.findByText("Demo орчин — SMTP тохируулаагүй")).toBeInTheDocument();
    expect(screen.getByText("482615")).toBeInTheDocument();
    expect(screen.getByLabelText("Баталгаажуулах код")).toHaveValue("482615");
  });
});
