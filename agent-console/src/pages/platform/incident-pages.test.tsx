import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformApi } from "../../api/platform-client";
import type {
  PlatformIncidentDetail,
  PlatformIncidentList,
  PlatformIncidentMutation,
} from "../../api/platform-schemas";
import { PlatformIncidentDetailPage } from "./incident-detail-page";
import { PlatformIncidentsPage } from "./incidents-page";

vi.mock("../../api/platform-client", () => ({
  platformApi: {
    incidents: vi.fn(),
    incident: vi.fn(),
    acknowledgeIncident: vi.fn(),
    assignIncident: vi.fn(),
    resolveIncident: vi.fn(),
  },
}));

const api = vi.mocked(platformApi);

const incident: PlatformIncidentDetail["incident"] = {
  incidentId: "incident-1",
  signalId: "signal-1",
  ruleKey: "REVIEW_SLA_BREACH",
  ruleVersion: "platform-overview-rules.v1",
  severity: "HIGH",
  state: "OPEN",
  active: true,
  title: "Review SLA is breached",
  impact: "Human review tasks are waiting beyond their due time.",
  recommendedAction: "Ask the tenant review owner to triage overdue tasks.",
  scope: {
    tenantId: "tenant-alpha",
    tenantName: "Alpha",
    agentType: null,
    component: null,
  },
  diagnosticsHref: "/platform/review-quality?view=backlog&sla=BREACHED",
  detailHref: "/platform/incidents/incident-1",
  evidence: [
    {
      metricKey: "review_sla_breached",
      value: 2,
      unit: "tasks",
      observedAt: "2026-08-11T00:00:00.000Z",
    },
  ],
  firstEvidenceAt: "2026-08-10T00:00:00.000Z",
  lastEvidenceAt: "2026-08-11T00:00:00.000Z",
  openedAt: "2026-08-10T00:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedBy: null,
  assignedAt: null,
  assignedTo: null,
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  autoResolved: false,
  reopenCount: 1,
  rowVersion: 3,
};

const listFixture: PlatformIncidentList = {
  schemaVersion: "platform-incidents.v1",
  generatedAt: "2026-08-11T00:00:00.000Z",
  asOf: "2026-08-11T00:00:00.000Z",
  partial: false,
  problems: [],
  filters: {
    state: null,
    activeOnly: true,
    severity: null,
    tenantId: null,
    agentType: null,
    assignedToId: null,
  },
  page: { limit: 25, hasMore: false, nextCursor: null, sort: "OPENED_AT", order: "DESC" },
  totals: { open: 1, acknowledged: 0, reopened: 0, resolved: 2, critical: 0, high: 1 },
  items: [incident],
};

const detailFixture: PlatformIncidentDetail = {
  schemaVersion: "platform-incident-detail.v1",
  generatedAt: "2026-08-11T00:00:00.000Z",
  asOf: "2026-08-11T00:00:00.000Z",
  partial: false,
  problems: [],
  incident,
  timeline: {
    total: 3,
    truncated: false,
    items: [
      {
        eventId: "event-1",
        type: "OPENED",
        fromState: null,
        toState: "OPEN",
        actor: null,
        actorRole: null,
        reason: null,
        note: null,
        correlationId: "correlation-1",
        occurredAt: "2026-08-10T00:00:00.000Z",
      },
      {
        eventId: "event-2",
        type: "AUTO_RESOLVED",
        fromState: "OPEN",
        toState: "RESOLVED",
        actor: null,
        actorRole: null,
        reason: null,
        note: null,
        correlationId: "correlation-2",
        occurredAt: "2026-08-10T06:00:00.000Z",
      },
      {
        eventId: "event-3",
        type: "REOPENED",
        fromState: "RESOLVED",
        toState: "REOPENED",
        actor: null,
        actorRole: null,
        reason: null,
        note: null,
        correlationId: "correlation-3",
        occurredAt: "2026-08-10T12:00:00.000Z",
      },
    ],
  },
  allowedActions: ["ACKNOWLEDGE", "ASSIGN", "RESOLVE"],
  resolveRequiresStepUp: true,
};

function mutationFixture(overrides: Partial<PlatformIncidentMutation> = {}) {
  return {
    schemaVersion: "platform-incident-mutation.v1",
    generatedAt: "2026-08-11T00:05:00.000Z",
    asOf: "2026-08-11T00:05:00.000Z",
    partial: false,
    problems: [],
    incident: { ...incident, state: "ACKNOWLEDGED", rowVersion: 4 },
    event: {
      eventId: "event-4",
      type: "ACKNOWLEDGED",
      fromState: "OPEN",
      toState: "ACKNOWLEDGED",
      actor: { principalId: "platform-admin", displayName: "Platform Admin" },
      actorRole: "PLATFORM_SUPER_ADMIN",
      reason: "Taking ownership of the backlog",
      note: null,
      correlationId: "correlation-4",
      occurredAt: "2026-08-11T00:05:00.000Z",
    },
    change: {
      beforeHash: "a".repeat(64),
      afterHash: "b".repeat(64),
      summary: "state OPEN → ACKNOWLEDGED",
      idempotent: false,
      correlationId: "correlation-4",
    },
    ...overrides,
  } as PlatformIncidentMutation;
}

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

