import {
  Activity,
  ArrowRight,
  Bot,
  Building2,
  Clock3,
  Database,
  DollarSign,
  FileClock,
  Server,
  ShieldAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  PlatformAttentionItem,
  PlatformAuditItem,
  PlatformCause,
  PlatformMetricContext,
  PlatformOverview,
  PlatformSystemComponent,
  PlatformTenantHealthItem,
} from "../../api/platform-schemas";
import { Badge, Card, EmptyState } from "../ui";
import {
  CauseList,
  formatBytes,
  formatCount,
  formatLatency,
  formatMetricWindow,
  formatMicroUsd,
  formatPercent,
  formatPlatformDateTime,
  FreshnessBadge,
  SectionHeader,
  SectionProblems,
  stateLabel,
  stateTone,
  UnavailableSection,
} from "./platform-presentation";

export { formatPlatformDateTime, FreshnessBadge, SectionProblems } from "./platform-presentation";
export { EnvelopeProblems as OverviewProblems } from "./platform-presentation";

export type OverviewProblem = PlatformOverview["problems"][number];

const percentFormatter = new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 1 });
const numberFormatter = new Intl.NumberFormat("mn-MN");

function comparisonLabel(context: PlatformMetricContext): string {
  const comparison = context.comparison;
  if (comparison.state === "UNAVAILABLE") {
    const reasons: Record<typeof comparison.reason, string> = {
      NOT_APPLICABLE: "хамаарахгүй",
      NO_HISTORY: "өмнөх түүх алга",
      INSUFFICIENT_SAMPLE: "sample хүрэлцэхгүй",
      SOURCE_UNAVAILABLE: "эх үүсвэр боломжгүй",
    };
    return `Харьцуулалт: ${reasons[comparison.reason]}`;
  }
  const sign = comparison.delta > 0 ? "+" : "";
  const delta =
    comparison.deltaUnit === "MICRO_USD"
      ? `${sign}${formatMicroUsd(comparison.delta)}`
      : comparison.deltaUnit === "PERCENTAGE_POINTS"
        ? `${sign}${percentFormatter.format(comparison.delta)} пункт`
        : `${sign}${numberFormatter.format(comparison.delta)}`;
  const previous =
    comparison.deltaUnit === "MICRO_USD"
      ? formatMicroUsd(comparison.previousValue)
      : comparison.deltaUnit === "PERCENTAGE_POINTS"
        ? `${percentFormatter.format(comparison.previousValue)}%`
        : numberFormatter.format(comparison.previousValue);
  return `Өмнөх: ${previous} · Δ ${delta}`;
}

function MetricCard({
  title,
  icon,
  context,
  primary,
  details,
  href,
  problems = [],
  retry,
}: {
  title: string;
  icon: React.ReactNode;
  context: PlatformMetricContext;
  primary: React.ReactNode;
  details: React.ReactNode;
  href?: string;
  problems?: readonly OverviewProblem[];
  retry?: (() => void) | undefined;
}) {
  let value: React.ReactNode = primary;
  if (context.state === "UNKNOWN")
    value = <span className="metric-unavailable">Тооцоолох боломжгүй</span>;
  if (context.state === "NO_DATA") value = <span className="metric-unavailable">Өгөгдөл алга</span>;
  if (context.state === "INSUFFICIENT_SAMPLE") {
    value = <span className="metric-unavailable">Sample хүрэлцэхгүй</span>;
  }
  return (
    <Card className={`platform-kpi-card state-${context.state.toLowerCase()}`}>
      <div className="platform-kpi-title">
        <span className="platform-kpi-icon">{icon}</span>
        <h2>{title}</h2>
        <FreshnessBadge freshness={context.freshness} />
      </div>
      <div className="platform-kpi-value">{value}</div>
      <div className="platform-kpi-detail">{details}</div>
      <SectionProblems problems={problems} retry={retry} compact />
      <div className="platform-metric-context">
        <span>{formatMetricWindow(context.window)}</span>
        <span>
          Sample {formatCount(context.sampleSize)} / min {formatCount(context.minimumSample)}
        </span>
        <span>{comparisonLabel(context)}</span>
      </div>
      {href !== undefined ? (
        <Link className="platform-card-link" to={href}>
          Дэлгэрэнгүй <ArrowRight />
        </Link>
      ) : null}
    </Card>
  );
}

