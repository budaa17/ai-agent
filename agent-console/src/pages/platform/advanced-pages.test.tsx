import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformApi } from "../../api/platform-client";
import type {
  PlatformQuality,
  PlatformQualityMetric,
  PlatformSupportAccessDetail,
  PlatformSupportAccessGrant,
  PlatformSupportAccessList,
  PlatformSupportAccessMutation,
} from "../../api/platform-schemas";
import { availableSectionContext } from "../../test/platform-overview-fixture";
import { PlatformQualityPage } from "./quality-page";
import { PlatformSupportAccessDetailPage } from "./support-access-detail-page";
import { PlatformSupportAccessPage } from "./support-access-page";

vi.mock("../../api/platform-client", () => ({
  platformApi: {
    quality: vi.fn(),
    supportAccessGrants: vi.fn(),
    supportAccessGrant: vi.fn(),
    requestSupportAccess: vi.fn(),
    decideSupportAccess: vi.fn(),
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

const metricWindow = {
  from: "2026-07-12T00:00:00.000Z",
  to: "2026-08-11T00:00:00.000Z",
  timeZone: "UTC" as const,
};

function metric(overrides: Partial<PlatformQualityMetric> = {}): PlatformQualityMetric {
  return {
    kind: "OFFLINE_EVALUATION",
    label: "Offline evaluation",
    definition: "Passed cases divided by scored cases.",
    state: "AVAILABLE",
    valuePercent: 90,
    passed: 108,
    total: 120,
    sampleSize: 120,
    minimumSample: 20,
    window: metricWindow,
    freshAt: "2026-08-10T00:00:00.000Z",
    previousValuePercent: 85,
    deltaPercentagePoints: 5,
    source: "a1-regression@2026.08",
    ...overrides,
  };
}

const qualityFixture: PlatformQuality = {
  schemaVersion: "platform-quality.v1",
  generatedAt: "2026-08-11T00:00:00.000Z",
  asOf: "2026-08-11T00:00:00.000Z",
  partial: false,
  problems: [],
  filters: { window: "30d", agentType: null },
  metrics: {
    context: availableSectionContext,
    items: [
      metric(),
      metric({
        kind: "PRODUCTION_VALIDATION",
        label: "Production validation",
        valuePercent: 95,
        passed: 190,
        total: 200,
        sampleSize: 200,
        source: "AgentRun.validation",
      }),
      metric({
        kind: "HUMAN_FEEDBACK",
        label: "Human feedback",
        state: "INSUFFICIENT_SAMPLE",
        valuePercent: null,
        passed: 4,
        total: 5,
        sampleSize: 5,
        source: "AgentFeedback",
      }),
    ],
  },
  byAgent: {
    context: availableSectionContext,
    items: [
      {
        agentType: "A1_PROGRESS",
        offline: metric(),
        production: metric({ kind: "PRODUCTION_VALIDATION", valuePercent: 95 }),
        humanFeedback: null,
        detailHref: "/platform/agents/A1_PROGRESS",
      },
    ],
  },
  releases: {
    context: availableSectionContext,
    total: 2,
    truncated: false,
    items: [
      {
        agentRelease: "a1.v3+tools.v2",
        promptVersion: "a1.v3",
        modelId: "claude-sonnet-5",
        provider: "anthropic",
        firstSeenAt: "2026-08-08T00:00:00.000Z",
        lastSeenAt: "2026-08-11T00:00:00.000Z",
        offline: metric({ valuePercent: 95 }),
        production: metric({ kind: "PRODUCTION_VALIDATION", valuePercent: 95 }),
        humanFeedback: null,
        runs: 130,
      },
      {
        agentRelease: "a1.v2+tools.v1",
        promptVersion: "a1.v2",
        modelId: "claude-sonnet-5",
        provider: "anthropic",
        firstSeenAt: "2026-08-01T00:00:00.000Z",
        lastSeenAt: "2026-08-07T00:00:00.000Z",
        offline: null,
        production: metric({ kind: "PRODUCTION_VALIDATION", valuePercent: 80 }),
        humanFeedback: null,
        runs: 95,
      },
    ],
  },
  evaluationHistory: {
    context: availableSectionContext,
    total: 2,
    items: [
      {
        runId: "eval-large",
        suiteKey: "a1-regression",
        suiteVersion: "2026.08",
        agentType: "A1_PROGRESS",
        agentRelease: "a1.v3+tools.v2",
        caseCount: 100,
        passedCount: 91,
        failedCount: 9,
        skippedCount: 0,
        scorePercent: 91,
        completedAt: "2026-08-10T00:00:00.000Z",
        sourceRef: "ci-1234",
      },
      {
        runId: "eval-small",
        suiteKey: "a1-smoke",
        suiteVersion: "2026.08",
        agentType: "A1_PROGRESS",
        agentRelease: "a1.v3+tools.v2",
        caseCount: 4,
        passedCount: 4,
        failedCount: 0,
        skippedCount: 0,
        scorePercent: null,
        completedAt: "2026-08-09T00:00:00.000Z",
        sourceRef: null,
      },
    ],
  },
};

const grant: PlatformSupportAccessGrant = {
  grantId: "grant-1",
  ticketReference: "SUP-1042",
  reason: "Investigating stalled outbox delivery reported by the tenant",
  tenantId: "tenant-alpha",
  tenantName: "Alpha",
  projectId: null,
  allowedOperations: ["READ_TENANT_HEALTH", "READ_SYSTEM_HEALTH"],
  maskedOnly: true,
  state: "REQUESTED",
  active: false,
  requestedBy: { principalId: "platform-admin", displayName: "Platform Admin" },
  requestedAt: "2026-08-11T00:00:00.000Z",
  approvedBy: null,
  approvedAt: null,
  startsAt: null,
  expiresAt: "2026-08-11T04:00:00.000Z",
  expiresInSeconds: 14_400,
  decisionReason: null,
  revokedBy: null,
  revokedAt: null,
  useCount: 0,
  lastUsedAt: null,
  detailHref: "/platform/support-access/grant-1",
  rowVersion: 1,
};

const listFixture: PlatformSupportAccessList = {
  schemaVersion: "platform-support-access.v1",
  generatedAt: "2026-08-11T00:00:00.000Z",
  asOf: "2026-08-11T00:00:00.000Z",
  partial: false,
  problems: [],
  filters: { state: null, activeOnly: false, tenantId: null },
  page: { limit: 25, hasMore: false, nextCursor: null, sort: "REQUESTED_AT", order: "DESC" },
  totals: { requested: 1, approved: 0, active: 0, expired: 0, revoked: 0, denied: 0 },
  items: [grant],
};

function detailFixture(
  overrides: Partial<PlatformSupportAccessDetail> = {},
): PlatformSupportAccessDetail {
  return {
    schemaVersion: "platform-support-access-detail.v1",
    generatedAt: "2026-08-11T00:00:00.000Z",
    asOf: "2026-08-11T00:00:00.000Z",
    partial: false,
    problems: [],
    grant,
    timeline: {
      total: 1,
      truncated: false,
      items: [
        {
          eventId: "event-1",
          type: "REQUESTED",
          fromState: null,
          toState: "REQUESTED",
          actor: { principalId: "platform-admin", displayName: "Platform Admin" },
          actorRole: "PLATFORM_SUPER_ADMIN",
          reason: "Investigating stalled outbox delivery",
          correlationId: "correlation-1",
          occurredAt: "2026-08-11T00:00:00.000Z",
        },
      ],
    },
    allowedActions: ["APPROVE", "DENY"],
    canApprove: true,
    ...overrides,
  };
}

function mutationFixture(
  overrides: Partial<PlatformSupportAccessMutation> = {},
): PlatformSupportAccessMutation {
  return {
    schemaVersion: "platform-support-access-mutation.v1",
    generatedAt: "2026-08-11T00:05:00.000Z",
    asOf: "2026-08-11T00:05:00.000Z",
    partial: false,
    problems: [],
    grant: { ...grant, state: "APPROVED", active: true, rowVersion: 2 },
    event: {
      eventId: "event-2",
      type: "APPROVED",
      fromState: "REQUESTED",
      toState: "APPROVED",
      actor: { principalId: "platform-second", displayName: "Second Approver" },
      actorRole: "PLATFORM_SUPER_ADMIN",
      reason: "Verified the ticket with the tenant owner",
      correlationId: "correlation-2",
      occurredAt: "2026-08-11T00:05:00.000Z",
    },
    change: {
      beforeHash: "a".repeat(64),
      afterHash: "b".repeat(64),
      summary: "state REQUESTED → APPROVED",
      idempotent: false,
      correlationId: "correlation-2",
    },
    ...overrides,
  };
}

describe("platform AI quality page", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows three separate metrics and never a combined score", async () => {
    api.quality.mockResolvedValue(structuredClone(qualityFixture));
    renderRoute("/platform/quality", "/platform/quality", <PlatformQualityPage />);

    expect(await screen.findByText("Offline evaluation")).toBeInTheDocument();
    expect(screen.getByText("Production validation")).toBeInTheDocument();
    expect(screen.getByText("Human feedback")).toBeInTheDocument();
    expect(screen.queryByText(/AI Quality Score/i)).toBeNull();
    expect(screen.getByText("Эх сурвалж: a1-regression@2026.08")).toBeInTheDocument();
  });

  it("labels an insufficient sample instead of printing a percentage", async () => {
    api.quality.mockResolvedValue(structuredClone(qualityFixture));
    renderRoute("/platform/quality", "/platform/quality", <PlatformQualityPage />);

    const card = (await screen.findByText("Human feedback")).closest<HTMLElement>(".card");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("Sample хүрэлцэхгүй")).toBeInTheDocument();
  });

  it("compares releases and marks an unmeasured metric as not measured", async () => {
    api.quality.mockResolvedValue(structuredClone(qualityFixture));
    renderRoute("/platform/quality", "/platform/quality", <PlatformQualityPage />);

    const row = (await screen.findByText("a1.v2+tools.v1")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("80%")).toBeInTheDocument();
    expect(within(row!).getAllByText("Хэмжээгүй").length).toBeGreaterThan(0);
  });

  it("lists persisted evaluation history and withholds a small suite score", async () => {
    api.quality.mockResolvedValue(structuredClone(qualityFixture));
    renderRoute("/platform/quality", "/platform/quality", <PlatformQualityPage />);

    const row = (await screen.findByText("a1-smoke")).closest("tr");
    expect(within(row!).getByText("Sample хүрэлцэхгүй")).toBeInTheDocument();
    expect(screen.getByText("ci-1234")).toBeInTheDocument();
  });

  it("forwards the window and agent filter from the URL", async () => {
    api.quality.mockResolvedValue(structuredClone(qualityFixture));
    renderRoute(
      "/platform/quality",
      "/platform/quality?window=7d&agentType=A1_PROGRESS",
      <PlatformQualityPage />,
    );

    await screen.findByText("Offline evaluation");
    expect(api.quality).toHaveBeenCalledWith({ window: "7d", agentType: "A1_PROGRESS" });
  });

  it("explains which evidence pipeline is missing instead of implying healthy quality", async () => {
    const noData = structuredClone(qualityFixture);
    noData.metrics.items = noData.metrics.items.map((item) => ({
      ...item,
      state: "NO_DATA" as const,
      valuePercent: null,
      passed: 0,
      total: 0,
      sampleSize: 0,
    }));
    api.quality.mockResolvedValue(noData);
    renderRoute("/platform/quality", "/platform/quality", <PlatformQualityPage />);

    expect(await screen.findByText("Чанарын хэмжилт бүрэн бэлэн биш")).toBeInTheDocument();
    expect(screen.getByText(/PlatformEvaluationRun history/)).toBeInTheDocument();
    expect(screen.getByText(/validation\.ok verdict/)).toBeInTheDocument();
    expect(screen.getByText(/AgentFeedback ACCEPT\/CORRECT\/REJECT/)).toBeInTheDocument();
  });
});

