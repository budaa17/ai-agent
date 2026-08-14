import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformAgentRunListQuery } from "../../api/platform-schemas";
import {
  CursorPager,
  DrilldownStates,
  PlatformFilterForm,
  RangeField,
  readEnum,
  readOptional,
  readRange,
  useCursorPager,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  formatCount,
  formatLatency,
  formatMicroUsd,
  formatPlatformDateTime,
  stateLabel,
  stateTone,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const statusValues = ["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"] as const;
const outcomeValues = ["TERMINAL", "NON_COMPLETION"] as const;

export function PlatformAgentRunsPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const [range, setRange] = useState(readRange(values));
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [agentType, setAgentType] = useState(values.get("agentType") ?? "");
  const [status, setStatus] = useState(values.get("status") ?? "");
  const [outcome, setOutcome] = useState(values.get("outcome") ?? "");
  const [failureCategory, setFailureCategory] = useState(values.get("failureCategory") ?? "");
  const [stuck, setStuck] = useState(values.get("stuck") === "true");

  useEffect(() => {
    setRange(readRange(values));
    setTenantId(values.get("tenantId") ?? "");
    setAgentType(values.get("agentType") ?? "");
    setStatus(values.get("status") ?? "");
    setOutcome(values.get("outcome") ?? "");
    setFailureCategory(values.get("failureCategory") ?? "");
    setStuck(values.get("stuck") === "true");
  }, [values]);

  const query: PlatformAgentRunListQuery = {
    window: readRange(values),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
    ...(readOptional(values, "agentType", 100) === undefined
      ? {}
      : { agentType: readOptional(values, "agentType", 100)! }),
    ...(readEnum(values, "status", statusValues) === undefined
      ? {}
      : { status: readEnum(values, "status", statusValues)! }),
    ...(readEnum(values, "outcome", outcomeValues) === undefined
      ? {}
      : { outcome: readEnum(values, "outcome", outcomeValues)! }),
    ...(readOptional(values, "failureCategory", 60) === undefined
      ? {}
      : { failureCategory: readOptional(values, "failureCategory", 60)! }),
    ...(values.get("stuck") === "true" ? { stuck: "true" as const } : {}),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const runs = useQuery({
    queryKey: ["platform", "agent-runs", query],
    queryFn: () => platformApi.agentRuns(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void runs.refetch();

  return (
    <>
      <PageHeading
        eyebrow="AI OPERATIONS"
        title="Agent run-ууд"
        description="Run бүрийн metadata, зардлын үндэслэл болон stuck төлөв. Prompt, output болон tool payload энд харагдахгүй."
      />

      <PlatformFilterForm
        label="Agent run filter"
        fetching={runs.isFetching}
        onApply={() => {
          pager.reset();
          setValues({
            window: range,
            tenantId,
            agentType,
            status,
            outcome,
            failureCategory,
            stuck: stuck ? "true" : undefined,
          });
        }}
        onReset={() => {
          pager.reset();
          setValues({
            window: undefined,
            tenantId: undefined,
            agentType: undefined,
            status: undefined,
            outcome: undefined,
            failureCategory: undefined,
            stuck: undefined,
          });
        }}
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
        <Field label="Agent type">
          <Input
            value={agentType}
            placeholder="Бүх агент"
            onChange={(event) => setAgentType(event.target.value)}
          />
        </Field>
        <Field label="Төлөв">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Бүгд</option>
            {statusValues.map((value) => (
              <option key={value} value={value}>
                {stateLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Үр дүн">
          <Select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
            <option value="">Бүгд</option>
            <option value="TERMINAL">Terminal</option>
            <option value="NON_COMPLETION">Амжилтгүй</option>
          </Select>
        </Field>
        <Field label="Алдааны ангилал">
          <Input
            value={failureCategory}
            placeholder="Бүгд"
            onChange={(event) => setFailureCategory(event.target.value)}
          />
        </Field>
        <Field label="Зөвхөн stuck">
          <label className="platform-checkbox">
            <input
              type="checkbox"
              checked={stuck}
              onChange={(event) => setStuck(event.target.checked)}
            />
            <span>30 минутаас удаан RUNNING</span>
          </label>
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={runs.isPending}
        isError={runs.isError}
        error={runs.error}
        retry={retry}
        problems={runs.data?.problems}
        loadingLabel="Agent run-ууд ачаалж байна…"
        errorTitle="Agent run-ууд ачаалсангүй"
      />

      {runs.data !== undefined ? (
        <Card>
          <DataTable
            headers={[
              "Run",
              "Компани",
              "Agent",
              "Төлөв",
              "Эхэлсэн",
              "Latency",
              "Retry",
              "Зардал",
              "Модель",
            ]}
            empty="Энэ шүүлтэд тохирох run алга"
            rows={runs.data.items.map((run) => [
              <div key="run" className="platform-cell-stack">
                <Link to={run.diagnosticsHref}>{run.runId}</Link>
                {run.stuck ? <Badge tone="danger">Stuck</Badge> : null}
              </div>,
              <Link key="tenant" to={`/platform/tenants/${encodeURIComponent(run.tenantId)}/health`}>
                {run.tenantName ?? run.tenantId}
              </Link>,
              <Link key="agent" to={`/platform/agents/${encodeURIComponent(run.agentType)}`}>
                {run.agentType}
              </Link>,
              <div key="status" className="platform-cell-stack">
                <Badge tone={stateTone(run.status)}>{stateLabel(run.status)}</Badge>
                {run.failureCategory === "NONE" ? null : (
                  <small className="muted">{run.failureCategory}</small>
                )}
              </div>,
              <span key="started">{formatPlatformDateTime(run.startedAt)}</span>,
              <span key="latency">{formatLatency(run.latencyMs)}</span>,
              <span key="retry">{formatCount(run.retryCount)}</span>,
              <div key="cost" className="platform-cell-stack">
                <span>{formatMicroUsd(run.costMicroUsd)}</span>
                <small className="muted">{stateLabel(run.costBasis)}</small>
              </div>,
              <div key="model" className="platform-cell-stack">
                <span>{run.modelId}</span>
                <small className="muted">
                  {run.provider} · {run.promptVersion}
                </small>
              </div>,
            ])}
          />
          <CursorPager page={runs.data.page} pager={pager} itemCount={runs.data.items.length} />
        </Card>
      ) : null}
    </>
  );
}