export function PlatformKpiGrid({
  kpis,
  problems,
  retry,
}: {
  kpis: PlatformOverview["kpis"];
  problems: readonly OverviewProblem[];
  retry: () => void;
}) {
  const forSection = (section: OverviewProblem["section"]) =>
    problems.filter((problem) => problem.section === section);
  return (
    <section aria-labelledby="platform-kpi-heading">
      <div className="platform-section-heading">
        <div>
          <p className="eyebrow">KEY SIGNALS</p>
          <h2 id="platform-kpi-heading">Үндсэн үзүүлэлт</h2>
        </div>
      </div>
      <div className="platform-kpi-grid">
        <MetricCard
          title="Critical Issues"
          icon={<ShieldAlert />}
          context={kpis.criticalIssues.context}
          primary={`${formatCount(kpis.criticalIssues.value)} open`}
          details={
            <>
              <span>{formatCount(kpis.criticalIssues.critical)} critical</span>
              <span>{formatCount(kpis.criticalIssues.high)} high</span>
              <span>
                Хамгийн хуучин: {formatPlatformDateTime(kpis.criticalIssues.oldestEvidenceAt)}
              </span>
            </>
          }
          problems={[
            ...forSection("TENANTS"),
            ...forSection("AGENTS"),
            ...forSection("REVIEWS"),
            ...forSection("SYSTEM"),
          ]}
          retry={retry}
        />
        <MetricCard
          title="Tenant Health"
          icon={<Building2 />}
          context={kpis.tenantHealth.context}
          primary={`${formatCount(kpis.tenantHealth.healthy)} / ${formatCount(kpis.tenantHealth.total)} healthy`}
          details={
            <>
              <span>{formatCount(kpis.tenantHealth.critical)} critical</span>
              <span>{formatCount(kpis.tenantHealth.warning)} warning</span>
              <span>{formatCount(kpis.tenantHealth.unknown)} unknown</span>
            </>
          }
          href="/platform/tenants"
          problems={forSection("TENANTS")}
          retry={retry}
        />
        <MetricCard
          title="Agent Completion"
          icon={<Bot />}
          context={kpis.agentCompletion.context}
          primary={formatPercent(kpis.agentCompletion.valuePercent)}
          details={
            <>
              <span>
                {formatCount(kpis.agentCompletion.completed)} /{" "}
                {formatCount(kpis.agentCompletion.terminal)} terminal
              </span>
              <span>{formatCount(kpis.agentCompletion.failed)} failed</span>
              <span>{formatCount(kpis.agentCompletion.degraded)} degraded</span>
            </>
          }
          href="/platform/agents"
          problems={forSection("AGENTS")}
          retry={retry}
        />
        <MetricCard
          title="Review SLA"
          icon={<FileClock />}
          context={kpis.reviewSla.context}
          primary={`${formatCount(kpis.reviewSla.breached)} breached`}
          details={
            <>
              <span>{formatCount(kpis.reviewSla.waiting)} waiting</span>
              <span>{formatCount(kpis.reviewSla.withoutDueAt)} without due date</span>
              <span>Хамгийн хуучин: {formatPlatformDateTime(kpis.reviewSla.oldestWaitingAt)}</span>
            </>
          }
          href="/platform/review-quality"
          problems={forSection("REVIEWS")}
          retry={retry}
        />
        <MetricCard
          title="AI Spend"
          icon={<DollarSign />}
          context={kpis.aiSpend.context}
          primary={formatMicroUsd(kpis.aiSpend.microUsd)}
          details={
            <>
              <span>{formatMicroUsd(kpis.aiSpend.actualMicroUsd)} actual</span>
              <span>{formatMicroUsd(kpis.aiSpend.estimatedMicroUsd)} estimated</span>
              <span>{formatPercent(kpis.aiSpend.actualCoveragePercent)} actual coverage</span>
            </>
          }
          href="/platform/usage"
          problems={forSection("USAGE")}
          retry={retry}
        />
      </div>
    </section>
  );
}

function ScopeText({ cause }: { cause: PlatformCause | PlatformAttentionItem }) {
  const values = [cause.scope.tenantName, cause.scope.agentType, cause.scope.component].filter(
    (value): value is string => value !== null,
  );
  return <span>{values.length === 0 ? "Platform" : values.join(" · ")}</span>;
}

