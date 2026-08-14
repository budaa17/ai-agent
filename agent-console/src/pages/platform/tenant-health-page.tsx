import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import {
  DrilldownStates,
  PlatformFilterForm,
  RangeField,
  readRange,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  CauseList,
  formatBytes,
  formatCount,
  formatMicroUsd,
  formatPercent,
  formatPlatformDateTime,
  SectionHeader,
  StatTile,
  stateLabel,
  stateTone,
  UnavailableSection,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, EmptyState, PageHeading } from "../../components/ui";

export function PlatformTenantHealthPage() {
  const { tenantId = "" } = useParams();
  const { values, setValues } = usePlatformSearchState();
  const [range, setRange] = useState(readRange(values));

  useEffect(() => {
    setRange(readRange(values));
  }, [values]);

  const query = { window: readRange(values) } as const;
  const tenant = useQuery({
    queryKey: ["platform", "tenant-health", tenantId, query],
    queryFn: () => platformApi.tenantHealth(tenantId, query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void tenant.refetch();
  const data = tenant.data;

  return (
    <>
      <PageHeading
        eyebrow="TENANT HEALTH"
        title={data?.tenant.name ?? tenantId}
        description="Нэг компанийн identity, agent, review, delivery болон хадгалалтын read-only төлөв."
        actions={
          <Link className="platform-card-link" to="/platform/tenants">
            <ArrowLeft /> Жагсаалт руу
          </Link>
        }
      />

      <PlatformFilterForm
        label="Tenant health filter"
        fetching={tenant.isFetching}
        onApply={() => setValues({ window: range })}
        onReset={() => setValues({ window: undefined })}
        onRefresh={retry}
      >
        <RangeField value={range} onChange={setRange} />
      </PlatformFilterForm>

      <DrilldownStates
        isPending={tenant.isPending}
        isError={tenant.isError}
        error={tenant.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Tenant health ачаалж байна…"
        errorTitle="Tenant health ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          <Card className={`platform-status-card state-${data.tenant.health.toLowerCase()}`}>
            <div className="platform-status-main">
              <div>
                <p className="eyebrow">TENANT STATUS</p>
                <h2>{stateLabel(data.tenant.health)}</h2>
                <p>
                  {data.tenant.tenantId} · Үүссэн:{" "}
                  {formatPlatformDateTime(data.tenant.createdAt)} · Сүүлийн идэвх:{" "}
                  {formatPlatformDateTime(data.tenant.lastActivityAt)}
                  {data.tenant.inactiveDays === null
                    ? ""
                    : ` (${formatCount(data.tenant.inactiveDays)} хоногийн өмнө)`}
                </p>
              </div>
              <Badge tone={stateTone(data.tenant.health)}>{stateLabel(data.tenant.health)}</Badge>
            </div>
            {data.signals.items.length > 0 ? (
              <div className="platform-status-causes">
                <strong>Идэвхтэй signal ({formatCount(data.signals.total)})</strong>
                <CauseList causes={data.signals.items} />
              </div>
            ) : (
              <p className="muted">Backend үнэлгээгээр энэ компанид идэвхтэй signal алга.</p>
            )}
          </Card>

          <Card>
            <SectionHeader
              eyebrow="IDENTITY"
              title="Хэрэглэгчийн идэвх"
              context={data.users.context}
            />
            <UnavailableSection context={data.users.context} />
            <div className="platform-stat-row">
              <StatTile label="Идэвхтэй бүртгэл" value={formatCount(data.users.activeAccounts)} />
              <StatTile label="24 цагт нэвтэрсэн" value={formatCount(data.users.loggedIn24h)} />
              <StatTile label="7 хоногт нэвтэрсэн" value={formatCount(data.users.loggedIn7d)} />
              <StatTile
                label="Хэзээ ч нэвтрээгүй"
                value={formatCount(data.users.neverLoggedIn)}
              />
              <StatTile label="Түдгэлзүүлсэн" value={formatCount(data.users.suspendedAccounts)} />
            </div>
          </Card>

          <Card>
            <SectionHeader
              eyebrow="AI OPERATIONS"
              title="Агентын гүйцэтгэл"
              context={data.agents.context}
              meta={`${formatCount(data.agents.total)} agent type`}
            />
            <UnavailableSection context={data.agents.context} />
            <DataTable
              headers={["Agent", "Run", "Completion", "Алдаа", "Stuck", "Сүүлийн амжилт", "Зардал"]}
              empty="Энэ хугацаанд agent run алга"
              rows={data.agents.items.map((agent) => [
                <Link key="agent" to={agent.runsHref}>
                  {agent.agentType}
                </Link>,
                <span key="runs">{formatCount(agent.runs)}</span>,
                <span key="completion">{formatPercent(agent.completionPercent)}</span>,
                <span key="failures">
                  {formatCount(agent.failed)} / {formatCount(agent.degraded)} /{" "}
                  {formatCount(agent.rejected)}
                </span>,
                <span key="stuck">{formatCount(agent.stuck)}</span>,
                <span key="success">{formatPlatformDateTime(agent.lastSuccessAt)}</span>,
                <span key="cost">{formatMicroUsd(agent.costMicroUsd)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="HUMAN REVIEW"
              title="Review SLA"
              context={data.review.context}
              actions={
                <Link className="platform-card-link" to={data.review.backlogHref}>
                  Backlog харах
                </Link>
              }
            />
            <UnavailableSection context={data.review.context} />
            <div className="platform-stat-row">
              <StatTile label="Хүлээгдэж буй" value={formatCount(data.review.waiting)} />
              <StatTile label="Хугацаа хэтэрсэн" value={formatCount(data.review.breached)} />
              <StatTile label="Хугацаагүй" value={formatCount(data.review.withoutDueAt)} />
              <StatTile
                label="Хамгийн эртний"
                value={formatPlatformDateTime(data.review.oldestWaitingAt)}
              />
            </div>
          </Card>

          <Card>
            <SectionHeader
              eyebrow="DELIVERY"
              title="Event ба notification"
              context={data.delivery.context}
            />
            <UnavailableSection context={data.delivery.context} />
            {data.delivery.components.length === 0 ? (
              <EmptyState
                title="Delivery мэдээлэл алга"
                description="Энэ компанийн outbox, notification болон artifact aggregate ирсэнгүй."
              />
            ) : (
              <DataTable
                headers={["Component", "Төлөв", "Тайлбар", "Үзүүлэлт"]}
                rows={data.delivery.components.map((component) => [
                  <Link key="component" to={component.diagnosticsHref}>
                    {component.component}
                  </Link>,
                  <Badge key="state" tone={stateTone(component.state)}>
                    {stateLabel(component.state)}
                  </Badge>,
                  <span key="summary">{component.summary}</span>,
                  <span key="metrics">
                    {component.metrics
                      .map((metric) => `${metric.key}: ${String(metric.value)}`)
                      .join(" · ")}
                  </span>,
                ])}
              />
            )}
          </Card>

          <Card>
            <SectionHeader
              eyebrow="STORAGE"
              title="Файл хадгалалт"
              context={data.storage.context}
            />
            <UnavailableSection context={data.storage.context} />
            <div className="platform-stat-row">
              <StatTile label="Нийт хэмжээ" value={formatBytes(data.storage.totalBytes)} />
              <StatTile label="Файлын тоо" value={formatCount(data.storage.fileCount)} />
              <StatTile label="Quarantine" value={formatCount(data.storage.quarantinedCount)} />
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
