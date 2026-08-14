import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformApi } from "../../api/platform-client";
import type { PlatformOverview } from "../../api/platform-schemas";
import { platformOverviewFixture } from "../../test/platform-overview-fixture";
import { ControlTowerPage } from "./control-tower-page";

vi.mock("../../api/platform-client", () => ({
  platformApi: { overview: vi.fn() },
}));

const mockedOverview = vi.mocked(platformApi.overview);

function renderPage(initialEntry = "/platform") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/platform" element={<ControlTowerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function stateFixture(): PlatformOverview {
  const fixture = structuredClone(platformOverviewFixture);
  fixture.kpis.criticalIssues.context.state = "UNKNOWN";
  fixture.kpis.criticalIssues.value = null;
  fixture.kpis.criticalIssues.critical = null;
  fixture.kpis.criticalIssues.high = null;
  fixture.kpis.tenantHealth.context.state = "NO_DATA";
  fixture.kpis.tenantHealth.healthy = null;
  fixture.kpis.tenantHealth.total = null;
  fixture.kpis.agentCompletion.context.state = "INSUFFICIENT_SAMPLE";
  fixture.kpis.agentCompletion.context.sampleSize = 2;
  fixture.kpis.agentCompletion.context.minimumSample = 20;
  fixture.kpis.agentCompletion.valuePercent = null;
  fixture.kpis.aiSpend.context.freshness = {
    ...fixture.kpis.aiSpend.context.freshness,
    state: "STALE",
    ageSeconds: 900,
    reason: "Usage rollup delayed",
  };
  return fixture;
}

describe("ControlTowerPage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("renders backend-owned status and all real overview sections without fake KPI", async () => {
    mockedOverview.mockResolvedValue(structuredClone(platformOverviewFixture));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Доголдолтой" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Critical Issues" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tenant Health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent Completion" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review SLA" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Spend" })).toBeInTheDocument();
    expect(screen.getByText("$184.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atlas Construction" })).toBeInTheDocument();
    expect(screen.getByText("PLATFORM_LOGIN_SUCCEEDED")).toBeInTheDocument();
    expect(screen.getByText("1 active signal")).toBeInTheDocument();
    expect(screen.getByText("Нээлттэй")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acknowledge|resolve/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Platform shell бэлэн боллоо")).not.toBeInTheDocument();
  });

  it("never turns UNKNOWN, NO_DATA or insufficient sample into zero", async () => {
    mockedOverview.mockResolvedValue(stateFixture());
    renderPage();

    expect(await screen.findByText("Тооцоолох боломжгүй")).toBeInTheDocument();
    expect(screen.getByText("Өгөгдөл алга")).toBeInTheDocument();
    expect(screen.getByText("Sample хүрэлцэхгүй")).toBeInTheDocument();
    expect(screen.getAllByText(/Хоцорсон/).length).toBeGreaterThan(0);
    expect(screen.queryByText("0 open")).not.toBeInTheDocument();
  });

  it("keeps surviving widgets visible and exposes local retry for a partial response", async () => {
    const partial = structuredClone(platformOverviewFixture);
    partial.partial = true;
    partial.problems = [
      {
        section: "AGENTS",
        code: "SOURCE_UNAVAILABLE",
        message: "Agent aggregate source unavailable",
        retryable: true,
      },
    ];
    partial.agentHealthPreview.context.state = "UNKNOWN";
    partial.agentHealthPreview.items = [];
    mockedOverview.mockResolvedValue(partial);
    renderPage();

    expect(await screen.findByRole("link", { name: "Atlas Construction" })).toBeInTheDocument();
    expect(screen.getAllByText("Agent aggregate source unavailable").length).toBeGreaterThan(1);
    expect(screen.getByText("Энэ хэсгийн эх үүсвэр боломжгүй")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Дахин оролдох" }).length).toBeGreaterThan(0);
  });

  it("reads preset and scope filters from the URL into the API query key", async () => {
    mockedOverview.mockResolvedValue(structuredClone(platformOverviewFixture));
    renderPage("/platform?window=7d&tenantId=tenant-atlas&agentType=A1");

    await waitFor(() =>
      expect(mockedOverview).toHaveBeenCalledWith({
        window: "7d",
        tenantId: "tenant-atlas",
        agentType: "A1",
      }),
    );
  });

  it("formats cost comparison units and safely encodes drill-down path parameters", async () => {
    const fixture = structuredClone(platformOverviewFixture);
    fixture.kpis.aiSpend.context.comparison = {
      state: "AVAILABLE",
      kind: "PREVIOUS_MONTH_COMPARABLE",
      window: {
        kind: "PREVIOUS_MONTH_COMPARABLE",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-11T00:00:00.000Z",
        timeZone: "UTC",
      },
      previousValue: 150_000_000,
      delta: 34_000_000,
      deltaUnit: "MICRO_USD",
    };
    const tenant = fixture.tenantHealthPreview.items[0];
    const agent = fixture.agentHealthPreview.items[0];
    if (tenant === undefined || agent === undefined) throw new Error("Fixture preview missing");
    tenant.tenantId = "tenant/atlas";
    agent.agentType = "A1:daily";
    mockedOverview.mockResolvedValue(fixture);
    renderPage();

    expect(await screen.findByText("Өмнөх: $150.00 · Δ +$34.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atlas Construction" })).toHaveAttribute(
      "href",
      "/platform/tenants/tenant%2Fatlas/health",
    );
    expect(screen.getByRole("link", { name: "A1:daily" })).toHaveAttribute(
      "href",
      "/platform/agents/A1%3Adaily",
    );
  });

  it("uses tenant unknownFields even when a stale subobject still contains numbers", async () => {
    const fixture = structuredClone(platformOverviewFixture);
    const tenant = fixture.tenantHealthPreview.items[0];
    if (tenant === undefined) throw new Error("Fixture tenant missing");
    tenant.unknownFields = ["USERS", "AI_SPEND"];
    mockedOverview.mockResolvedValue(fixture);
    renderPage();

    const tenantLink = await screen.findByRole("link", { name: "Atlas Construction" });
    const row = tenantLink.closest("tr");
    if (row === null) throw new Error("Tenant row missing");
    expect(within(row).getAllByText("— Тодорхойгүй").length).toBeGreaterThanOrEqual(2);
    expect(within(row).queryByText("12")).not.toBeInTheDocument();
  });

  it("renders a full-page retry state when the overview request fails", async () => {
    mockedOverview.mockRejectedValue(new Error("overview unavailable"));
    renderPage();

    expect(await screen.findByRole("alert", {}, { timeout: 3_000 })).toHaveTextContent(
      "overview unavailable",
    );
  });
});
