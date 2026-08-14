import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPlans } from "../../api/public-billing";
import { PricingPage } from "./pricing-page";

vi.mock("../../api/public-billing", async () => {
  const actual = await vi.importActual<typeof import("../../api/public-billing")>(
    "../../api/public-billing",
  );
  return { ...actual, fetchPublicPlans: vi.fn() };
});

const mockedFetchPublicPlans = vi.mocked(fetchPublicPlans);

/**
 * Amounts deliberately unlike the real catalog. If the page renders these, it is
 * reading the API; if it renders 390,000₮, it is reading a hard-coded copy.
 */
const CATALOG = {
  currency: "MNT",
  vatRateBasisPoints: 1_000,
  vatIncluded: false as const,
  plans: [
    {
      code: "starter",
      version: 1,
      name: "Starter",
      description: "Анхны төсөл",
      currency: "MNT",
      prices: [
        { interval: "MONTH" as const, unitAmountMinor: "77700000" },
        { interval: "YEAR" as const, unitAmountMinor: "777000000" },
      ],
      entitlements: [
        { featureKey: "PROJECT_ACTIVE_MAX", enabled: true, limitValue: "3", unit: "project" },
        { featureKey: "USER_ACTIVE_MAX", enabled: true, limitValue: "44", unit: "user" },
        {
          featureKey: "STORAGE_BYTES_MAX",
          enabled: true,
          limitValue: String(50n * 1_073_741_824n),
          unit: "byte",
        },
        {
          featureKey: "AI_MONTHLY_RUNS_INCLUDED",
          enabled: true,
          limitValue: "111",
          unit: "agentRun",
        },
        { featureKey: "AUDIT_RETENTION_DAYS", enabled: true, limitValue: "90", unit: "day" },
        { featureKey: "API_ACCESS", enabled: false, limitValue: null, unit: null },
      ],
    },
  ],
};

describe("pricing page", () => {
  beforeEach(() => {
    mockedFetchPublicPlans.mockReset();
    mockedFetchPublicPlans.mockResolvedValue(CATALOG);
  });

  function renderPricing() {
    return render(
      <MemoryRouter initialEntries={["/pricing"]}>
        <PricingPage />
      </MemoryRouter>,
    );
  }

  it("renders the limits the API returned, not a copy of the roadmap", async () => {
    renderPricing();
    await waitFor(() => expect(screen.getByText(/3 идэвхтэй төсөл/)).toBeInTheDocument());
    expect(screen.getByText(/44 хэрэглэгч/)).toBeInTheDocument();
    expect(screen.getByText(/Сард 111 AI ажиллагаа/)).toBeInTheDocument();
    expect(screen.getByText(/50 GB хадгалалт/)).toBeInTheDocument();
  });

  it("opens on the yearly price and keeps the monthly one visible", async () => {
    renderPricing();
    await waitFor(() => expect(screen.getByText("7,770,000₮")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Жилээр/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/сараар 777,000₮/)).toBeInTheDocument();
  });

  it("switches to the monthly price on request", async () => {
    renderPricing();
    await waitFor(() => expect(screen.getByText("7,770,000₮")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Сараар" }));
    expect(screen.getByText("777,000₮")).toBeInTheDocument();
  });

  it("derives the annual saving instead of stating one", async () => {
    renderPricing();
    // 12 monthly payments minus the annual price: 12 × 777,000 − 7,770,000.
    await waitFor(() => expect(screen.getByText(/Жилд 1,554,000₮ хэмнэнэ/)).toBeInTheDocument());
  });

  it("always says VAT is excluded", async () => {
    renderPricing();
    await waitFor(() =>
      expect(screen.getByText(/НӨАТ ороогүй \(10% нэмэгдэнэ\)/)).toBeInTheDocument(),
    );
  });

  it("marks a feature the plan lacks as not included, for screen readers too", async () => {
    renderPricing();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const apiRow = screen.getByRole("row", { name: /API хандалт/ });
    expect(within(apiRow).getByText("Багтаагүй")).toBeInTheDocument();
  });

  it("reports a catalogue failure instead of rendering invented prices", async () => {
    mockedFetchPublicPlans.mockRejectedValue(new Error("Багцын мэдээлэл ачаалж чадсангүй"));
    renderPricing();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/₮/)).not.toBeInTheDocument();
  });
});

describe("marketing copy discipline", () => {
  it("never hard-codes a plan price or limit into the pages", async () => {
    // The roadmap's own acceptance test: a number typed into JSX is a promise the
    // backend has not agreed to keep.
    const files = [
      "src/pages/marketing/pricing-page.tsx",
      "src/pages/marketing/landing-page.tsx",
      "src/marketing/marketing-shell.tsx",
    ];
    for (const file of files) {
      const source = await readFile(resolve(file), "utf8");
      expect(source).not.toMatch(/390[,_ ]?000|1[,_ ]?290[,_ ]?000|3[,_ ]?900[,_ ]?000/);
      expect(source).not.toMatch(/\b(150|900)\s*(AI|ажиллагаа)/);
    }
  });

  it("makes no claim of adoption, uptime or popularity", async () => {
    const source = await readFile(resolve("src/pages/marketing/landing-page.tsx"), "utf8");
    expect(source).not.toMatch(/99[.,]9|хамгийн түгээмэл|[0-9]+\+?\s*компани ашиглаж/i);
  });
});

describe("public API transport", () => {
  it("reaches the API through the /api prefix the console proxies", async () => {
    // Without the prefix the request resolves to the SPA's own index.html and the
    // pricing page silently shows nothing.
    const source = await readFile(resolve("src/api/public-billing.ts"), "utf8");
    expect(source).toMatch(/VITE_API_BASE_URL as string \| undefined\) \?\? "\/api"/);

    const proxied = await readFile(resolve("vite.config.ts"), "utf8");
    expect(proxied).toContain('"/api"');
  });
});