export function PlatformStatusPanel({ overview }: { overview: PlatformOverview }) {
  return (
    <Card className={`platform-status-card state-${overview.platformStatus.state.toLowerCase()}`}>
      <div className="platform-status-main">
        <div className="platform-status-icon">
          <Activity />
        </div>
        <div>
          <p className="eyebrow">PLATFORM STATUS</p>
          <h2>{stateLabel(overview.platformStatus.state)}</h2>
          <p>
            Backend ruleset: {overview.platformStatus.ruleSetVersion} · Үнэлсэн:{" "}
            {formatPlatformDateTime(overview.platformStatus.evaluatedAt)}
          </p>
        </div>
        <FreshnessBadge freshness={overview.freshness} />
      </div>
      {overview.topCauses.length > 0 ? (
        <div className="platform-status-causes">
          <strong>Гол шалтгаан</strong>
          <CauseList causes={overview.topCauses} />
        </div>
      ) : (
        <p className="muted">Backend үнэлгээгээр идэвхтэй top cause алга.</p>
      )}
    </Card>
  );
}

export function AttentionPanel({ attention }: { attention: PlatformOverview["attention"] }) {
  return (
    <Card className="platform-attention-card">
      <SectionHeader
        eyebrow="ATTENTION REQUIRED"
        title="Анхаарах асуудал"
        context={attention.context}
        meta={`${formatCount(attention.total)} active signal${attention.truncated ? " · эхний 10" : ""}`}
      />
      <UnavailableSection context={attention.context} />
      {attention.items.length === 0 && attention.context.state !== "UNKNOWN" ? (
        <EmptyState
          title="Идэвхтэй signal алга"
          description="Сонгосон scope-д анхаарал шаардах active signal илэрсэнгүй."
        />
      ) : (
        <div className="platform-attention-list">
          {attention.items.map((item) => (
            <article className="platform-attention-item" key={item.signalId}>
              <div className="platform-attention-title">
                <Badge tone={stateTone(item.severity)}>{stateLabel(item.severity)}</Badge>
                <div>
                  <h3>{item.title}</h3>
                  <div className="platform-attention-scope">
                    <ScopeText cause={item} />
                    <Badge
                      tone={
                        item.state === "ACKNOWLEDGED"
                          ? "info"
                          : item.state === "REOPENED"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {stateLabel(item.state)}
                    </Badge>
                  </div>
                </div>
                <FreshnessBadge freshness={item.freshness} />
              </div>
              <p>{item.impact}</p>
              <dl className="platform-evidence-list">
                {item.evidence.slice(0, 3).map((evidence) => (
                  <div key={`${evidence.metricKey}-${evidence.observedAt}`}>
                    <dt>{evidence.metricKey}</dt>
                    <dd>
                      {String(evidence.value)} {evidence.unit}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="platform-recommendation">
                <strong>Санал болгох алхам:</strong> {item.recommendedAction}
              </p>
              <div className="platform-item-footer">
                <span>
                  Илэрсэн: {formatPlatformDateTime(item.firstEvidenceAt)} · Сүүлд:{" "}
                  {formatPlatformDateTime(item.lastEvidenceAt)}
                </span>
                <Link className="platform-card-link" to={item.diagnosticsHref}>
                  Diagnostics <ArrowRight />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function componentIcon(component: PlatformSystemComponent["component"]): React.ReactNode {
  if (component === "POSTGRES") return <Database />;
  if (component === "AI_PROVIDER") return <Bot />;
  return <Server />;
}

export function SystemHealthPanel({ system }: { system: PlatformOverview["systemHealth"] }) {
  return (
    <Card>
      <SectionHeader
        eyebrow="SYSTEM HEALTH"
        title="Системийн бүрэлдэхүүн"
        context={system.context}
      />
      <UnavailableSection context={system.context} />
      {system.components.length === 0 && system.context.state !== "UNKNOWN" ? (
        <EmptyState
          title="Component мэдээлэл алга"
          description="System health probe component буцаасангүй."
        />
      ) : (
        <div className="platform-component-list">
          {system.components.map((component) => (
            <Link
              className="platform-component-row"
              key={component.component}
              to={component.diagnosticsHref}
            >
              <span className="platform-component-icon">{componentIcon(component.component)}</span>
              <span className="platform-component-copy">
                <strong>{component.component.replaceAll("_", " ")}</strong>
                <small>{component.summary}</small>
                {component.metrics.length > 0 ? (
                  <span className="platform-component-metrics">
                    {component.metrics.slice(0, 3).map((metric) => (
                      <span key={metric.key}>
                        {metric.key}: {String(metric.value)} {metric.unit}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="platform-component-meta">
                <Badge tone={stateTone(component.state)}>{stateLabel(component.state)}</Badge>
                <FreshnessBadge freshness={component.freshness} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function UnknownValue() {
  return <span className="platform-unknown-value">— Тодорхойгүй</span>;
}

function tenantFieldUnknown(
  item: PlatformTenantHealthItem,
  field: PlatformTenantHealthItem["unknownFields"][number],
) {
  return item.unknownFields.includes(field);
}

export function TenantHealthPanel({
  preview,
}: {
  preview: PlatformOverview["tenantHealthPreview"];
}) {
  return (
    <Card>
      <SectionHeader
        eyebrow="TENANT HEALTH"
        title="Компанийн төлөв"
        context={preview.context}
        meta={`${formatCount(preview.total)} tenant${preview.truncated ? " · эхний 10" : ""}`}
      />
      <UnavailableSection context={preview.context} />
      {preview.items.length === 0 && preview.context.state !== "UNKNOWN" ? (
        <EmptyState
          title="Tenant мэдээлэл алга"
          description="Сонгосон filter-д тохирох tenant олдсонгүй."
        />
      ) : (
        <div className="table-scroll platform-table-scroll">
          <table className="platform-health-table">
            <thead>
              <tr>
                <th>Компани</th>
                <th>Төлөв</th>
                <th>Хэрэглэгч</th>
                <th>Agent run</th>
                <th>Review</th>
                <th>Issue</th>
                <th>Usage</th>
                <th>Сүүлийн идэвх</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((tenant) => (
                <tr key={tenant.tenantId}>
                  <td>
                    <Link
                      className="platform-table-primary"
                      to={`/platform/tenants/${encodeURIComponent(tenant.tenantId)}/health`}
                    >
                      {tenant.name}
                    </Link>
                    <small>{tenant.tenantId}</small>
                  </td>
                  <td>
                    <Badge tone={stateTone(tenant.health)}>{stateLabel(tenant.health)}</Badge>
                    <CauseList causes={tenant.reasons} />
                  </td>
                  <td>
                    {tenantFieldUnknown(tenant, "USERS") || tenant.users === null ? (
                      <UnknownValue />
                    ) : (
                      <>
                        <strong>{formatCount(tenant.users.loggedIn24h)}</strong>
                        <small>{formatCount(tenant.users.activeAccounts)} active account</small>
                      </>
                    )}
                  </td>
                  <td>
                    {tenantFieldUnknown(tenant, "RUNS") || tenant.runs === null ? (
                      <UnknownValue />
                    ) : (
                      <>
                        <strong>{formatCount(tenant.runs.completed)} completed</strong>
                        <small>
                          {formatCount(tenant.runs.failed)} failed ·{" "}
                          {formatCount(tenant.runs.stuck)} stuck
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    {tenantFieldUnknown(tenant, "REVIEW") || tenant.review === null ? (
                      <UnknownValue />
                    ) : (
                      <>
                        <strong>{formatCount(tenant.review.breached)} breached</strong>
                        <small>{formatCount(tenant.review.waiting)} waiting</small>
                      </>
                    )}
                  </td>
                  <td>
                    {tenantFieldUnknown(tenant, "ISSUES") || tenant.issues === null ? (
                      <UnknownValue />
                    ) : (
                      <>
                        <strong>{formatCount(tenant.issues.critical)} critical</strong>
                        <small>{formatCount(tenant.issues.high)} high</small>
                      </>
                    )}
                  </td>
                  <td>
                    {tenantFieldUnknown(tenant, "AI_SPEND") ? (
                      <UnknownValue />
                    ) : (
                      <strong>{formatMicroUsd(tenant.aiSpendMicroUsd)}</strong>
                    )}
                    {tenantFieldUnknown(tenant, "STORAGE") ? (
                      <UnknownValue />
                    ) : (
                      <small>{formatBytes(tenant.storageBytes)} storage</small>
                    )}
                  </td>
                  <td>
                    {tenantFieldUnknown(tenant, "LAST_ACTIVITY") ? (
                      <UnknownValue />
                    ) : (
                      formatPlatformDateTime(tenant.lastActivityAt)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function AgentHealthPanel({ preview }: { preview: PlatformOverview["agentHealthPreview"] }) {
  return (
    <Card>
      <SectionHeader
        eyebrow="AI OPERATIONS"
        title="Agent health"
        context={preview.context}
        meta={`${formatCount(preview.total)} agent type${preview.truncated ? " · эхний 10" : ""}`}
      />
      <UnavailableSection context={preview.context} />
      {preview.items.length === 0 && preview.context.state !== "UNKNOWN" ? (
        <EmptyState
          title="Agent run алга"
          description="Сонгосон хугацаа болон filter-д agent run бүртгэгдээгүй байна."
        />
      ) : (
        <div className="table-scroll platform-table-scroll">
          <table className="platform-health-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Төлөв</th>
                <th>Completion</th>
                <th>Failure</th>
                <th>Latency</th>
                <th>Retry / stuck</th>
                <th>Зардал</th>
                <th>Сүүлийн амжилт</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((agent) => (
                <tr key={agent.agentType}>
                  <td>
                    <Link
                      className="platform-table-primary"
                      to={`/platform/agents/${encodeURIComponent(agent.agentType)}`}
                    >
                      {agent.agentType}
                    </Link>
                    <small>{formatCount(agent.runs)} run</small>
                  </td>
                  <td>
                    <Badge tone={stateTone(agent.state)}>{stateLabel(agent.state)}</Badge>
                    <CauseList causes={agent.reasons} />
                  </td>
                  <td>
                    <strong>{formatPercent(agent.completionPercent)}</strong>
                    <small>
                      {formatCount(agent.completed)} / {formatCount(agent.terminal)} terminal
                    </small>
                  </td>
                  <td>
                    <strong>{formatCount(agent.failed)} failed</strong>
                    <small>
                      {formatCount(agent.degraded)} degraded · {formatCount(agent.rejected)}{" "}
                      rejected
                    </small>
                  </td>
                  <td>
                    <strong>p50 {formatLatency(agent.p50LatencyMs)}</strong>
                    <small>p95 {formatLatency(agent.p95LatencyMs)}</small>
                  </td>
                  <td>
                    <strong>{formatPercent(agent.retryRatePercent)} retry</strong>
                    <small>{formatCount(agent.stuck)} stuck</small>
                  </td>
                  <td>{formatMicroUsd(agent.costMicroUsd)}</td>
                  <td>{formatPlatformDateTime(agent.lastSuccessAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function auditActor(item: PlatformAuditItem): string {
  return item.actorDisplayName ?? item.actorId ?? "System";
}

export function RecentAuditPanel({ audit }: { audit: PlatformOverview["recentAudit"] }) {
  return (
    <Card>
      <SectionHeader
        eyebrow="AUDIT"
        title="Сүүлийн platform ба компанийн үйлдэл"
        context={audit.context}
      />
      <UnavailableSection context={audit.context} />
      {audit.items.length === 0 && audit.context.state !== "UNKNOWN" ? (
        <EmptyState
          title="Audit event алга"
          description="Platform болон компанийн audit event бүртгэгдээгүй байна."
        />
      ) : (
        <ol className="platform-audit-list">
          {audit.items.map((item) => (
            <li key={item.id}>
              <span className="platform-audit-icon">
                <Clock3 />
              </span>
              <span>
                <strong>{item.action}</strong>
                <small>
                  {auditActor(item)} · {item.resourceType}
                  {item.resourceId === null ? "" : ` / ${item.resourceId}`}
                </small>
              </span>
              <span className="platform-audit-meta">
                <Badge tone={stateTone(item.result)}>{stateLabel(item.result)}</Badge>
                <time dateTime={item.occurredAt}>{formatPlatformDateTime(item.occurredAt)}</time>
                <Link to={item.detailHref}>Дэлгэрэнгүй</Link>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function OverviewLoadingPanels() {
  return (
    <div
      className="platform-loading-grid"
      aria-label="Control Tower өгөгдөл ачаалж байна"
      role="status"
    >
      <div className="platform-skeleton platform-skeleton-status" />
      <div className="platform-kpi-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="platform-skeleton platform-skeleton-kpi" key={index} />
        ))}
      </div>
      <div className="platform-skeleton platform-skeleton-panel" />
      <span className="sr-only">Control Tower өгөгдөл ачаалж байна…</span>
    </div>
  );
}
