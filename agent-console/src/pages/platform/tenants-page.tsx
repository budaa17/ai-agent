import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformTenantListQuery } from "../../api/platform-schemas";
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
  formatBytes,
  formatCount,
  formatMicroUsd,
  formatPercent,
  formatPlatformDateTime,
  StatTile,
  stateLabel,
  stateTone,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const healthValues = ["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"] as const;
const sortValues = [
  "HEALTH",
  "NAME",
  "LAST_ACTIVITY",
  "RUNS",
  "REVIEW_BREACHED",
  "AI_SPEND",
] as const;

export function PlatformTenantsPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const [search, setSearch] = useState(values.get("search") ?? "");
  const [health, setHealth] = useState(values.get("health") ?? "");
  const [range, setRange] = useState(readRange(values));
  const [sort, setSort] = useState(values.get("sort") ?? "HEALTH");

  useEffect(() => {
    setSearch(values.get("search") ?? "");
    setHealth(values.get("health") ?? "");
    setRange(readRange(values));
    setSort(values.get("sort") ?? "HEALTH");
  }, [values]);

  const query: PlatformTenantListQuery = {
    window: readRange(values),
    ...(readOptional(values, "search", 200) === undefined
      ? {}
      : { search: readOptional(values, "search", 200)! }),
    ...(readEnum(values, "health", healthValues) === undefined
      ? {}
      : { health: readEnum(values, "health", healthValues)! }),
    ...(readEnum(values, "sort", sortValues) === undefined
      ? {}
      : { sort: readEnum(values, "sort", sortValues)! }),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const tenants = useQuery({
    queryKey: ["platform", "tenants", query],
    queryFn: () => platformApi.tenants(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void tenants.refetch();

  return (
    <>
      <PageHeading
        eyebrow="PLATFORM OPERATIONS"
        title="Компаниуд"
        description="Backend-ийн deterministic дүрмээр ангилсан tenant health. Мөр бүр нэг компанийн дэлгэрэнгүй рүү шууд орно."
      />

      <PlatformFilterForm
        label="Tenant filter"
        fetching={tenants.isFetching}
        onApply={() => {
          pager.reset();
          setValues({ window: range, search, health, sort });
        }}
        onReset={() => {
          pager.reset();
          setValues({ window: undefined, search: undefined, health: undefined, sort: undefined });
        }}
        onRefresh={retry}
      >
        <RangeField value={range} onChange={setRange} />
        <Field label="Нэрээр хайх">
          <Input
            value={search}
            placeholder="Компанийн нэр эсвэл slug"
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label="Health">
          <Select value={health} onChange={(event) => setHealth(event.target.value)}>
            <option value="">Бүгд</option>
            {healthValues.map((value) => (
              <option key={value} value={value}>
                {stateLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Эрэмбэ">
          <Select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="HEALTH">Health</option>
            <option value="NAME">Нэр</option>
            <option value="LAST_ACTIVITY">Сүүлийн идэвх</option>
            <option value="RUNS">Agent run</option>
            <option value="REVIEW_BREACHED">Review breach</option>
            <option value="AI_SPEND">AI зардал</option>
          </Select>
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={tenants.isPending}
        isError={tenants.isError}
        error={tenants.error}
        retry={retry}
        problems={tenants.data?.problems}
        loadingLabel="Tenant жагсаалт ачаалж байна…"
        errorTitle="Tenant жагсаалт ачаалсангүй"
      />

      {tenants.data !== undefined ? (
        <div className="platform-overview-stack">
          <div className="platform-stat-row">
            <StatTile label="Шүүлтэд тохирсон" value={formatCount(tenants.data.totals.matched)} />
            <StatTile label="Critical" value={formatCount(tenants.data.totals.critical)} />
            <StatTile label="Warning" value={formatCount(tenants.data.totals.warning)} />
            <StatTile label="Healthy" value={formatCount(tenants.data.totals.healthy)} />
            <StatTile label="Идэвхгүй" value={formatCount(tenants.data.totals.inactive)} />
          </div>

          <Card>
            <DataTable
              headers={[
                "Компани",
                "Health",
                "Хэрэглэгч",
                "Agent run",
                "Review",
                "AI зардал",
                "Хадгалалт",
                "Сүүлийн идэвх",
              ]}
              empty="Энэ шүүлтэд тохирох компани алга"
              rows={tenants.data.items.map((tenant) => [
                <div key="name" className="platform-cell-stack">
                  <Link to={tenant.detailHref}>{tenant.name}</Link>
                  <small className="muted">{tenant.tenantId}</small>
                  <CauseList causes={tenant.reasons} />
                </div>,
                <Badge key="health" tone={stateTone(tenant.health)}>
                  {stateLabel(tenant.health)}
                </Badge>,
                <span key="users">
                  {formatCount(tenant.users?.loggedIn24h ?? null)} / {""}
                  {formatCount(tenant.users?.activeAccounts ?? null)}
                </span>,
                <div key="runs" className="platform-cell-stack">
                  <span>{formatCount(tenant.runs?.total ?? null)} нийт</span>
                  <small className="muted">
                    {formatPercent(tenant.runs?.completionPercent ?? null)} completion ·{" "}
                    {formatCount(tenant.runs?.stuck ?? null)} stuck
                  </small>
                </div>,
                <div key="review" className="platform-cell-stack">
                  <span>{formatCount(tenant.review?.waiting ?? null)} хүлээгдэж буй</span>
                  <small className="muted">
                    {formatCount(tenant.review?.breached ?? null)} breached
                  </small>
                </div>,
                <span key="spend">{formatMicroUsd(tenant.aiSpendMicroUsd)}</span>,
                <span key="storage">{formatBytes(tenant.storageBytes)}</span>,
                <span key="activity">{formatPlatformDateTime(tenant.lastActivityAt)}</span>,
              ])}
            />
            <CursorPager
              page={tenants.data.page}
              pager={pager}
              itemCount={tenants.data.items.length}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
