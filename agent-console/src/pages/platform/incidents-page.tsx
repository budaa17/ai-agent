import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformIncidentListQuery } from "../../api/platform-schemas";
import {
  CursorPager,
  DrilldownStates,
  PlatformFilterForm,
  readEnum,
  readOptional,
  useCursorPager,
  usePlatformSearchState,
} from "../../components/platform/platform-drilldown-shell";
import {
  formatCount,
  formatPlatformDateTime,
  StatTile,
  stateLabel,
  stateTone,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const stateValues = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "REOPENED"] as const;
const severityValues = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export function PlatformIncidentsPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const [state, setState] = useState(values.get("state") ?? "");
  const [severity, setSeverity] = useState(values.get("severity") ?? "");
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [includeResolved, setIncludeResolved] = useState(values.get("activeOnly") === "false");

  useEffect(() => {
    setState(values.get("state") ?? "");
    setSeverity(values.get("severity") ?? "");
    setTenantId(values.get("tenantId") ?? "");
    setIncludeResolved(values.get("activeOnly") === "false");
  }, [values]);

  const query: PlatformIncidentListQuery = {
    ...(readEnum(values, "state", stateValues) === undefined
      ? {}
      : { state: readEnum(values, "state", stateValues)! }),
    ...(readEnum(values, "severity", severityValues) === undefined
      ? {}
      : { severity: readEnum(values, "severity", severityValues)! }),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
    ...(values.get("activeOnly") === "false" ? { activeOnly: "false" as const } : {}),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const incidents = useQuery({
    queryKey: ["platform", "incidents", query],
    queryFn: () => platformApi.incidents(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void incidents.refetch();

  return (
    <>
      <PageHeading
        eyebrow="OPERATIONAL CONTROL"
        title="Инцидент"
        description="Давтагдсан signal нэг инцидент болж хадгалагдана. Шийдэгдсэн инцидент түүхээс устахгүй, signal дахин асвал дахин нээгдэнэ."
      />

      <PlatformFilterForm
        label="Incident filter"
        fetching={incidents.isFetching}
        onApply={() => {
          pager.reset();
          setValues({
            state,
            severity,
            tenantId,
            activeOnly: includeResolved ? "false" : undefined,
          });
        }}
        onReset={() => {
          pager.reset();
          setValues({
            state: undefined,
            severity: undefined,
            tenantId: undefined,
            activeOnly: undefined,
          });
        }}
        onRefresh={retry}
      >
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
        <Field label="Ноцтой байдал">
          <Select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="">Бүгд</option>
            {severityValues.map((value) => (
              <option key={value} value={value}>
                {stateLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tenant ID">
          <Input
            value={tenantId}
            placeholder="Бүх компани"
            onChange={(event) => setTenantId(event.target.value)}
          />
        </Field>
        <Field label="Шийдэгдсэнийг оруулах">
          <label className="platform-checkbox">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(event) => setIncludeResolved(event.target.checked)}
            />
            <span>Resolved инцидентийг харуулах</span>
          </label>
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={incidents.isPending}
        isError={incidents.isError}
        error={incidents.error}
        retry={retry}
        problems={incidents.data?.problems}
        loadingLabel="Инцидент ачаалж байна…"
        errorTitle="Инцидент ачаалсангүй"
      />

      {incidents.data !== undefined ? (
        <div className="platform-overview-stack">
          <div className="platform-stat-row">
            <StatTile label="Нээлттэй" value={formatCount(incidents.data.totals.open)} />
            <StatTile
              label="Хүлээн авсан"
              value={formatCount(incidents.data.totals.acknowledged)}
            />
            <StatTile label="Дахин нээгдсэн" value={formatCount(incidents.data.totals.reopened)} />
            <StatTile label="Шийдэгдсэн" value={formatCount(incidents.data.totals.resolved)} />
            <StatTile
              label="Идэвхтэй critical"
              value={formatCount(incidents.data.totals.critical)}
            />
            <StatTile label="Идэвхтэй high" value={formatCount(incidents.data.totals.high)} />
          </div>

          <Card>
            <DataTable
              headers={[
                "Инцидент",
                "Ноцтой",
                "Төлөв",
                "Хамрах хүрээ",
                "Нээгдсэн",
                "Сүүлийн нотолгоо",
                "Хариуцагч",
              ]}
              empty="Энэ шүүлтэд тохирох инцидент алга"
              rows={incidents.data.items.map((incident) => [
                <div key="title" className="platform-cell-stack">
                  <Link to={incident.detailHref}>{incident.title}</Link>
                  <small className="muted">{incident.ruleKey}</small>
                </div>,
                <Badge key="severity" tone={stateTone(incident.severity)}>
                  {stateLabel(incident.severity)}
                </Badge>,
                <div key="state" className="platform-cell-stack">
                  <Badge tone={stateTone(incident.state)}>{stateLabel(incident.state)}</Badge>
                  {incident.reopenCount === 0 ? null : (
                    <small className="muted">{incident.reopenCount}× дахин нээгдсэн</small>
                  )}
                </div>,
                <span key="scope">
                  {[incident.scope.tenantName, incident.scope.agentType, incident.scope.component]
                    .filter((value): value is string => value !== null)
                    .join(" · ") || "Platform"}
                </span>,
                <span key="opened">{formatPlatformDateTime(incident.openedAt)}</span>,
                <span key="evidence">{formatPlatformDateTime(incident.lastEvidenceAt)}</span>,
                <span key="owner">
                  {incident.assignedTo?.displayName ??
                    incident.assignedTo?.principalId ??
                    "Оноогоогүй"}
                </span>,
              ])}
            />
            <CursorPager
              page={incidents.data.page}
              pager={pager}
              itemCount={incidents.data.items.length}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
