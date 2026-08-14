import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformUsageQuery } from "../../api/platform-schemas";
import {
  DrilldownStates,
  PlatformFilterForm,
  RangeField,
  readEnum,
  readOptional,
  readRange,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  formatCount,
  formatMicroUsd,
  formatPercent,
  SectionHeader,
  StatTile,
  UnavailableSection,
} from "../../components/platform/platform-presentation";
import { Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const groupValues = ["TENANT", "AGENT_TYPE", "MODEL"] as const;

const groupLabels: Record<(typeof groupValues)[number], string> = {
  TENANT: "Компани",
  AGENT_TYPE: "Agent type",
  MODEL: "Provider ба модель",
};

export function PlatformUsagePage() {
  const { values, setValues } = usePlatformSearchState();
  const [range, setRange] = useState(readRange(values));
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [agentType, setAgentType] = useState(values.get("agentType") ?? "");
  const [groupBy, setGroupBy] = useState(values.get("groupBy") ?? "TENANT");

  useEffect(() => {
    setRange(readRange(values));
    setTenantId(values.get("tenantId") ?? "");
    setAgentType(values.get("agentType") ?? "");
    setGroupBy(values.get("groupBy") ?? "TENANT");
  }, [values]);

  const query: PlatformUsageQuery = {
    window: readRange(values),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
    ...(readOptional(values, "agentType", 100) === undefined
      ? {}
      : { agentType: readOptional(values, "agentType", 100)! }),
    ...(readEnum(values, "groupBy", groupValues) === undefined
      ? {}
      : { groupBy: readEnum(values, "groupBy", groupValues)! }),
  };

  const usage = useQuery({
    queryKey: ["platform", "usage", query],
    queryFn: () => platformApi.usage(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void usage.refetch();
  const data = usage.data;

  return (
    <>
      <PageHeading
        eyebrow="PLATFORM"
        title="Ашиглалт ба зардал"
        description="Token болон зардлыг компани, agent type эсвэл моделиор. Quota модель байхгүй тул used/budget харуулахгүй."
      />

      <PlatformFilterForm
        label="Usage filter"
        fetching={usage.isFetching}
        onApply={() => setValues({ window: range, tenantId, agentType, groupBy })}
        onReset={() =>
          setValues({
            window: undefined,
            tenantId: undefined,
            agentType: undefined,
            groupBy: undefined,
          })
        }
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
        <Field label="Бүлэглэлт">
          <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
            {groupValues.map((value) => (
              <option key={value} value={value}>
                {groupLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={usage.isPending}
        isError={usage.isError}
        error={usage.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Ашиглалтын өгөгдөл ачаалж байна…"
        errorTitle="Ашиглалтын өгөгдөл ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          <div className="platform-stat-row">
            <StatTile label="Run" value={formatCount(data.totals.runs)} />
            <StatTile
              label="Нийт зардал"
              value={formatMicroUsd(data.totals.costMicroUsd)}
              hint="actual байвал actual, үгүй бол estimated"
            />
            <StatTile label="Бодит" value={formatMicroUsd(data.totals.actualMicroUsd)} />
            <StatTile label="Тооцоолсон" value={formatMicroUsd(data.totals.estimatedMicroUsd)} />
            <StatTile
              label="Actual coverage"
              value={formatPercent(data.totals.actualCoveragePercent)}
            />
            <StatTile
              label="Budget"
              value={<span className="metric-unavailable">Тохируулаагүй</span>}
              hint="Quota/limit модель хараахан алга"
            />
          </div>

          <Card>
            <SectionHeader
              eyebrow="TOKENS"
              title="Token хэрэглээ"
              context={data.totals.context}
            />
            <UnavailableSection context={data.totals.context} />
            <div className="platform-stat-row">
              <StatTile label="Input" value={formatCount(data.totals.inputTokens)} />
              <StatTile label="Output" value={formatCount(data.totals.outputTokens)} />
              <StatTile label="Cached input" value={formatCount(data.totals.cachedInputTokens)} />
              <StatTile label="Reasoning" value={formatCount(data.totals.reasoningTokens)} />
            </div>
          </Card>

          <Card>
            <SectionHeader
              eyebrow="BREAKDOWN"
              title={groupLabels[data.filters.groupBy]}
              context={data.groups.context}
              meta={`${formatCount(data.groups.total)} бүлэг${data.groups.truncated ? " · эхний 50" : ""}`}
            />
            <UnavailableSection context={data.groups.context} />
            <DataTable
              headers={[
                groupLabels[data.filters.groupBy],
                "Run",
                "Зардал",
                "Эзлэх хувь",
                "Actual coverage",
                "Input",
                "Output",
                "Cached",
              ]}
              empty="Энэ хугацаанд ашиглалт бүртгэгдээгүй"
              rows={data.groups.items.map((group) => [
                group.href === null ? (
                  <span key="label">{group.label}</span>
                ) : (
                  <Link key="label" to={group.href}>
                    {group.label}
                  </Link>
                ),
                <span key="runs">{formatCount(group.runs)}</span>,
                <div key="cost" className="platform-cell-stack">
                  <span>{formatMicroUsd(group.costMicroUsd)}</span>
                  <small className="muted">
                    {formatMicroUsd(group.actualMicroUsd)} actual ·{" "}
                    {formatMicroUsd(group.estimatedMicroUsd)} est
                  </small>
                </div>,
                <span key="share">{formatPercent(group.costSharePercent)}</span>,
                <span key="coverage">{formatPercent(group.actualCoveragePercent)}</span>,
                <span key="input">{formatCount(group.inputTokens)}</span>,
                <span key="output">{formatCount(group.outputTokens)}</span>,
                <span key="cached">{formatCount(group.cachedInputTokens)}</span>,
              ])}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