describe("platform incidents list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows lifecycle totals and links each incident to its detail", async () => {
    api.incidents.mockResolvedValue(structuredClone(listFixture));
    renderRoute("/platform/incidents", "/platform/incidents", <PlatformIncidentsPage />);

    expect(await screen.findByRole("link", { name: "Review SLA is breached" })).toHaveAttribute(
      "href",
      "/platform/incidents/incident-1",
    );
    expect(screen.getAllByText("Нээлттэй").length).toBeGreaterThan(0);
    expect(screen.getByText("1× дахин нээгдсэн")).toBeInTheDocument();
    expect(api.incidents).toHaveBeenCalledWith({});
  });

  it("keeps resolved incidents reachable through the filter", async () => {
    api.incidents.mockResolvedValue(structuredClone(listFixture));
    renderRoute(
      "/platform/incidents",
      "/platform/incidents?activeOnly=false&severity=HIGH",
      <PlatformIncidentsPage />,
    );

    await screen.findByRole("link", { name: "Review SLA is breached" });
    expect(api.incidents).toHaveBeenCalledWith({ activeOnly: "false", severity: "HIGH" });
  });
});

describe("platform incident detail", () => {
  beforeEach(() => vi.resetAllMocks());

  it("renders the full lifecycle timeline including auto-resolve and reopen", async () => {
    api.incident.mockResolvedValue(structuredClone(detailFixture));
    renderRoute(
      "/platform/incidents/:incidentId",
      "/platform/incidents/incident-1",
      <PlatformIncidentDetailPage />,
    );

    const timeline = (await screen.findByText("Түүх")).closest<HTMLElement>(".card");
    expect(timeline).not.toBeNull();
    expect(within(timeline!).getByText("Нээгдсэн")).toBeInTheDocument();
    expect(within(timeline!).getByText("Автоматаар шийдэгдсэн")).toBeInTheDocument();
    expect(within(timeline!).getByText("Дахин нээгдсэн")).toBeInTheDocument();
    expect(screen.getByText("review_sla_breached")).toBeInTheDocument();
  });

  it("requires a reason before an acknowledge reaches the API", async () => {
    api.incident.mockResolvedValue(structuredClone(detailFixture));
    api.acknowledgeIncident.mockResolvedValue(mutationFixture());
    renderRoute(
      "/platform/incidents/:incidentId",
      "/platform/incidents/incident-1",
      <PlatformIncidentDetailPage />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Хүлээн авах" }));
    const form = screen.getByRole("form", { name: "Хүлээн авах" });
    await userEvent.click(within(form).getByRole("button", { name: "Хүлээн авах" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("дор хаяж 8 тэмдэгт");
    expect(api.acknowledgeIncident).not.toHaveBeenCalled();

    await userEvent.type(
      within(form).getByLabelText("Шалтгаан (audit-д хадгалагдана)"),
      "Taking ownership of the review backlog",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Хүлээн авах" }));

    await waitFor(() =>
      expect(api.acknowledgeIncident).toHaveBeenCalledWith("incident-1", {
        reason: "Taking ownership of the review backlog",
        rowVersion: 3,
      }),
    );
    expect(await screen.findByText(/state OPEN → ACKNOWLEDGED/)).toBeInTheDocument();
  });

  it("demands a password re-entry before resolving a high-severity incident", async () => {
    api.incident.mockResolvedValue(structuredClone(detailFixture));
    api.resolveIncident.mockResolvedValue(mutationFixture());
    renderRoute(
      "/platform/incidents/:incidentId",
      "/platform/incidents/incident-1",
      <PlatformIncidentDetailPage />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Шийдвэрлэх" }));
    const form = screen.getByRole("form", { name: "Шийдвэрлэх" });
    await userEvent.type(
      within(form).getByLabelText("Шалтгаан (audit-д хадгалагдана)"),
      "Provider recovered and the backlog drained",
    );
    await userEvent.type(
      within(form).getByLabelText("Шийдвэрлэсэн тэмдэглэл"),
      "Backlog cleared by the tenant.",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Шийдвэрлэх" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("нууц үгээ дахин оруулна");
    expect(api.resolveIncident).not.toHaveBeenCalled();

    await userEvent.type(
      within(form).getByLabelText("Нууц үгээ баталгаажуулах"),
      "BuildWatch-SuperAdmin-2026!",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Шийдвэрлэх" }));

    await waitFor(() =>
      expect(api.resolveIncident).toHaveBeenCalledWith("incident-1", {
        reason: "Provider recovered and the backlog drained",
        rowVersion: 3,
        resolutionNote: "Backlog cleared by the tenant.",
        stepUpPassword: "BuildWatch-SuperAdmin-2026!",
      }),
    );
  });

  it("reports an idempotent replay instead of claiming a fresh change", async () => {
    api.incident.mockResolvedValue(structuredClone(detailFixture));
    api.acknowledgeIncident.mockResolvedValue(
      mutationFixture({
        change: {
          beforeHash: "a".repeat(64),
          afterHash: "a".repeat(64),
          summary: "Replayed a previously recorded transition.",
          idempotent: true,
          correlationId: "correlation-4",
        },
      }),
    );
    renderRoute(
      "/platform/incidents/:incidentId",
      "/platform/incidents/incident-1",
      <PlatformIncidentDetailPage />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Хүлээн авах" }));
    const form = screen.getByRole("form", { name: "Хүлээн авах" });
    await userEvent.type(
      within(form).getByLabelText("Шалтгаан (audit-д хадгалагдана)"),
      "Retrying after a network drop",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Хүлээн авах" }));

    expect(await screen.findByText(/давхар хийгдсэнгүй/)).toBeInTheDocument();
  });

  it("offers no action controls when the principal may not manage incidents", async () => {
    const readOnly = structuredClone(detailFixture);
    readOnly.allowedActions = [];
    api.incident.mockResolvedValue(readOnly);
    renderRoute(
      "/platform/incidents/:incidentId",
      "/platform/incidents/incident-1",
      <PlatformIncidentDetailPage />,
    );

    expect(
      await screen.findByText("Таны эрх энэ инцидентэд үйлдэл хийхийг зөвшөөрөхгүй."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Шийдвэрлэх" })).toBeNull();
  });
});
