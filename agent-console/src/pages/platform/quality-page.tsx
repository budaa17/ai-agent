import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformQualityMetric, PlatformQualityQuery } from "../../api/platform-schemas";
import {
  DrilldownStates,
  PlatformFilterForm,
  readEnum,
  readOptional,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  formatCount,
  formatPercent,
  formatPlatformDateTime,
  SectionHeader,
  UnavailableSection,
} from "../../components/platform/platform-presentation";
import { Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const windowValues = ["7d", "30d", "90d"] as const;

/**
 * A metric renders its own state rather than a bare number, because a null
 * percentage from a three-case suite means something quite different from 0%.
 */
function MetricValue({ metric }: { metric: PlatformQualityMetric | null }) {
  if (metric === null) return <span className="metric-unavailable">Хэмжээгүй</span>;
  if (metric.state === "UNKNOWN") {
    return <span className="metric-unavailable">Тооцоолох боломжгүй</span>;
  }
  if (metric.state === "NO_DATA") return <span className="metric-unavailable">Өгөгдөл алга</span>;
  if (metric.state === "INSUFFICIENT_SAMPLE") {
    return <span className="metric-unavailable">Sample хүрэлцэхгүй</span>;
  }
  return <>{formatPercent(metric.valuePercent)}</>;
}

function MetricCard({ metric }: { metric: PlatformQualityMetric }) {
  return (
    <Card className={`platform-kpi-card state-${metric.state.toLowerCase()}`}>
      <div className="platform-kpi-title">
        <h2>{metric.label}</h2>
      </div>
      <div className="platform-kpi-value">
        <MetricValue metric={metric} />
      </div>
      <div className="platform-kpi-detail">
        <span>{metric.definition}</span>
        <span>
          {formatCount(metric.passed)} / {formatCount(metric.total)} · sample{" "}
          {formatCount(metric.sampleSize)} / min {formatCount(metric.minimumSample)}
        </span>
        <span>
          {metric.deltaPercentagePoints === null
            ? "Өмнөх хугацаатай харьцуулах боломжгүй"
            : `Өмнөх: ${formatPercent(metric.previousValuePercent)} · Δ ${
                metric.deltaPercentagePoints > 0 ? "+" : ""
              }${metric.deltaPercentagePoints} пункт`}
        </span>
      </div>
      <div className="platform-metric-context">
        <span>Эх сурвалж: {metric.source ?? "—"}</span>
        <span>Сүүлд: {formatPlatformDateTime(metric.freshAt)}</span>
      </div>
    </Card>
  );
}

export function PlatformQualityPage() {
  const { values, setValues } = usePlatformSearchState();
  const [range, setRange] = useState(values.get("window") ?? "30d");
  const [agentType, setAgentType] = useState(values.get("agentType") ?? "");

  useEffect(() => {
    setRange(values.get("window") ?? "30d");
    setAgentType(values.get("agentType") ?? "");
  }, [values]);

  const query: PlatformQualityQuery = {
    ...(readEnum(values, "window", windowValues) === undefined
      ? {}
      : { window: readEnum(values, "window", windowValues)! }),
    ...(readOptional(values, "agentType", 100) === undefined
      ? {}
      : { agentType: readOptional(values, "agentType", 100)! }),
  };

  const quality = useQuery({
    queryKey: ["platform", "quality", query],
    queryFn: () => platformApi.quality(query),
    retry: 1,
    staleTime: 30_000,
  });
  const retry = () => void quality.refetch();
  const data = quality.data;
  const unavailableMetrics =
    data?.metrics.items.filter((metric) => metric.state !== "AVAILABLE") ?? [];

  return (
    <>
      <PageHeading
        eyebrow="AI QUALITY"
        title="AI чанар"
        description="Offline evaluation, production validation болон хүний санал гурван тусдаа хэмжигдэхүүн. Эдгээрийг нэг оноо болгож нийлүүлэхгүй — өөр утгатай тоонууд."
      />

      <PlatformFilterForm
        label="Quality filter"
        fetching={quality.isFetching}
        onApply={() => setValues({ window: range, agentType })}
        onReset={() => setValues({ window: undefined, agentType: undefined })}
        onRefresh={retry}
      >
        <Field label="Хугацаа">
          <Select value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="7d">Сүүлийн 7 хоног</option>
            <option value="30d">Сүүлийн 30 хоног</option>
            <option value="90d">Сүүлийн 90 хоног</option>
          </Select>
        </Field>
        <Field label="Agent type">
          <Input
            value={agentType}
            placeholder="Бүх агент"
            onChange={(event) => setAgentType(event.target.value)}
          />
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={quality.isPending}
        isError={quality.isError}
        error={quality.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Чанарын үзүүлэлт ачаалж байна…"
        errorTitle="Чанарын үзүүлэлт ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          {unavailableMetrics.length > 0 ? (
            <Card className="state-warning">
              <div className="platform-section-heading">
                <div>
                  <p className="eyebrow">MEASUREMENT READINESS</p>
                  <h2>Чанарын хэмжилт бүрэн бэлэн биш</h2>
                  <p>
                    Энэ нь agent сайн гэсэн үг биш. Доорх эх сурвалжуудад хангалттай нотолгоо
                    цуглараагүй тул чанарын дүгнэлт гаргах боломжгүй байна.
                  </p>
                </div>
              </div>
              <ul className="platform-state-list">
                {unavailableMetrics.map((metric) => (
                  <li key={metric.kind}>
                    <strong>{metric.label}:</strong>{" "}
                    {metric.kind === "OFFLINE_EVALUATION"
                      ? "evaluation command ажиллуулж PlatformEvaluationRun history хадгална."
                      : metric.kind === "PRODUCTION_VALIDATION"
                        ? "agent run бүр validation.ok verdict хадгалах ёстой."
                        : "review шийдвэрийг AgentFeedback ACCEPT/CORRECT/REJECT хэлбэрээр бүртгэнэ."}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="platform-kpi-grid platform-quality-grid">
            {data.metrics.items.map((metric) => (
              <MetricCard key={metric.kind} metric={metric} />
            ))}
          </div>

          <Card>
            <SectionHeader
              eyebrow="BY AGENT"
              title="Агентаар"
              context={data.byAgent.context}
              meta={`${formatCount(data.byAgent.items.length)} agent type`}
            />
            <UnavailableSection context={data.byAgent.context} />
            <DataTable
              headers={["Agent", "Offline", "Production", "Хүний санал"]}
              empty="Энэ хугацаанд чанарын хэмжилт алга"
              rows={data.byAgent.items.map((item) => [
                <Link key="agent" to={item.detailHref}>
                  {item.agentType}
                </Link>,
                <MetricValue key="offline" metric={item.offline} />,
                <MetricValue key="production" metric={item.production} />,
                <MetricValue key="human" metric={item.humanFeedback} />,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="RELEASE COMPARISON"
              title="Хувилбарын харьцуулалт"
              context={data.releases.context}
              meta={`${formatCount(data.releases.total)} хувилбар${data.releases.truncated ? " · эхний 25" : ""}`}
            />
            <UnavailableSection context={data.releases.context} />
            <DataTable
              headers={[
                "Хувилбар",
                "Модель",
                "Run",
                "Offline",
                "Production",
                "Хүний санал",
                "Сүүлд ажилласан",
              ]}
              empty="Энэ хугацаанд харьцуулах хувилбар алга"
              rows={data.releases.items.map((release) => [
                <div key="release" className="platform-cell-stack">
                  <span>{release.agentRelease}</span>
                  <small className="muted">{release.promptVersion}</small>
                </div>,
                <div key="model" className="platform-cell-stack">
                  <span>{release.modelId}</span>
                  <small className="muted">{release.provider}</small>
                </div>,
                <span key="runs">{formatCount(release.runs)}</span>,
                <MetricValue key="offline" metric={release.offline} />,
                <MetricValue key="production" metric={release.production} />,
                <MetricValue key="human" metric={release.humanFeedback} />,
                <span key="last">{formatPlatformDateTime(release.lastSeenAt)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="EVALUATION HISTORY"
              title="Evaluation түүх"
              context={data.evaluationHistory.context}
              meta={`${formatCount(data.evaluationHistory.total)} ажиллалт`}
            />
            <UnavailableSection context={data.evaluationHistory.context} />
            <DataTable
              headers={[
                "Suite",
                "Agent / хувилбар",
                "Case",
                "Тэнцсэн",
                "Унасан",
                "Оноо",
                "Дууссан",
                "Эх сурвалж",
              ]}
              empty="Хадгалагдсан evaluation ажиллалт алга"
              rows={data.evaluationHistory.items.map((run) => [
                <div key="suite" className="platform-cell-stack">
                  <span>{run.suiteKey}</span>
                  <small className="muted">{run.suiteVersion}</small>
                </div>,
                <div key="agent" className="platform-cell-stack">
                  <span>{run.agentType}</span>
                  <small className="muted">{run.agentRelease}</small>
                </div>,
                <span key="cases">{formatCount(run.caseCount)}</span>,
                <span key="passed">{formatCount(run.passedCount)}</span>,
                <span key="failed">{formatCount(run.failedCount)}</span>,
                <span key="score">
                  {run.scorePercent === null ? (
                    <span className="metric-unavailable">Sample хүрэлцэхгүй</span>
                  ) : (
                    formatPercent(run.scorePercent)
                  )}
                </span>,
                <span key="completed">{formatPlatformDateTime(run.completedAt)}</span>,
                <span key="source">{run.sourceRef ?? "—"}</span>,
              ])}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
