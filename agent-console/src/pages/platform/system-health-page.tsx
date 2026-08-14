import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformSystemHealthQuery } from "../../api/platform-schemas";
import {
  DrilldownStates,
  PlatformFilterForm,
  readOptional,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  formatCount,
  formatPlatformDateTime,
  FreshnessBadge,
  SectionHeader,
  stateLabel,
  stateTone,
  UnavailableSection,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading } from "../../components/ui";

export function PlatformSystemHealthPage() {
  const { values, setValues } = usePlatformSearchState();
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const highlighted = values.get("component");

  useEffect(() => {
    setTenantId(values.get("tenantId") ?? "");
  }, [values]);

  const query: PlatformSystemHealthQuery = {
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
  };
  const health = useQuery({
    queryKey: ["platform", "system-health", query],
    queryFn: () => platformApi.systemHealth(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void health.refetch();
  const data = health.data;

  return (
    <>
      <PageHeading
        eyebrow="PLATFORM"
        title="Системийн төлөв"
        description="API, PostgreSQL, outbox, notification болон artifact metadata-ийн бодит нотолгоо. Probe түүх байхгүй тул uptime хувь гаргахгүй."
      />

      <PlatformFilterForm
        label="System health filter"
        fetching={health.isFetching}
        onApply={() => setValues({ tenantId })}
        onReset={() => setValues({ tenantId: undefined, component: undefined })}
        onRefresh={retry}
      >
        <Field label="Tenant ID">
          <Input
            value={tenantId}
            placeholder="Бүх компани"
            onChange={(event) => setTenantId(event.target.value)}
          />
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={health.isPending}
        isError={health.isError}
        error={health.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Системийн төлөв ачаалж байна…"
        errorTitle="Системийн төлөв ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          <Card className={`platform-status-card state-${data.state.toLowerCase()}`}>
            <div className="platform-status-main">
              <div>
                <p className="eyebrow">SYSTEM STATUS</p>
                <h2>{stateLabel(data.state)}</h2>
                <p>Шалгасан: {formatPlatformDateTime(data.asOf)}</p>
              </div>
              <FreshnessBadge freshness={data.freshness} />
            </div>
          </Card>

          <div className="platform-component-grid">
            {data.components.map((component) => (
              <Card
                key={component.component}
                className={`platform-component-card state-${component.state.toLowerCase()} ${
                  highlighted === component.component ? "is-highlighted" : ""
                }`}
              >
                <div className="platform-section-heading">
                  <div>
                    <p className="eyebrow">{component.required ? "REQUIRED" : "OPTIONAL"}</p>
                    <h2>{component.component}</h2>
                    <p>{component.summary}</p>
                  </div>
                  <div className="platform-section-state">
                    <Badge tone={stateTone(component.state)}>{stateLabel(component.state)}</Badge>
                    <FreshnessBadge freshness={component.freshness} />
                  </div>
                </div>
                {component.metrics.length === 0 ? null : (
                  <ul className="platform-metric-list">
                    {component.metrics.map((metric) => (
                      <li key={metric.key}>
                        <span>{metric.key}</span>
                        <strong>
                          {String(metric.value)} {metric.unit}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>

          <Card>
            <SectionHeader
              eyebrow="OUTBOX"
              title="Event төрлөөр"
              context={data.outboxByType.context}
            />
            <UnavailableSection context={data.outboxByType.context} />
            <DataTable
              headers={["Event type", "Pending", "Stalled", "Failed", "Dead letter", "Хамгийн эртний"]}
              empty="Хүлээгдэж буй эсвэл амжилтгүй outbox event алга"
              rows={data.outboxByType.items.map((item) => [
                <span key="type">{item.eventType}</span>,
                <span key="pending">{formatCount(item.pending)}</span>,
                <span key="stalled">{formatCount(item.stalled)}</span>,
                <span key="failed">{formatCount(item.failed)}</span>,
                <span key="dead">{formatCount(item.deadLetter)}</span>,
                <span key="oldest">{formatPlatformDateTime(item.oldestEvidenceAt)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="TENANT IMPACT"
              title="Нөлөөлсөн компаниуд"
              context={data.tenantImpact.context}
            />
            <UnavailableSection context={data.tenantImpact.context} />
            <DataTable
              headers={[
                "Компани",
                "Outbox stalled",
                "Outbox dead letter",
                "Notification failed",
                "Quarantine",
              ]}
              empty="Одоогоор нөлөөлсөн компани алга"
              rows={data.tenantImpact.items.map((item) => [
                <Link key="tenant" to={item.healthHref}>
                  {item.tenantName ?? item.tenantId}
                </Link>,
                <span key="stalled">{formatCount(item.outboxStalled)}</span>,
                <span key="dead">{formatCount(item.outboxDeadLetter)}</span>,
                <span key="notification">{formatCount(item.notificationFailed)}</span>,
                <span key="quarantine">{formatCount(item.artifactQuarantined)}</span>,
              ])}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
