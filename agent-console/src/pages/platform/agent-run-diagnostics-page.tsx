import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import { DrilldownStates } from "../../components/platform/platform-drilldown-shell";
import {
  formatCount,
  formatLatency,
  formatMicroUsd,
  formatPlatformDateTime,
  StatTile,
  stateLabel,
  stateTone,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, PageHeading } from "../../components/ui";

export function PlatformAgentRunDiagnosticsPage() {
  const { runId = "" } = useParams();
  const diagnostics = useQuery({
    queryKey: ["platform", "agent-run-diagnostics", runId],
    queryFn: () => platformApi.agentRunDiagnostics(runId),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void diagnostics.refetch();
  const data = diagnostics.data;

  return (
    <>
      <PageHeading
        eyebrow="RUN DIAGNOSTICS"
        title={runId}
        description="Run-ийн metadata, token/зардлын хэрэглээ болон tool дуудлагын хураангуй. Агуулга redact хийгдсэн."
        actions={
          <Link className="platform-card-link" to="/platform/agent-runs">
            <ArrowLeft /> Run жагсаалт
          </Link>
        }
      />

      <DrilldownStates
        isPending={diagnostics.isPending}
        isError={diagnostics.isError}
        error={diagnostics.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Run diagnostics ачаалж байна…"
        errorTitle="Run diagnostics ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          <Card className={`platform-status-card state-${data.run.status.toLowerCase()}`}>
            <div className="platform-status-main">
              <div>
                <p className="eyebrow">RUN STATUS</p>
                <h2>{stateLabel(data.run.status)}</h2>
                <p>
                  <Link to={`/platform/tenants/${encodeURIComponent(data.run.tenantId)}/health`}>
                    {data.run.tenantName ?? data.run.tenantId}
                  </Link>{" "}
                  ·{" "}
                  <Link to={`/platform/agents/${encodeURIComponent(data.run.agentType)}`}>
                    {data.run.agentType}
                  </Link>{" "}
                  · {data.run.trigger}
                </p>
              </div>
              <div className="platform-section-state">
                {data.run.stuck ? <Badge tone="danger">Stuck</Badge> : null}
                <Badge tone={stateTone(data.run.status)}>{stateLabel(data.run.status)}</Badge>
              </div>
            </div>
          </Card>

          <div className="platform-stat-row">
            <StatTile label="Эхэлсэн" value={formatPlatformDateTime(data.run.startedAt)} />
            <StatTile label="Дууссан" value={formatPlatformDateTime(data.run.completedAt)} />
            <StatTile label="Latency" value={formatLatency(data.run.latencyMs)} />
            <StatTile
              label="Retry"
              value={formatCount(data.run.retryCount)}
              hint={data.run.failureCategory}
            />
            <StatTile
              label="Зардал"
              value={formatMicroUsd(data.run.costMicroUsd)}
              hint={stateLabel(data.run.costBasis)}
            />
            <StatTile
              label="Validation"
              value={
                <Badge tone={stateTone(data.validation.state)}>
                  {stateLabel(data.validation.state)}
                </Badge>
              }
              hint={
                data.validation.issueCount === null
                  ? "issue тоо тодорхойгүй"
                  : `${formatCount(data.validation.issueCount)} issue`
              }
            />
          </div>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">EXECUTION</p>
                <h2>Гүйцэтгэлийн хамрах хүрээ</h2>
              </div>
            </div>
            <DataTable
              headers={["Талбар", "Утга"]}
              rows={[
                ["Project", data.execution.projectId],
                ["Request ID", data.execution.requestId ?? "—"],
                ["Event ID", data.execution.eventId ?? "—"],
                ["Trace ID", data.execution.traceId ?? "—"],
                ["Prompt version", data.run.promptVersion],
                ["Tool bundle", data.execution.toolBundleVersion],
                ["Output schema", formatCount(data.execution.outputSchemaVersion)],
                ["Data snapshot", data.execution.dataSnapshotVersion],
                ["Output SHA-256", data.execution.outputSha256 ?? "—"],
                [
                  "Content logging",
                  data.execution.contentLoggingEnabled ? "Идэвхтэй" : "Идэвхгүй",
                ],
                ["As of", formatPlatformDateTime(data.execution.asOf)],
                ["Provider / модель", `${data.run.provider} · ${data.run.modelId}`],
              ].map(([label, value]) => [
                <span key="label">{label}</span>,
                <span key="value">{value}</span>,
              ])}
            />
          </Card>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">USAGE</p>
                <h2>Token ба зардал</h2>
              </div>
            </div>
            <div className="platform-stat-row">
              <StatTile label="Input token" value={formatCount(data.usage.inputTokens)} />
              <StatTile label="Output token" value={formatCount(data.usage.outputTokens)} />
              <StatTile label="Cached input" value={formatCount(data.usage.cachedInputTokens)} />
              <StatTile label="Reasoning" value={formatCount(data.usage.reasoningTokens)} />
              <StatTile
                label="Тооцоолсон зардал"
                value={formatMicroUsd(data.usage.estimatedCostMicroUsd)}
              />
              <StatTile
                label="Бодит зардал"
                value={formatMicroUsd(data.usage.actualCostMicroUsd)}
                hint={data.usage.actualCostMicroUsd === null ? "бодит утга ирээгүй" : undefined}
              />
            </div>
          </Card>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">TOOL CALLS</p>
                <h2>Tool дуудлага</h2>
                <p>
                  {formatCount(data.toolCalls.total)} дуудлага
                  {data.toolCalls.truncated ? " · эхний 50 харагдаж байна" : ""}
                </p>
              </div>
            </div>
            <DataTable
              headers={["#", "Tool", "Төлөв", "Хугацаа", "Эхэлсэн"]}
              empty="Энэ run дээр tool дуудлага бүртгэгдээгүй"
              rows={data.toolCalls.items.map((call) => [
                <span key="sequence">{formatCount(call.sequence)}</span>,
                <span key="tool">{call.toolName}</span>,
                <Badge key="status" tone={stateTone(call.status)}>
                  {stateLabel(call.status)}
                </Badge>,
                <span key="latency">{formatLatency(call.latencyMs)}</span>,
                <span key="started">{formatPlatformDateTime(call.startedAt)}</span>,
              ])}
            />
          </Card>

          <Card className="platform-redaction-card">
            <div className="platform-status-main">
              <div className="platform-status-icon">
                <ShieldCheck />
              </div>
              <div>
                <p className="eyebrow">REDACTION</p>
                <h2>Агуулга харуулаагүй</h2>
                <p>{data.redaction.note}</p>
              </div>
              <Badge tone="info">{data.redaction.policy}</Badge>
            </div>
            <ul className="platform-cause-list">
              {data.redaction.redactedFields.map((field) => (
                <li key={field}>
                  <Badge tone="neutral">redacted</Badge>
                  <span>{field}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}
