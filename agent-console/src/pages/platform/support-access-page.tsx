import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type {
  PlatformSupportAccessListQuery,
  PlatformSupportAccessRequest,
} from "../../api/platform-schemas";
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
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  PageHeading,
  Select,
  Textarea,
} from "../../components/ui";

const stateValues = ["REQUESTED", "APPROVED", "DENIED", "REVOKED", "EXPIRED"] as const;

const operationValues = [
  "READ_TENANT_HEALTH",
  "READ_AGENT_RUNS",
  "READ_RUN_DIAGNOSTICS",
  "READ_REVIEW_BACKLOG",
  "READ_SYSTEM_HEALTH",
] as const;

const operationLabels: Record<(typeof operationValues)[number], string> = {
  READ_TENANT_HEALTH: "Tenant health унших",
  READ_AGENT_RUNS: "Agent run унших",
  READ_RUN_DIAGNOSTICS: "Run diagnostics унших",
  READ_REVIEW_BACKLOG: "Review backlog унших",
  READ_SYSTEM_HEALTH: "Системийн төлөв унших",
};

const durationOptions = [
  { value: 900, label: "15 минут" },
  { value: 3_600, label: "1 цаг" },
  { value: 14_400, label: "4 цаг" },
  { value: 28_800, label: "8 цаг" },
];