describe("platform support access pages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists grants with their scope and remaining window", async () => {
    api.supportAccessGrants.mockResolvedValue(structuredClone(listFixture));
    renderRoute(
      "/platform/support-access",
      "/platform/support-access",
      <PlatformSupportAccessPage />,
    );

    expect(await screen.findByRole("link", { name: "SUP-1042" })).toHaveAttribute(
      "href",
      "/platform/support-access/grant-1",
    );
    expect(screen.getByText("зөвхөн унших · маскласан")).toBeInTheDocument();
    expect(screen.getByText("4 цаг үлдсэн")).toBeInTheDocument();
  });

  it("requires a ticket and reason before a request reaches the API", async () => {
    api.supportAccessGrants.mockResolvedValue(structuredClone(listFixture));
    api.requestSupportAccess.mockResolvedValue(mutationFixture());
    renderRoute(
      "/platform/support-access",
      "/platform/support-access",
      <PlatformSupportAccessPage />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Хандалт хүсэх/ }));
    const form = screen.getByRole("form", { name: "Хандалт хүсэх" });
    await userEvent.click(within(form).getByRole("button", { name: "Хүсэлт илгээх" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Тасалбарын дугаар");
    expect(api.requestSupportAccess).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByLabelText("Тасалбарын дугаар"), "SUP-2001");
    await userEvent.type(
      within(form).getByLabelText("Шалтгаан (audit-д хадгалагдана)"),
      "Investigating a stalled outbox for this tenant",
    );
    await userEvent.type(within(form).getByLabelText("Tenant ID"), "tenant-alpha");
    await userEvent.click(within(form).getByRole("button", { name: "Хүсэлт илгээх" }));

    await waitFor(() =>
      expect(api.requestSupportAccess).toHaveBeenCalledWith({
        ticketReference: "SUP-2001",
        reason: "Investigating a stalled outbox for this tenant",
        tenantId: "tenant-alpha",
        allowedOperations: ["READ_TENANT_HEALTH"],
        durationSeconds: 3_600,
      }),
    );
    expect(await screen.findByText(/Хоёр дахь хүн зөвшөөрөх хүртэл/)).toBeInTheDocument();
  });

  it("approves a grant with a reason and reports the recorded change", async () => {
    api.supportAccessGrant.mockResolvedValue(detailFixture());
    api.decideSupportAccess.mockResolvedValue(mutationFixture());
    renderRoute(
      "/platform/support-access/:grantId",
      "/platform/support-access/grant-1",
      <PlatformSupportAccessDetailPage />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Зөвшөөрөх" }));
    const form = screen.getByRole("form", { name: "Зөвшөөрөх" });
    await userEvent.type(
      within(form).getByLabelText("Шалтгаан (audit-д хадгалагдана)"),
      "Verified the ticket with the tenant owner",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Зөвшөөрөх" }));

    await waitFor(() =>
      expect(api.decideSupportAccess).toHaveBeenCalledWith("grant-1", "approve", {
        reason: "Verified the ticket with the tenant owner",
        rowVersion: 1,
      }),
    );
    expect(await screen.findByText(/state REQUESTED → APPROVED/)).toBeInTheDocument();
  });

  it("tells the requester they cannot approve their own grant", async () => {
    api.supportAccessGrant.mockResolvedValue(
      detailFixture({ allowedActions: ["DENY"], canApprove: false }),
    );
    renderRoute(
      "/platform/support-access/:grantId",
      "/platform/support-access/grant-1",
      <PlatformSupportAccessDetailPage />,
    );

    expect(
      await screen.findByText("Та энэ хүсэлтийг гаргасан тул өөрөө зөвшөөрөх боломжгүй."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Зөвшөөрөх" })).toBeNull();
    expect(screen.getByRole("button", { name: "Татгалзах" })).toBeInTheDocument();
  });

  it("states that the grant stays masked and read-only", async () => {
    api.supportAccessGrant.mockResolvedValue(detailFixture());
    renderRoute(
      "/platform/support-access/:grantId",
      "/platform/support-access/grant-1",
      <PlatformSupportAccessDetailPage />,
    );

    expect(await screen.findByText(/Агуулга үргэлж маскласан байна/)).toBeInTheDocument();
    expect(screen.getAllByText("read-only")).toHaveLength(2);
    expect(screen.getByText("READ_TENANT_HEALTH")).toBeInTheDocument();
  });

  it("shows no action controls once the grant expired", async () => {
    api.supportAccessGrant.mockResolvedValue(
      detailFixture({
        grant: { ...grant, state: "EXPIRED", active: false, expiresInSeconds: -60 },
        allowedActions: [],
        canApprove: false,
      }),
    );
    renderRoute(
      "/platform/support-access/:grantId",
      "/platform/support-access/grant-1",
      <PlatformSupportAccessDetailPage />,
    );

    expect(
      await screen.findByText("Энэ хандалт дээр таны хийж болох үйлдэл алга."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Цуцлах" })).toBeNull();
  });
});
