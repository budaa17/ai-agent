import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPlans } from "../../api/public-billing";
import { MarketingShell } from "../../marketing/marketing-shell";
import { LandingPage } from "./landing-page";

vi.mock("../../api/public-billing", async () => {
  const actual = await vi.importActual<typeof import("../../api/public-billing")>(
    "../../api/public-billing",
  );
  return { ...actual, fetchPublicPlans: vi.fn() };
});

const mockedFetchPublicPlans = vi.mocked(fetchPublicPlans);

/** Amounts unlike the real catalog, so a hard-coded copy would stand out. */
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
        { interval: "MONTH" as const, unitAmountMinor: "55500000" },
        { interval: "YEAR" as const, unitAmountMinor: "555000000" },
      ],
      entitlements: [
        { featureKey: "PROJECT_ACTIVE_MAX", enabled: true, limitValue: "2", unit: "project" },
        { featureKey: "USER_ACTIVE_MAX", enabled: true, limitValue: "22", unit: "user" },
        {
          featureKey: "AI_MONTHLY_RUNS_INCLUDED",
          enabled: true,
          limitValue: "222",
          unit: "agentRun",
        },
      ],
    },
  ],
};

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("landing page pricing", () => {
  beforeEach(() => {
    mockedFetchPublicPlans.mockReset();
    mockedFetchPublicPlans.mockResolvedValue(CATALOG);
  });

  it("shows the price on the landing page itself, not only behind a link", async () => {
    // A visitor who has to click through to learn the price is a visitor who
    // often does not click through.
    renderLanding();
    await waitFor(() => expect(screen.getByText("555,000₮")).toBeInTheDocument());
    expect(screen.getByText(/2 идэвхтэй төсөл/)).toBeInTheDocument();
    expect(screen.getByText(/Сард 222 AI ажиллагаа/)).toBeInTheDocument();
  });

  it("derives the annual saving rather than stating one", async () => {
    renderLanding();
    // 12 × 555,000 − 5,550,000
    await waitFor(() => expect(screen.getByText(/1,110,000₮ хэмнэнэ/)).toBeInTheDocument());
  });

  it("still points at the full comparison", async () => {
    renderLanding();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /бүрэн харьцуулалт/i })).toHaveAttribute(
        "href",
        "/pricing",
      ),
    );
  });

  it("preserves the selected plan and yearly interval in the signup CTA", async () => {
    renderLanding();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Starter сонгох" })).toHaveAttribute(
        "href",
        "/company-signup?plan=starter&interval=YEAR",
      ),
    );
  });

  it("names Enterprise as negotiated instead of inventing a number", async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText("Гэрээт")).toBeInTheDocument());
  });

  it("labels the hero visual as illustrative and carries no fabricated live metric", async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText("555,000₮")).toBeInTheDocument());
    expect(screen.getByText(/Жишээ дүрслэл · бодит төслийн үзүүлэлт биш/i)).toBeInTheDocument();
    expect(screen.queryByText(/PROJECT ATLAS ONLINE|78\.4%|04 \/ 04/i)).not.toBeInTheDocument();
  });
});

describe("landing page social and search metadata", () => {
  beforeEach(() => {
    mockedFetchPublicPlans.mockReset();
    mockedFetchPublicPlans.mockResolvedValue(CATALOG);
  });

  it("publishes a share image so a pasted link is not a blank card", async () => {
    renderLanding();
    await waitFor(() =>
      expect(document.head.querySelector('meta[property="og:image"]')).not.toBeNull(),
    );
    const image = document.head
      .querySelector<HTMLMetaElement>('meta[property="og:image"]')!
      .getAttribute("content")!;
    // Crawlers do not resolve relative URLs against the page.
    expect(image.startsWith("http")).toBe(true);
    expect(image).toContain("/og-image");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="twitter:card"]')?.content).toBe(
      "summary_large_image",
    );
  });

  it("emits structured data carrying the API's own prices", async () => {
    renderLanding();
    await waitFor(() =>
      expect(document.head.querySelector('script[type="application/ld+json"]')).not.toBeNull(),
    );
    const payload = JSON.parse(
      document.head.querySelector<HTMLScriptElement>('script[type="application/ld+json"]')!.text,
    );
    expect(payload["@type"]).toBe("SoftwareApplication");
    // Major units, and the VAT position is stated rather than implied.
    expect(payload.offers).toContainEqual(
      expect.objectContaining({
        price: "555000",
        priceCurrency: "MNT",
        valueAddedTaxIncluded: false,
      }),
    );
  });
});

describe("marketing navigation on a small screen", () => {
  beforeEach(() => {
    mockedFetchPublicPlans.mockReset();
    mockedFetchPublicPlans.mockResolvedValue(CATALOG);
  });

  function renderShell(initialEntry = "/") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<MarketingShell />}>
            <Route path="/" element={<div>landing</div>} />
            <Route path="/features" element={<div>features</div>} />
            <Route path="/pricing" element={<div>pricing</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("opens and closes a labelled menu button", async () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Цэс нээх" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Цэс хаах" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("navigation", { name: "Гар утасны цэс" })).toBeInTheDocument();
  });

  it("returns from a feature page to the landing page through the visible Home link", async () => {
    renderShell("/features");
    expect(screen.getByText("features")).toBeInTheDocument();

    const desktopNav = screen.getByRole("navigation", { name: "Үндсэн цэс" });
    await userEvent.click(within(desktopNav).getByRole("link", { name: "Нүүр" }));

    expect(await screen.findByText("landing")).toBeInTheDocument();
  });

  it("closes itself after navigating, instead of covering the new page", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Цэс нээх" }));
    const menu = screen.getByRole("navigation", { name: "Гар утасны цэс" });
    await userEvent.click(within(menu).getByRole("link", { name: "Боломжууд" }));

    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "Гар утасны цэс" })).not.toBeInTheDocument(),
    );
  });
});

describe("route resolution", () => {
  beforeEach(() => {
    mockedFetchPublicPlans.mockReset();
    mockedFetchPublicPlans.mockResolvedValue(CATALOG);
  });

  it("serves the landing page at / rather than redirecting a visitor to sign in", async () => {
    // Regression: an `index` route inside the authenticated tree outranked the
    // public `/` route in React Router's matcher, so every visitor landed on the
    // sign-in screen. Rendering <LandingPage /> directly could never catch it —
    // the whole router has to take part.
    const { App } = await import("../../app");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Өнөөдрийн ажил төлөвлөснөөрөө явсан уу/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/SECURE ACCESS/i)).not.toBeInTheDocument();
  });
});
