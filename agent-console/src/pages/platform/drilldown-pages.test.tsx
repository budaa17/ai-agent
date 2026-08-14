import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformApi } from "../../api/platform-client";
import {
  agentDetailFixture,
  agentListFixture,
  agentRunDiagnosticsFixture,
  agentRunListFixture,
  auditLogFixture,
  listPage,
  reviewBacklogFixture,
  reviewSummaryFixture,
  systemHealthFixture,
  tenantHealthFixture,
  tenantListFixture,
  usageFixture,
} from "../../test/platform-drilldown-fixture";
import { PlatformAgentDetailPage } from "./agent-detail-page";
import { PlatformAgentRunDiagnosticsPage } from "./agent-run-diagnostics-page";
import { PlatformAgentRunsPage } from "./agent-runs-page";
import { PlatformAgentsPage } from "./agents-page";
import { PlatformAuditPage } from "./audit-page";
import { PlatformReviewQualityPage } from "./review-quality-page";
import { PlatformSystemHealthPage } from "./system-health-page";
import { PlatformTenantHealthPage } from "./tenant-health-page";
import { PlatformTenantsPage } from "./tenants-page";
import { PlatformUsagePage } from "./usage-page";

vi.mock("../../api/platform-client", () => ({
  platformApi: {
    tenants: vi.fn(),
    tenantHealth: vi.fn(),
    agents: vi.fn(),
    agentDetail: vi.fn(),
    agentRuns: vi.fn(),
    agentRunDiagnostics: vi.fn(),
    reviewSummary: vi.fn(),
    reviewBacklog: vi.fn(),
    usage: vi.fn(),
    systemHealth: vi.fn(),
    auditLogs: vi.fn(),
  },
}));

const api = vi.mocked(platformApi);

