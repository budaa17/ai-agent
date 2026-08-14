import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformAgentListQuery } from "../../api/platform-schemas";
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
  CauseList,
  formatCount,
  formatLatency,
  formatMicroUsd,
  formatPercent,
  formatPlatformDateTime,
  StatTile,
  stateLabel,
  stateTone,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const stateValues = ["ACTIVE", "DEGRADED", "UNKNOWN"] as const;
const sortValues = ["STATE", "AGENT_TYPE", "RUNS", "COMPLETION", "P95_LATENCY", "COST"] as const;

export function PlatformAgentsPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const [range, setRange] = useState(readRange(values));
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [state, setState] = useState(values.get("state") ?? "");
  const [sort, setSort] = useState(values.get("sort") ?? "STATE");

  useEffect(() => {
    setRange(readRange(values));
    setTenantId(values.get("tenantId") ?? "");
    setState(values.get("state") ?? "");
    setSort(values.get("sort") ?? "STATE");
  }, [values]);

  const query: PlatformAgentListQuery = {
    window: readRange(values),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
    ...(readEnum(values, "state", stateValues) === undefined
      ? {}
      : { state: readEnum(values, "state", stateValues)! }),
    ...(readEnum(values, "sort", sortValues) === undefined
      ? {}
      : { sort: readEnum(values, "sort", sortValues)! }),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const agents = useQuery({
    queryKey: ["platform", "agents", query],
    queryFn: () => platformApi.agents(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void agents.refetch();

  return (
    <>
      <PageHeading
        eyebrow="AI OPERATIONS"
        title="Агент ба run-ууд"
        description="Agent type тус бүрийн completion, latency, retry болон зардал. Completion зөвхөн хангалттай sample дээр гарна."
        actions={
          <Link className="platform-card-link" to="/platform/agent-runs">
            Бүх run харах
          </Link>
        }
      />

      <PlatformFilterForm
        label="Agent filter"
        fetching={agents.isFetching}
        onApply={() => {
          pager.reset();
          setValues({ window: range, tenantId, state, sort });
        }}
        onReset={() => {
          pager.reset();
          setValues({ window: undefined, tenantId: undefined, state: undefined, sort: undefined });
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
        <Field label="Төлөв">
          <Select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">Бүгд</option>
            {stateValues.map((value) => (
              <option key={value} value={value}>
                {stateLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Эрэмбэ">
          <Select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="STATE">Төлөв</option>
            <option value="AGENT_TYPE">Agent type</option>
            <option value="RUNS">Run тоо</option>
            <option value="COMPLETION">Completion</option>
            <option value="P95_LATENCY">p95 latency</option>
            <option value="COST">Зардал</option>
          </Select>
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={agents.isPending}
        isError={agents.isError}
        error={agents.error}
        retry={retry}
        problems={agents.data?.problems}
        loadingLabel="Agent жагсаалт ачаалж байна…"
        errorTitle="Agent жагсаалт ачаалсангүй"
      />

      {agents.data !== undefined ? (
        <div className="platform-overview-stack">
          <div className="platform-stat-row">
            <StatTile label="Шүүлтэд тохирсон" value={formatCount(agents.data.totals.matched)} />
            <StatTile label="Доголдолтой" value={formatCount(agents.data.totals.degraded)} />
            <StatTile label="Идэвхтэй" value={formatCount(agents.data.totals.active)} />
            <StatTile label="Тодорхойгүй" value={formatCount(agents.data.totals.unknown)} />
          </div>

          <Card>
            <DataTable
              headers={[
                "Agent",
                "Төлөв",
                "Run",
                "Completion",
                "Latency p50 / p95",
                "Retry",
                "Stuck",
                "Сүүлийн амжилт",
                "Зардал",
              ]}
              empty="Энэ шүүлтэд тохирох agent алга"
              rows={agents.data.items.map((agent) => [
                <div key="agent" className="platform-cell-stack">
                  <Link to={agent.detailHref}>{agent.agentType}</Link>
                  <CauseList causes={agent.reasons} />
                </div>,
                <Badge key="state" tone={stateTone(agent.state)}>
                  {stateLabel(agent.state)}
                </Badge>,
                <div key="runs" className="platform-cell-stack">
                  <span>{formatCount(agent.runs)}</span>
                  <small className="muted">{formatCount(agent.terminal)} terminal</small>
                </div>,
                <div key="completion" className="platform-cell-stack">
                  <span>
                    {agent.completionPercent === null ? (
                      <span className="metric-unavailable">Sample хүрэлцэхгүй</span>
                    ) : (
                      formatPercent(agent.completionPercent)
                    )}
                  </span>
                  <small className="muted">min sample {formatCount(agent.minimumSample)}</small>
                </div>,
                <span key="latency">
                  {formatLatency(agent.p50LatencyMs)} / {formatLatency(agent.p95LatencyMs)}
                </span>,
                <span key="retry">{formatPercent(agent.retryRatePercent)}</span>,
                <span key="stuck">{formatCount(agent.stuck)}</span>,
                <span key="success">{formatPlatformDateTime(agent.lastSuccessAt)}</span>,
                <span key="cost">{formatMicroUsd(agent.costMicroUsd)}</span>,
              ])}
            />
            <CursorPager
              page={agents.data.page}
              pager={pager}
              itemCount={agents.data.items.length}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
