import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformAuditLogQuery } from "../../api/platform-schemas";
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
  formatPlatformDateTime,
  stateLabel,
  stateTone,
} from "../../components/platform/platform-presentation";
import { Badge, Card, DataTable, Field, Input, PageHeading, Select } from "../../components/ui";

const resultValues = ["SUCCESS", "DENIED", "FAILED"] as const;
const sourceValues = ["ALL", "PLATFORM", "TENANT"] as const;
const actorRoleValues = [
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_OPERATOR",
  "PLATFORM_AUDITOR",
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "PROJECT_MANAGER",
  "ENGINEER",
  "SITE_SUPERVISOR",
  "STOREKEEPER",
  "OBSERVER",
] as const;

function sourceLabel(value: (typeof sourceValues)[number]): string {
  if (value === "PLATFORM") return "Platform оператор";
  if (value === "TENANT") return "Компанийн role-ууд";
  return "Бүх эх үүсвэр";
}

export function PlatformAuditPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const [range, setRange] = useState(readRange(values));
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [actorId, setActorId] = useState(values.get("actorId") ?? "");
  const [source, setSource] = useState(values.get("source") ?? "ALL");
  const [actorRole, setActorRole] = useState(values.get("actorRole") ?? "");
  const [action, setAction] = useState(values.get("action") ?? "");
  const [result, setResult] = useState(values.get("result") ?? "");
  const highlighted = values.get("auditId");

  useEffect(() => {
    setRange(readRange(values));
    setTenantId(values.get("tenantId") ?? "");
    setActorId(values.get("actorId") ?? "");
    setSource(values.get("source") ?? "ALL");
    setActorRole(values.get("actorRole") ?? "");
    setAction(values.get("action") ?? "");
    setResult(values.get("result") ?? "");
  }, [values]);

  const query: PlatformAuditLogQuery = {
    window: readRange(values),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
    ...(readOptional(values, "actorId", 200) === undefined
      ? {}
      : { actorId: readOptional(values, "actorId", 200)! }),
    ...(readEnum(values, "source", sourceValues) === undefined
      ? {}
      : { source: readEnum(values, "source", sourceValues)! }),
    ...(readEnum(values, "actorRole", actorRoleValues) === undefined
      ? {}
      : { actorRole: readEnum(values, "actorRole", actorRoleValues)! }),
    ...(readOptional(values, "action", 200) === undefined
      ? {}
      : { action: readOptional(values, "action", 200)! }),
    ...(readEnum(values, "result", resultValues) === undefined
      ? {}
      : { result: readEnum(values, "result", resultValues)! }),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const audit = useQuery({
    queryKey: ["platform", "audit-logs", query],
    queryFn: () => platformApi.auditLogs(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void audit.refetch();

  return (
    <>
      <PageHeading
        eyebrow="PLATFORM"
        title="Audit log"
        description="Platform оператор болон бүх компанийн role-уудын үйлдэл, татгалзсан хандалт, өөрчлөлтийн hash нотолгоо."
      />

      <PlatformFilterForm
        label="Audit filter"
        fetching={audit.isFetching}
        onApply={() => {
          pager.reset();
          setValues({
            window: range,
            tenantId,
            actorId,
            source: source === "ALL" ? undefined : source,
            actorRole,
            action,
            result,
          });
        }}
        onReset={() => {
          pager.reset();
          setValues({
            window: undefined,
            tenantId: undefined,
            actorId: undefined,
            source: undefined,
            actorRole: undefined,
            action: undefined,
            result: undefined,
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
        <Field label="Actor ID">
          <Input
            value={actorId}
            placeholder="Бүх хэрэглэгч"
            onChange={(event) => setActorId(event.target.value)}
          />
        </Field>
        <Field label="Audit эх үүсвэр">
          <Select value={source} onChange={(event) => setSource(event.target.value)}>
            {sourceValues.map((value) => (
              <option key={value} value={value}>
                {sourceLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role">
          <Select value={actorRole} onChange={(event) => setActorRole(event.target.value)}>
            <option value="">Бүх role</option>
            {actorRoleValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Үйлдэл">
          <Input
            value={action}
            placeholder="Бүх үйлдэл"
            onChange={(event) => setAction(event.target.value)}
          />
        </Field>
        <Field label="Үр дүн">
          <Select value={result} onChange={(event) => setResult(event.target.value)}>
            <option value="">Бүгд</option>
            {resultValues.map((value) => (
              <option key={value} value={value}>
                {stateLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      </PlatformFilterForm>

      <DrilldownStates
        isPending={audit.isPending}
        isError={audit.isError}
        error={audit.error}
        retry={retry}
        problems={audit.data?.problems}
        loadingLabel="Audit log ачаалж байна…"
        errorTitle="Audit log ачаалсангүй"
      />

      {audit.data !== undefined ? (
        <Card>
          <DataTable
            headers={["Хугацаа", "Гүйцэтгэгч", "Үйлдэл", "Обьект", "Компани", "Үр дүн", "Hash"]}
            empty="Энэ шүүлтэд тохирох audit бичлэг алга"
            rows={audit.data.items.map((item) => [
              <div
                key="time"
                className={`platform-cell-stack ${highlighted === item.id ? "is-highlighted" : ""}`}
              >
                <span>{formatPlatformDateTime(item.occurredAt)}</span>
                <small className="muted">{item.correlationId}</small>
              </div>,
              <div key="actor" className="platform-cell-stack">
                <span>{item.actorDisplayName ?? item.actorId ?? "Систем"}</span>
                {item.actorRole === null ? null : <small className="muted">{item.actorRole}</small>}
              </div>,
              <div key="action" className="platform-cell-stack">
                <span>{item.action}</span>
                {item.reason === null ? null : <small className="muted">{item.reason}</small>}
              </div>,
              <div key="resource" className="platform-cell-stack">
                <span>{item.resourceType}</span>
                {item.resourceId === null ? null : (
                  <small className="muted">{item.resourceId}</small>
                )}
              </div>,
              item.tenantId === null ? (
                <span key="tenant">Platform</span>
              ) : (
                <Link
                  key="tenant"
                  to={`/platform/tenants/${encodeURIComponent(item.tenantId)}/health`}
                >
                  {item.tenantId}
                </Link>
              ),
              <Badge key="result" tone={stateTone(item.result)}>
                {stateLabel(item.result)}
              </Badge>,
              <div key="hash" className="platform-cell-stack">
                <small className="muted">
                  before: {item.beforeHash === null ? "—" : `${item.beforeHash.slice(0, 12)}…`}
                </small>
                <small className="muted">
                  after: {item.afterHash === null ? "—" : `${item.afterHash.slice(0, 12)}…`}
                </small>
              </div>,
            ])}
          />
          <CursorPager page={audit.data.page} pager={pager} itemCount={audit.data.items.length} />
        </Card>
      ) : null}
    </>
  );
}