function renderRoute(path: string, initialEntry: string, element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("platform tenant drill-down pages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("renders the tenant list with health, causes and a link into the detail page", async () => {
    api.tenants.mockResolvedValue(structuredClone(tenantListFixture));
    renderRoute("/platform/tenants", "/platform/tenants", <PlatformTenantsPage />);

    expect(await screen.findByText("Breached Construction")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Breached Construction" })).toHaveAttribute(
      "href",
      "/platform/tenants/tenant-breached/health",
    );
    expect(screen.getByRole("link", { name: "Review SLA is breached" })).toBeInTheDocument();
    const warningBadges = screen.getAllByText("Анхаарах");
    expect(warningBadges.length).toBeGreaterThan(0);
    expect(api.tenants).toHaveBeenCalledWith(expect.objectContaining({ window: "24h" }));
  });

  it("keeps the tenant filter in the URL and sends it to the API", async () => {
    api.tenants.mockResolvedValue(structuredClone(tenantListFixture));
    renderRoute(
      "/platform/tenants",
      "/platform/tenants?window=7d&health=WARNING&search=breach",
      <PlatformTenantsPage />,
    );

    await screen.findByText("Breached Construction");
    expect(api.tenants).toHaveBeenCalledWith({
      window: "7d",
      health: "WARNING",
      search: "breach",
    });
  });

  it("advances the tenant list with the server cursor and never invents one", async () => {
    const firstPage = structuredClone(tenantListFixture);
    firstPage.page = listPage({ hasMore: true, nextCursor: "cursor-2" });
    api.tenants.mockResolvedValue(firstPage);
    renderRoute("/platform/tenants", "/platform/tenants", <PlatformTenantsPage />);

    await screen.findByText("Breached Construction");
    const previous = screen.getByRole("button", { name: /Өмнөх/ });
    expect(previous).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /Дараах/ }));
    await waitFor(() =>
      expect(api.tenants).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-2" })),
    );
  });

  it("surfaces a partial tenant response as a retryable problem banner", async () => {
    const partial = structuredClone(tenantListFixture);
    partial.partial = true;
    partial.problems = [
      {
        section: "TENANTS",
        code: "SOURCE_UNAVAILABLE",
        message: "Tenant data is temporarily unavailable.",
        retryable: true,
      },
    ];
    api.tenants.mockResolvedValue(partial);
    renderRoute("/platform/tenants", "/platform/tenants", <PlatformTenantsPage />);

    expect(
      await screen.findByText("Tenant data is temporarily unavailable.", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Дахин оролдох" })).toBeInTheDocument();
  });

  it("shows a retryable error state when the tenant list request fails", async () => {
    api.tenants.mockRejectedValue(new Error("network down"));
    renderRoute("/platform/tenants", "/platform/tenants", <PlatformTenantsPage />);

    expect(
      await screen.findByText("Tenant жагсаалт ачаалсангүй", {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it("renders tenant health sections including delivery components and storage", async () => {
    api.tenantHealth.mockResolvedValue(structuredClone(tenantHealthFixture));
    renderRoute(
      "/platform/tenants/:tenantId/health",
      "/platform/tenants/tenant-breached/health",
      <PlatformTenantHealthPage />,
    );

    expect(
      await screen.findByRole("heading", { name: "Breached Construction" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Хэрэглэгчийн идэвх")).toBeInTheDocument();
    expect(screen.getByText("Агентын гүйцэтгэл")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OUTBOX" })).toHaveAttribute(
      "href",
      "/platform/system-health?component=OUTBOX&tenantId=tenant-breached",
    );
    expect(screen.getByText("Файл хадгалалт")).toBeInTheDocument();
    expect(api.tenantHealth).toHaveBeenCalledWith("tenant-breached", { window: "24h" });
  });
});

describe("platform agent drill-down pages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("labels a below-minimum sample instead of printing a misleading percentage", async () => {
    api.agents.mockResolvedValue(structuredClone(agentListFixture));
    renderRoute("/platform/agents", "/platform/agents", <PlatformAgentsPage />);

    const row = (await screen.findByRole("link", { name: "A2_FORECAST" })).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Sample хүрэлцэхгүй")).toBeInTheDocument();

    const degradedRow = screen.getByRole("link", { name: "A1_PROGRESS" }).closest("tr");
    expect(within(degradedRow!).getByText("85%")).toBeInTheDocument();
  });

  it("renders the agent detail breakdowns and links back into filtered runs", async () => {
    api.agentDetail.mockResolvedValue(structuredClone(agentDetailFixture));
    renderRoute(
      "/platform/agents/:agentType",
      "/platform/agents/A1_PROGRESS",
      <PlatformAgentDetailPage />,
    );

    expect(await screen.findByText("Алдааны ангилал")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PROVIDER" })).toHaveAttribute(
      "href",
      "/platform/agent-runs?agentType=A1_PROGRESS&failureCategory=PROVIDER",
    );
    expect(screen.getByText("Компаниар")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("marks stuck runs and shows the cost basis for each run", async () => {
    api.agentRuns.mockResolvedValue(structuredClone(agentRunListFixture));
    renderRoute("/platform/agent-runs", "/platform/agent-runs", <PlatformAgentRunsPage />);

    const stuckRow = (await screen.findByRole("link", { name: "run-stuck" })).closest("tr");
    expect(within(stuckRow!).getByText("Stuck")).toBeInTheDocument();
    expect(within(stuckRow!).getByText("Тооцоолсон")).toBeInTheDocument();

    const doneRow = screen.getByRole("link", { name: "run-done" }).closest("tr");
    expect(within(doneRow!).getByText("Бодит")).toBeInTheDocument();
  });

  it("passes the run filters from the URL through to the API", async () => {
    api.agentRuns.mockResolvedValue(structuredClone(agentRunListFixture));
    renderRoute(
      "/platform/agent-runs",
      "/platform/agent-runs?tenantId=tenant-breached&agentType=A1_PROGRESS&outcome=NON_COMPLETION&stuck=true",
      <PlatformAgentRunsPage />,
    );

    await screen.findByRole("link", { name: "run-stuck" });
    expect(api.agentRuns).toHaveBeenCalledWith({
      window: "24h",
      tenantId: "tenant-breached",
      agentType: "A1_PROGRESS",
      outcome: "NON_COMPLETION",
      stuck: "true",
    });
  });

  it("renders diagnostics metadata and the redaction notice without run content", async () => {
    api.agentRunDiagnostics.mockResolvedValue(structuredClone(agentRunDiagnosticsFixture));
    renderRoute(
      "/platform/agent-runs/:runId/diagnostics",
      "/platform/agent-runs/run-done/diagnostics",
      <PlatformAgentRunDiagnosticsPage />,
    );

    expect(await screen.findByText("Агуулга харуулаагүй")).toBeInTheDocument();
    expect(screen.getByText("Tool дуудлага")).toBeInTheDocument();
    expect(screen.getByText("read_progress")).toBeInTheDocument();
    for (const field of ["request", "output", "researchText", "errorMessage"]) {
      expect(screen.getByText(field)).toBeInTheDocument();
    }
    expect(screen.getByText("platform-diagnostics-redaction.v1")).toBeInTheDocument();
  });
});

describe("platform review, usage, system and audit pages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows the review summary without any approve or reject action", async () => {
    api.reviewSummary.mockResolvedValue(structuredClone(reviewSummaryFixture));
    renderRoute(
      "/platform/review-quality",
      "/platform/review-quality",
      <PlatformReviewQualityPage />,
    );

    expect(await screen.findByText("Хүлээлтийн хуваарилалт")).toBeInTheDocument();
    expect(screen.getByText("Шийдвэрийн урсгал")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Зөвшөөрөх|Татгалзах|Approve|Reject/ })).toBeNull();
    expect(api.reviewBacklog).not.toHaveBeenCalled();
  });

  it("switches to the backlog view and classifies the SLA state", async () => {
    api.reviewSummary.mockResolvedValue(structuredClone(reviewSummaryFixture));
    api.reviewBacklog.mockResolvedValue(structuredClone(reviewBacklogFixture));
    renderRoute(
      "/platform/review-quality",
      "/platform/review-quality?view=backlog",
      <PlatformReviewQualityPage />,
    );

    const row = (await screen.findByText("review-breached")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Хугацаа хэтэрсэн")).toBeInTheDocument();
    expect(api.reviewSummary).not.toHaveBeenCalled();
  });

  it("reports usage coverage and states that no budget model is configured", async () => {
    api.usage.mockResolvedValue(structuredClone(usageFixture));
    renderRoute("/platform/usage", "/platform/usage", <PlatformUsagePage />);

    expect(await screen.findByText("Token хэрэглээ")).toBeInTheDocument();
    expect(screen.getByText("Тохируулаагүй")).toBeInTheDocument();
    expect(screen.getByText("Quota/limit модель хараахан алга")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Breached Construction" })).toHaveAttribute(
      "href",
      "/platform/tenants/tenant-breached/health",
    );
  });

  it("renders component health and tenant impact without an uptime percentage", async () => {
    api.systemHealth.mockResolvedValue(structuredClone(systemHealthFixture));
    renderRoute(
      "/platform/system-health",
      "/platform/system-health?component=OUTBOX",
      <PlatformSystemHealthPage />,
    );

    expect(await screen.findByRole("heading", { name: "OUTBOX" })).toBeInTheDocument();
    expect(screen.getByText("Event төрлөөр")).toBeInTheDocument();
    expect(screen.getByText("REPORT_SUBMITTED")).toBeInTheDocument();
    // Probe history does not exist yet, so no SLO or uptime figure may appear.
    expect(screen.queryByText(/\d+(\.\d+)?%/)).toBeNull();
    expect(api.systemHealth).toHaveBeenCalledWith({});
  });

  it("renders audit rows with hash evidence and forwards the result filter", async () => {
    const user = userEvent.setup();
    api.auditLogs.mockResolvedValue(structuredClone(auditLogFixture));
    renderRoute("/platform/audit", "/platform/audit?result=SUCCESS", <PlatformAuditPage />);

    expect(await screen.findByText("PLATFORM_TENANT_HEALTH_READ")).toBeInTheDocument();
    expect(screen.getByText(/before: bbbbbbbbbbbb…/)).toBeInTheDocument();
    expect(api.auditLogs).toHaveBeenCalledWith({ window: "24h", result: "SUCCESS" });

    await user.selectOptions(screen.getByLabelText("Audit эх үүсвэр"), "TENANT");
    await user.selectOptions(screen.getByLabelText("Role"), "ENGINEER");
    await user.click(screen.getByRole("button", { name: "Filter хэрэглэх" }));

    await waitFor(() =>
      expect(api.auditLogs).toHaveBeenLastCalledWith({
        window: "24h",
        result: "SUCCESS",
        source: "TENANT",
        actorRole: "ENGINEER",
      }),
    );
  });
});