function formatRemaining(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds <= 0) return "дууссан";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} мин үлдсэн`;
  return `${Math.floor(seconds / 3_600)} цаг үлдсэн`;
}

/**
 * Requesting access is deliberately explicit: a ticket, a reason, a bounded
 * scope and a bounded duration. Nothing here can produce a standing grant.
 */
function RequestForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  error: unknown;
  onSubmit: (input: PlatformSupportAccessRequest) => void;
  onCancel: () => void;
}) {
  const [ticket, setTicket] = useState("");
  const [reason, setReason] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(3_600);
  const [operations, setOperations] = useState<string[]>(["READ_TENANT_HEALTH"]);
  const [validation, setValidation] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ticket.trim().length === 0) {
      setValidation("Тасалбарын дугаар шаардлагатай");
      return;
    }
    if (reason.trim().length < 8) {
      setValidation("Шалтгаан дор хаяж 8 тэмдэгт байх ёстой");
      return;
    }
    if (tenantId.trim().length === 0) {
      setValidation("Tenant ID шаардлагатай");
      return;
    }
    if (operations.length === 0) {
      setValidation("Дор хаяж нэг үйлдэл сонгоно");
      return;
    }
    setValidation(null);
    onSubmit({
      ticketReference: ticket.trim(),
      reason: reason.trim(),
      tenantId: tenantId.trim(),
      allowedOperations: operations as PlatformSupportAccessRequest["allowedOperations"],
      durationSeconds,
    });
  };

  return (
    <form className="platform-action-form" aria-label="Хандалт хүсэх" onSubmit={submit}>
      <h3>Хандалт хүсэх</h3>
      <Field label="Тасалбарын дугаар">
        <Input value={ticket} onChange={(event) => setTicket(event.target.value)} />
      </Field>
      <Field label="Шалтгаан (audit-д хадгалагдана)">
        <Textarea
          value={reason}
          rows={2}
          placeholder="Юуг оношлохоор энэ хандалтыг хүсэж байна вэ?"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <Field label="Tenant ID">
        <Input value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
      </Field>
      <Field label="Хугацаа">
        <Select
          value={String(durationSeconds)}
          onChange={(event) => setDurationSeconds(Number(event.target.value))}
        >
          {durationOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Зөвшөөрөх үйлдэл (зөвхөн унших, маскласан)">
        <div className="platform-checkbox-list">
          {operationValues.map((operation) => (
            <label key={operation} className="platform-checkbox">
              <input
                type="checkbox"
                checked={operations.includes(operation)}
                onChange={(event) =>
                  setOperations((current) =>
                    event.target.checked
                      ? [...current, operation]
                      : current.filter((value) => value !== operation),
                  )
                }
              />
              <span>{operationLabels[operation]}</span>
            </label>
          ))}
        </div>
      </Field>
      {validation !== null ? (
        <p className="platform-filter-error" role="alert">
          {validation}
        </p>
      ) : null}
      {error !== null && error !== undefined ? (
        <ErrorState title="Хүсэлт илгээгдсэнгүй" error={error} />
      ) : null}
      <div className="platform-filter-actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Илгээж байна…" : "Хүсэлт илгээх"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Болих
        </Button>
      </div>
    </form>
  );
}

export function PlatformSupportAccessPage() {
  const { searchKey, values, setValues } = usePlatformSearchState();
  const pager = useCursorPager(searchKey);
  const queryClient = useQueryClient();
  const [state, setState] = useState(values.get("state") ?? "");
  const [tenantId, setTenantId] = useState(values.get("tenantId") ?? "");
  const [activeOnly, setActiveOnly] = useState(values.get("activeOnly") === "true");
  const [requesting, setRequesting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    setState(values.get("state") ?? "");
    setTenantId(values.get("tenantId") ?? "");
    setActiveOnly(values.get("activeOnly") === "true");
  }, [values]);

  const query: PlatformSupportAccessListQuery = {
    ...(readEnum(values, "state", stateValues) === undefined
      ? {}
      : { state: readEnum(values, "state", stateValues)! }),
    ...(readOptional(values, "tenantId", 200) === undefined
      ? {}
      : { tenantId: readOptional(values, "tenantId", 200)! }),
    ...(values.get("activeOnly") === "true" ? { activeOnly: "true" as const } : {}),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  };

  const grants = useQuery({
    queryKey: ["platform", "support-access", query],
    queryFn: () => platformApi.supportAccessGrants(query),
    retry: 1,
    staleTime: 15_000,
  });
  const retry = () => void grants.refetch();

  const request = useMutation({
    mutationFn: (input: PlatformSupportAccessRequest) => platformApi.requestSupportAccess(input),
    onSuccess: async (result) => {
      setRequesting(false);
      setOutcome(
        `Хүсэлт бүртгэгдлээ. Хоёр дахь хүн зөвшөөрөх хүртэл идэвхжихгүй · ${result.grant.grantId}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["platform", "support-access"] });
    },
  });

  return (
    <>
      <PageHeading
        eyebrow="SUPPORT ACCESS"
        title="Дэмжлэгийн хандалт"
        description="Нэг компани руу хугацаатай, зөвхөн уншдаг, маскласан хандалт. Чимээгүй impersonation байхгүй: хүсэлт, хоёр дахь хүний зөвшөөрөл, өөрөө дуусах хугацаа, бүрэн audit."
        actions={
          <Button
            type="button"
            onClick={() => {
              request.reset();
              setOutcome(null);
              setRequesting(true);
            }}
          >
            <KeyRound /> Хандалт хүсэх
          </Button>
        }
      />

      <PlatformFilterForm
        label="Support access filter"
        fetching={grants.isFetching}
        onApply={() => {
          pager.reset();
          setValues({ state, tenantId, activeOnly: activeOnly ? "true" : undefined });
        }}
        onReset={() => {
          pager.reset();
          setValues({ state: undefined, tenantId: undefined, activeOnly: undefined });
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
        <Field label="Tenant ID">
          <Input
            value={tenantId}
            placeholder="Бүх компани"
            onChange={(event) => setTenantId(event.target.value)}
          />
        </Field>
        <Field label="Зөвхөн идэвхтэй">
          <label className="platform-checkbox">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            <span>Одоо хүчинтэй хандалт</span>
          </label>
        </Field>
      </PlatformFilterForm>

      {outcome !== null ? (
        <p className="platform-action-outcome" role="status">
          {outcome}
        </p>
      ) : null}

      {requesting ? (
        <Card>
          <RequestForm
            pending={request.isPending}
            error={request.error}
            onCancel={() => {
              request.reset();
              setRequesting(false);
            }}
            onSubmit={(input) => request.mutate(input)}
          />
        </Card>
      ) : null}

      <DrilldownStates
        isPending={grants.isPending}
        isError={grants.isError}
        error={grants.error}
        retry={retry}
        problems={grants.data?.problems}
        loadingLabel="Хандалтын хүсэлт ачаалж байна…"
        errorTitle="Хандалтын хүсэлт ачаалсангүй"
      />

      {grants.data !== undefined ? (
        <div className="platform-overview-stack">
          <div className="platform-stat-row">
            <StatTile label="Хүлээгдэж буй" value={formatCount(grants.data.totals.requested)} />
            <StatTile label="Идэвхтэй" value={formatCount(grants.data.totals.active)} />
            <StatTile label="Хугацаа дууссан" value={formatCount(grants.data.totals.expired)} />
            <StatTile label="Цуцлагдсан" value={formatCount(grants.data.totals.revoked)} />
            <StatTile label="Татгалзсан" value={formatCount(grants.data.totals.denied)} />
          </div>

          <Card>
            <DataTable
              headers={[
                "Тасалбар",
                "Компани",
                "Төлөв",
                "Хамрах хүрээ",
                "Хүсэгч",
                "Зөвшөөрсөн",
                "Дуусах",
              ]}
              empty="Энэ шүүлтэд тохирох хандалт алга"
              rows={grants.data.items.map((grant) => [
                <div key="ticket" className="platform-cell-stack">
                  <Link to={grant.detailHref}>{grant.ticketReference}</Link>
                  <small className="muted">{grant.reason}</small>
                </div>,
                <span key="tenant">{grant.tenantName ?? grant.tenantId}</span>,
                <div key="state" className="platform-cell-stack">
                  <Badge tone={stateTone(grant.state)}>{stateLabel(grant.state)}</Badge>
                  {grant.active ? <small className="muted">одоо хүчинтэй</small> : null}
                </div>,
                <div key="scope" className="platform-cell-stack">
                  <span>{grant.allowedOperations.length} үйлдэл</span>
                  <small className="muted">зөвхөн унших · маскласан</small>
                </div>,
                <span key="requester">
                  {grant.requestedBy.displayName ?? grant.requestedBy.principalId}
                </span>,
                <span key="approver">
                  {grant.approvedBy === null
                    ? "Хүлээгдэж буй"
                    : (grant.approvedBy.displayName ?? grant.approvedBy.principalId)}
                </span>,
                <div key="expiry" className="platform-cell-stack">
                  <span>{formatPlatformDateTime(grant.expiresAt)}</span>
                  <small className="muted">{formatRemaining(grant.expiresInSeconds)}</small>
                </div>,
              ])}
            />
            <CursorPager
              page={grants.data.page}
              pager={pager}
              itemCount={grants.data.items.length}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
