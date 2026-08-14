import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformAgentDetailQuery } from "../../api/platform-schemas";
import {
  DrilldownStates,
  PlatformFilterForm,
  RangeField,
  readOptional,
  readRange,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  CauseList,
  formatCount,
  formatLatency,
  formatMicroUsd,
  formatPercent,
  formatPlatformDateTime,
  SectionHeader,
  StatTile,
  stateLabel,
  stateTone,
  UnavailableSection,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading } from "../../components/ui";

export function PlatformAgentDetailPage() {
  const { agentType = "" } = useParams();
  const { values, setValues } = usePlatformSearchState();
  const [range, setRange] = useState(readRange(values));
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");

  useEffect(() => {
    setRange(readRange(values));
    setTenantId(values.get("tenantId") ?? "");
  }, [values]);

  const query: PlatformAgentDetailQuery = {
    window: readRange(values),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
  };
  const agent = useQuery({
    queryKey: ["platform", "agent-detail", agentType, query],
    queryFn: () => platformApi.agentDetail(agentType, query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void agent.refetch();
  const data = agent.data;
  const runsHref = `/platform/agent-runs?agentType=${encodeURIComponent(agentType)}${
    query.tenantId === undefined ? "" : `&tenantId=${encodeURIComponent(query.tenantId)}`
  }`;

  return (
    <>
      <PageHeading
        eyebrow="AGENT DETAIL"
        title={agentType}
        description="Нэг agent type-ийн гүйцэтгэл, алдааны ангилал, компани болон моделийн задаргаа."
        actions={
          <Link className="platform-card-link" to="/platform/agents">
            <ArrowLeft /> Agent жагсаалт
          </Link>
        }
      />

      <PlatformFilterForm
        label="Agent detail filter"
        fetching={agent.isFetching}
        onApply={() => setValues({ window: range, tenantId })}
        onReset={() => setValues({ window: undefined, tenantId: undefined })}
        onRefresh={retry}
      >
        <RangeField value={range} onChange={setRange} />
        <Field label="Tenant ID">
          <Input
            value={tenantId}
            placeholder="Бүх компани"
            onChange={(event) => setTenantId(event.target.value)}
          />
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={agent.isPending}
        isError={agent.isError}
        error={agent.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Agent дэлгэрэнгүй ачаалж байна…"
        errorTitle="Agent дэлгэрэнгүй ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          <Card className={`platform-status-card state-${data.agent.state.toLowerCase()}`}>
            <div className="platform-status-main">
              <div>
                <p className="eyebrow">AGENT STATUS</p>
                <h2>{stateLabel(data.agent.state)}</h2>
                <p>
                  {formatCount(data.agent.runs)} run · {formatCount(data.agent.terminal)} terminal ·{" "}
                  {formatCount(data.agent.running)} running
                </p>
              </div>
              <Badge tone={stateTone(data.agent.state)}>{stateLabel(data.agent.state)}</Badge>
            </div>
            {data.agent.reasons.length > 0 ? (
              <div className="platform-status-causes">
                <strong>Гол шалтгаан</strong>
                <CauseList causes={data.agent.reasons} />
              </div>
            ) : (
              <p className="muted">Backend үнэлгээгээр энэ агентад идэвхтэй signal алга.</p>
            )}
          </Card>

          <div className="platform-stat-row">
            <StatTile
              label="Completion"
              value={
                data.agent.completionPercent === null ? (
                  <span className="metric-unavailable">Sample хүрэлцэхгүй</span>
                ) : (
                  formatPercent(data.agent.completionPercent)
                )
              }
              hint={`min sample ${formatCount(data.agent.minimumSample)}`}
            />
            <StatTile
              label="Latency p50 / p95"
              value={`${formatLatency(data.agent.p50LatencyMs)} / ${formatLatency(data.agent.p95LatencyMs)}`}
            />
            <StatTile
              label="Retry rate"
              value={formatPercent(data.agent.retryRatePercent)}
              hint={`${formatCount(data.agent.retriedRuns)} run`}
            />
            <StatTile label="Stuck run" value={formatCount(data.agent.stuck)} />
            <StatTile label="Зардал" value={formatMicroUsd(data.agent.costMicroUsd)} />
            <StatTile
              label="Сүүлийн амжилт"
              value={formatPlatformDateTime(data.agent.lastSuccessAt)}
            />
          </div>

          <Card>
            <SectionHeader
              eyebrow="FAILURE ANALYSIS"
              title="Алдааны ангилал"
              context={data.failureBreakdown.context}
              actions={
                <Link className="platform-card-link" to={`${runsHref}&outcome=NON_COMPLETION`}>
                  Амжилтгүй run харах
                </Link>
              }
            />
            <UnavailableSection context={data.failureBreakdown.context} />
            <DataTable
              headers={["Ангилал", "Тоо", "Эзлэх хувь", "Сүүлд ажиглагдсан"]}
              empty="Энэ хугацаанд амжилтгүй run алга"
              rows={data.failureBreakdown.items.map((item) => [
                <Link
                  key="category"
                  to={`${runsHref}&failureCategory=${encodeURIComponent(item.failureCategory)}`}
                >
                  {item.failureCategory}
                </Link>,
                <span key="count">{formatCount(item.count)}</span>,
                <span key="share">{formatPercent(item.sharePercent)}</span>,
                <span key="last">{formatPlatformDateTime(item.lastObservedAt)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="TENANT BREAKDOWN"
              title="Компаниар"
              context={data.tenantBreakdown.context}
            />
            <UnavailableSection context={data.tenantBreakdown.context} />
            <DataTable
              headers={["Компани", "Run", "Completion", "Алдаа", "Зардал"]}
              empty="Энэ хугацаанд компанийн run алга"
              rows={data.tenantBreakdown.items.map((item) => [
                <Link key="tenant" to={item.healthHref}>
                  {item.tenantName ?? item.tenantId}
                </Link>,
                <span key="runs">{formatCount(item.runs)}</span>,
                <span key="completion">{formatPercent(item.completionPercent)}</span>,
                <span key="failures">
                  {formatCount(item.failed)} / {formatCount(item.degraded)} /{" "}
                  {formatCount(item.rejected)}
                </span>,
                <span key="cost">{formatMicroUsd(item.costMicroUsd)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="MODEL MIX"
              title="Provider ба модель"
              context={data.models.context}
            />
            <UnavailableSection context={data.models.context} />
            <DataTable
              headers={["Provider", "Модель", "Run", "Input token", "Output token", "Зардал"]}
              empty="Энэ хугацаанд модель ашиглалт алга"
              rows={data.models.items.map((item) => [
                <span key="provider">{item.provider}</span>,
                <span key="model">{item.modelId}</span>,
                <span key="runs">{formatCount(item.runs)}</span>,
                <span key="input">{formatCount(item.inputTokens)}</span>,
                <span key="output">{formatCount(item.outputTokens)}</span>,
                <span key="cost">{formatMicroUsd(item.costMicroUsd)}</span>,
              ])}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
