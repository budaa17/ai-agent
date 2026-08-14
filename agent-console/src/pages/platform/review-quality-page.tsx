import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type {
  PlatformReviewBacklogQuery,
  PlatformReviewSummaryQuery,
} from "../../api/platform-schemas";
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
  formatPercent,
  formatPlatformDateTime,
  SectionHeader,
  StatTile,
  stateLabel,
  stateTone,
  UnavailableSection,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const slaValues = ["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"] as const;
const viewValues = ["summary", "backlog"] as const;

const bucketLabels: Record<string, string> = {
  UNDER_24H: "24 цагаас бага",
  H24_TO_72H: "24–72 цаг",
  D3_TO_D7: "3–7 хоног",
  OVER_7D: "7 хоногоос дээш",
};

function formatWaiting(seconds: number): string {
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} цаг`;
  return `${Math.floor(seconds / 86_400)} хоног`;
}

export function PlatformReviewQualityPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const view = readEnum(values, "view", viewValues) ?? "summary";
  const [range, setRange] = useState(readRange(values));
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [sla, setSla] = useState(values.get("sla") ?? "ALL");
  const [targetType, setTargetType] = useState(values.get("targetType") ?? "");

  useEffect(() => {
    setRange(readRange(values));
    setTenantId(values.get("tenantId") ?? "");
    setSla(values.get("sla") ?? "ALL");
    setTargetType(values.get("targetType") ?? "");
  }, [values]);

  const tenantFilter = readOptional(values, "tenantId", 200);
  const summaryQuery: PlatformReviewSummaryQuery = {
    window: readRange(values),
    ...(tenantFilter === undefined ? {} : { tenantId: tenantFilter }),
  };
  const backlogQuery: PlatformReviewBacklogQuery = {
    ...summaryQuery,
    ...(readEnum(values, "sla", slaValues) === undefined
      ? {}
      : { sla: readEnum(values, "sla", slaValues)! }),
    ...(readOptional(values, "targetType", 60) === undefined
      ? {}
      : { targetType: readOptional(values, "targetType", 60)! }),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const summary = useQuery({
    queryKey: ["platform", "review-summary", summaryQuery],
    queryFn: () => platformApi.reviewSummary(summaryQuery),
    enabled: view === "summary",
    retry: 1,
    staleTime: 15_000,
  });
  const backlog = useQuery({
    queryKey: ["platform", "review-backlog", backlogQuery],
    queryFn: () => platformApi.reviewBacklog(backlogQuery),
    enabled: view === "backlog",
    retry: 1,
    staleTime: 15_000,
  });
  const active = view === "summary" ? summary : backlog;
  const retry = () => void active.refetch();

  return (
    <>
      <PageHeading
        eyebrow="HUMAN REVIEW"
        title="Review ба чанар"
        description="Backlog, SLA болон шийдвэрийн урсгалын read-only монитор. Super Admin энд approve, reject, correct хийхгүй."
        actions={
          <div className="platform-view-switch" role="tablist" aria-label="Review харагдац">
            {viewValues.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                className={view === value ? "is-active" : ""}
                onClick={() => {
                  pager.reset();
                  setValues({ view: value });
                }}
              >
                {value === "summary" ? "Хураангуй" : "Backlog"}
              </button>
            ))}
          </div>
        }
      />

      <PlatformFilterForm
        label="Review filter"
        fetching={active.isFetching}
        onApply={() => {
          pager.reset();
          setValues({
            view,
            window: range,
            tenantId,
            ...(view === "backlog" ? { sla, targetType } : {}),
          });
        }}
        onReset={() => {
          pager.reset();
          setValues({
            window: undefined,
            tenantId: undefined,
            sla: undefined,
            targetType: undefined,
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
        {view === "backlog" ? (
          <>
            <Field label="SLA">
              <Select value={sla} onChange={(event) => setSla(event.target.value)}>
                <option value="ALL">Бүгд</option>
                <option value="BREACHED">Хугацаа хэтэрсэн</option>
                <option value="DUE_SOON">Удахгүй дуусах</option>
                <option value="NO_DUE_DATE">Хугацаагүй</option>
              </Select>
            </Field>
            <Field label="Target type">
              <Input
                value={targetType}
                placeholder="Бүгд"
                onChange={(event) => setTargetType(event.target.value)}
              />
            </Field>
          </>
        ) : null}
      </PlatformFilterForm>

      <DrilldownStates
        isPending={active.isPending}
        isError={active.isError}
        error={active.error}
        retry={retry}
        problems={active.data?.problems}
        loadingLabel="Review өгөгдөл ачаалж байна…"
        errorTitle="Review өгөгдөл ачаалсангүй"
      />

      {view === "summary" && summary.data !== undefined ? (
        <div className="platform-overview-stack">
          <div className="platform-stat-row">
            <StatTile
              label="Хүлээгдэж буй"
              value={formatCount(summary.data.backlog.waiting)}
              hint="status = REVIEW_REQUIRED"
            />
            <StatTile
              label="Хугацаа хэтэрсэн"
              value={formatCount(summary.data.backlog.breached)}
              hint="dueAt < одоо"
            />
            <StatTile
              label="Хугацаагүй"
              value={formatCount(summary.data.backlog.withoutDueAt)}
            />
            <StatTile
              label="Draft"
              value={formatCount(summary.data.backlog.draft)}
              hint="backlog-д ороогүй"
            />
            <StatTile
              label="Хамгийн эртний"
              value={formatPlatformDateTime(summary.data.backlog.oldestWaitingAt)}
            />
          </div>

          <Card>
            <SectionHeader
              eyebrow="AGEING"
              title="Хүлээлтийн хуваарилалт"
              context={summary.data.ageBuckets.context}
            />
            <UnavailableSection context={summary.data.ageBuckets.context} />
            <DataTable
              headers={["Хугацааны бүлэг", "Хүлээгдэж буй", "Хугацаа хэтэрсэн"]}
              rows={summary.data.ageBuckets.items.map((item) => [
                <span key="bucket">{bucketLabels[item.bucket] ?? item.bucket}</span>,
                <span key="waiting">{formatCount(item.waiting)}</span>,
                <span key="breached">{formatCount(item.breached)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="BY TENANT"
              title="Компаниар"
              context={summary.data.byTenant.context}
            />
            <UnavailableSection context={summary.data.byTenant.context} />
            <DataTable
              headers={["Компани", "Хүлээгдэж буй", "Хугацаа хэтэрсэн", "Хамгийн эртний"]}
              empty="Хүлээгдэж буй review алга"
              rows={summary.data.byTenant.items.map((item) => [
                <Link key="tenant" to={item.backlogHref}>
                  {item.tenantName ?? item.tenantId}
                </Link>,
                <span key="waiting">{formatCount(item.waiting)}</span>,
                <span key="breached">{formatCount(item.breached)}</span>,
                <span key="oldest">{formatPlatformDateTime(item.oldestWaitingAt)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="BY TARGET"
              title="Төрлөөр"
              context={summary.data.byTargetType.context}
            />
            <UnavailableSection context={summary.data.byTargetType.context} />
            <DataTable
              headers={["Target type", "Хүлээгдэж буй", "Хугацаа хэтэрсэн"]}
              empty="Хүлээгдэж буй review алга"
              rows={summary.data.byTargetType.items.map((item) => [
                <span key="target">{item.targetType}</span>,
                <span key="waiting">{formatCount(item.waiting)}</span>,
                <span key="breached">{formatCount(item.breached)}</span>,
              ])}
            />
          </Card>

          <Card>
            <SectionHeader
              eyebrow="THROUGHPUT"
              title="Шийдвэрийн урсгал"
              context={summary.data.throughput.context}
            />
            <UnavailableSection context={summary.data.throughput.context} />
            <div className="platform-stat-row">
              <StatTile label="Шийдсэн" value={formatCount(summary.data.throughput.decided)} />
              <StatTile label="Зөвшөөрсөн" value={formatCount(summary.data.throughput.approved)} />
              <StatTile label="Татгалзсан" value={formatCount(summary.data.throughput.rejected)} />
              <StatTile label="Засварласан" value={formatCount(summary.data.throughput.corrected)} />
              <StatTile
                label="Засварын хувь"
                value={formatPercent(summary.data.throughput.correctionRatePercent)}
              />
              <StatTile
                label="Emergency override"
                value={formatCount(summary.data.throughput.emergencyOverrides)}
              />
            </div>
          </Card>
        </div>
      ) : null}

      {view === "backlog" && backlog.data !== undefined ? (
        <Card>
          <DataTable
            headers={[
              "Review task",
              "Компани",
              "Target",
              "Хариуцагч",
              "Үүссэн",
              "Дуусах",
              "Хүлээсэн",
              "SLA",
            ]}
            empty="Энэ шүүлтэд тохирох review task алга"
            rows={backlog.data.items.map((task) => [
              <span key="task">{task.reviewTaskId}</span>,
              <Link key="tenant" to={task.tenantHref}>
                {task.tenantName ?? task.tenantId}
              </Link>,
              <div key="target" className="platform-cell-stack">
                <span>{task.targetType}</span>
                <small className="muted">v{formatCount(task.targetVersion)}</small>
              </div>,
              <div key="role" className="platform-cell-stack">
                <span>{task.assignedRole}</span>
                <small className="muted">
                  {task.assigned ? "хүн оноогдсон" : "хүн оноогоогүй"}
                </small>
              </div>,
              <span key="created">{formatPlatformDateTime(task.createdAt)}</span>,
              <span key="due">{formatPlatformDateTime(task.dueAt)}</span>,
              <span key="waiting">{formatWaiting(task.waitingSeconds)}</span>,
              <Badge key="sla" tone={stateTone(task.sla)}>
                {stateLabel(task.sla)}
              </Badge>,
            ])}
          />
          <CursorPager
            page={backlog.data.page}
            pager={pager}
            itemCount={backlog.data.items.length}
          />
        </Card>
      ) : null}
    </>
  );
}
