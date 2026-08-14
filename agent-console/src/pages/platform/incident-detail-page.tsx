import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformIncidentDetail } from "../../api/platform-schemas";
import { DrilldownStates } from "../../components/platform/platform-drilldown-shell";
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
  Textarea,
} from "../../components/ui";

type ActionKind = "ACKNOWLEDGE" | "ASSIGN" | "RESOLVE";

const actionLabels: Record<ActionKind, string> = {
  ACKNOWLEDGE: "Хүлээн авах",
  ASSIGN: "Хариуцагч оноох",
  RESOLVE: "Шийдвэрлэх",
};

const eventLabels: Record<string, string> = {
  OPENED: "Нээгдсэн",
  SEVERITY_CHANGED: "Ноцтой байдал өөрчлөгдсөн",
  ACKNOWLEDGED: "Хүлээн авсан",
  ASSIGNED: "Хариуцагч оноосон",
  RESOLVED: "Шийдвэрлэсэн",
  AUTO_RESOLVED: "Автоматаар шийдэгдсэн",
  REOPENED: "Дахин нээгдсэн",
};

/**
 * A critical action needs a reason and, above MEDIUM severity, a password
 * re-entry. The form refuses to submit until both are present so the operator
 * is never surprised by a 403 after typing a long note.
 */
function IncidentActionForm({
  kind,
  detail,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  kind: ActionKind;
  detail: PlatformIncidentDetail;
  pending: boolean;
  error: unknown;
  onSubmit: (input: {
    reason: string;
    assigneePrincipalId?: string;
    resolutionNote?: string;
    stepUpPassword?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState(detail.incident.assignedTo?.principalId ?? "");
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const stepUp = kind === "RESOLVE" && detail.resolveRequiresStepUp;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 8) {
      setValidation("Шалтгаан дор хаяж 8 тэмдэгт байх ёстой");
      return;
    }
    if (kind === "ASSIGN" && assignee.trim().length === 0) {
      setValidation("Хариуцагчийн principal ID шаардлагатай");
      return;
    }
    if (kind === "RESOLVE" && note.trim().length === 0) {
      setValidation("Шийдвэрлэсэн тэмдэглэл шаардлагатай");
      return;
    }
    if (stepUp && password.length < 12) {
      setValidation("Ноцтой инцидентийг шийдвэрлэхэд нууц үгээ дахин оруулна");
      return;
    }
    setValidation(null);
    onSubmit({
      reason: reason.trim(),
      ...(kind === "ASSIGN" ? { assigneePrincipalId: assignee.trim() } : {}),
      ...(kind === "RESOLVE" ? { resolutionNote: note.trim() } : {}),
      ...(stepUp ? { stepUpPassword: password } : {}),
    });
  };

  return (
    <form className="platform-action-form" aria-label={actionLabels[kind]} onSubmit={submit}>
      <h3>{actionLabels[kind]}</h3>
      <Field label="Шалтгаан (audit-д хадгалагдана)">
        <Textarea
          value={reason}
          rows={2}
          placeholder="Яагаад энэ үйлдлийг хийж байна вэ?"
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {kind === "ASSIGN" ? (
        <Field label="Хариуцагчийн principal ID">
          <Input value={assignee} onChange={(event) => setAssignee(event.target.value)} />
        </Field>
      ) : null}
      {kind === "RESOLVE" ? (
        <Field label="Шийдвэрлэсэн тэмдэглэл">
          <Textarea
            value={note}
            rows={3}
            placeholder="Юу засагдсан бэ?"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      ) : null}
      {stepUp ? (
        <Field label="Нууц үгээ баталгаажуулах">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      ) : null}
      {validation !== null ? (
        <p className="platform-filter-error" role="alert">
          {validation}
        </p>
      ) : null}
      {error !== null && error !== undefined ? (
        <ErrorState title="Үйлдэл амжилтгүй боллоо" error={error} />
      ) : null}
      <div className="platform-filter-actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Илгээж байна…" : actionLabels[kind]}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Болих
        </Button>
      </div>
    </form>
  );
}

export function PlatformIncidentDetailPage() {
  const { incidentId = "" } = useParams();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ActionKind | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const incident = useQuery({
    queryKey: ["platform", "incident", incidentId],
    queryFn: () => platformApi.incident(incidentId),
    retry: 1,
    staleTime: 5_000,
  });
  const retry = () => void incident.refetch();
  const detail = incident.data;

  const mutation = useMutation({
    mutationFn: async (input: {
      kind: ActionKind;
      reason: string;
      rowVersion: number;
      assigneePrincipalId?: string;
      resolutionNote?: string;
      stepUpPassword?: string;
    }) => {
      const base = { reason: input.reason, rowVersion: input.rowVersion };
      if (input.kind === "ACKNOWLEDGE") {
        return platformApi.acknowledgeIncident(incidentId, base);
      }
      if (input.kind === "ASSIGN") {
        return platformApi.assignIncident(incidentId, {
          ...base,
          assigneePrincipalId: input.assigneePrincipalId!,
        });
      }
      return platformApi.resolveIncident(incidentId, {
        ...base,
        resolutionNote: input.resolutionNote!,
        ...(input.stepUpPassword === undefined ? {} : { stepUpPassword: input.stepUpPassword }),
      });
    },
    onSuccess: async (result) => {
      setAction(null);
      setOutcome(
        result.change.idempotent
          ? "Энэ үйлдэл өмнө нь бүртгэгдсэн тул давхар хийгдсэнгүй."
          : `${result.change.summary} · correlation ${result.change.correlationId}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["platform", "incident", incidentId] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "incidents"] });
    },
  });

  return (
    <>
      <PageHeading
        eyebrow="INCIDENT"
        title={detail?.incident.title ?? incidentId}
        description="Инцидентийн бүрэн түүх, эзэмшил болон шийдвэрлэлт. Үйлдэл бүр шалтгаан, audit болон correlation ID-тай."
        actions={
          <Link className="platform-card-link" to="/platform/incidents">
            <ArrowLeft /> Инцидентийн жагсаалт
          </Link>
        }
      />

      <DrilldownStates
        isPending={incident.isPending}
        isError={incident.isError}
        error={incident.error}
        retry={retry}
        problems={detail?.problems}
        loadingLabel="Инцидент ачаалж байна…"
        errorTitle="Инцидент ачаалсангүй"
      />

      {detail !== undefined ? (
        <div className="platform-overview-stack">
          <Card className={`platform-status-card state-${detail.incident.state.toLowerCase()}`}>
            <div className="platform-status-main">
              <div className="platform-status-icon">
                <ShieldAlert />
              </div>
              <div>
                <p className="eyebrow">{detail.incident.ruleKey}</p>
                <h2>{stateLabel(detail.incident.state)}</h2>
                <p>{detail.incident.impact}</p>
              </div>
              <div className="platform-section-state">
                <Badge tone={stateTone(detail.incident.severity)}>
                  {stateLabel(detail.incident.severity)}
                </Badge>
                <Badge tone={stateTone(detail.incident.state)}>
                  {stateLabel(detail.incident.state)}
                </Badge>
              </div>
            </div>
            <p className="muted">{detail.incident.recommendedAction}</p>
            <Link className="platform-card-link" to={detail.incident.diagnosticsHref}>
              Оношилгоо руу очих
            </Link>
          </Card>

          <div className="platform-stat-row">
            <StatTile label="Нээгдсэн" value={formatPlatformDateTime(detail.incident.openedAt)} />
            <StatTile
              label="Сүүлийн нотолгоо"
              value={formatPlatformDateTime(detail.incident.lastEvidenceAt)}
            />
            <StatTile
              label="Хүлээн авсан"
              value={formatPlatformDateTime(detail.incident.acknowledgedAt)}
              hint={detail.incident.acknowledgedBy?.displayName ?? undefined}
            />
            <StatTile
              label="Хариуцагч"
              value={
                detail.incident.assignedTo?.displayName ??
                detail.incident.assignedTo?.principalId ??
                "Оноогоогүй"
              }
            />
            <StatTile
              label="Дахин нээгдсэн"
              value={formatCount(detail.incident.reopenCount)}
              hint={detail.incident.autoResolved ? "сүүлд автоматаар шийдэгдсэн" : undefined}
            />
            <StatTile
              label="Хамрах хүрээ"
              value={
                [
                  detail.incident.scope.tenantName,
                  detail.incident.scope.agentType,
                  detail.incident.scope.component,
                ]
                  .filter((value): value is string => value !== null)
                  .join(" · ") || "Platform"
              }
            />
          </div>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">EVIDENCE</p>
                <h2>Нотолгоо</h2>
              </div>
            </div>
            <DataTable
              headers={["Metric", "Утга", "Нэгж", "Ажиглагдсан"]}
              empty="Нотолгоо бүртгэгдээгүй"
              rows={detail.incident.evidence.map((item) => [
                <span key="metric">{item.metricKey}</span>,
                <span key="value">{String(item.value)}</span>,
                <span key="unit">{item.unit}</span>,
                <span key="observed">{formatPlatformDateTime(item.observedAt)}</span>,
              ])}
            />
          </Card>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">ACTIONS</p>
                <h2>Үйлдэл</h2>
                <p>
                  {detail.allowedActions.length === 0
                    ? "Таны эрх энэ инцидентэд үйлдэл хийхийг зөвшөөрөхгүй."
                    : "Үйлдэл бүр шалтгаан шаардаж, audit бичлэг үүсгэнэ."}
                </p>
              </div>
              <div className="platform-section-state">
                {detail.allowedActions.map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant={kind === "RESOLVE" ? "primary" : "secondary"}
                    onClick={() => {
                      mutation.reset();
                      setOutcome(null);
                      setAction(kind);
                    }}
                  >
                    {actionLabels[kind]}
                  </Button>
                ))}
              </div>
            </div>
            {outcome !== null ? (
              <p className="platform-action-outcome" role="status">
                {outcome}
              </p>
            ) : null}
            {action !== null ? (
              <IncidentActionForm
                kind={action}
                detail={detail}
                pending={mutation.isPending}
                error={mutation.error}
                onCancel={() => {
                  mutation.reset();
                  setAction(null);
                }}
                onSubmit={(input) =>
                  mutation.mutate({
                    kind: action,
                    rowVersion: detail.incident.rowVersion,
                    ...input,
                  })
                }
              />
            ) : null}
          </Card>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">TIMELINE</p>
                <h2>Түүх</h2>
                <p>
                  {formatCount(detail.timeline.total)} бичлэг
                  {detail.timeline.truncated ? " · эхний 200 харагдаж байна" : ""}
                </p>
              </div>
            </div>
            <DataTable
              headers={["Хугацаа", "Үйл явдал", "Гүйцэтгэгч", "Шалтгаан", "Correlation"]}
              empty="Түүх алга"
              rows={detail.timeline.items.map((event) => [
                <span key="time">{formatPlatformDateTime(event.occurredAt)}</span>,
                <div key="type" className="platform-cell-stack">
                  <span>{eventLabels[event.type] ?? event.type}</span>
                  <small className="muted">
                    {event.fromState === null
                      ? stateLabel(event.toState)
                      : `${stateLabel(event.fromState)} → ${stateLabel(event.toState)}`}
                  </small>
                </div>,
                <div key="actor" className="platform-cell-stack">
                  <span>{event.actor?.displayName ?? event.actor?.principalId ?? "Систем"}</span>
                  {event.actorRole === null ? null : (
                    <small className="muted">{event.actorRole}</small>
                  )}
                </div>,
                <div key="reason" className="platform-cell-stack">
                  <span>{event.reason ?? "—"}</span>
                  {event.note === null ? null : <small className="muted">{event.note}</small>}
                </div>,
                <small key="correlation" className="muted">
                  {event.correlationId}
                </small>,
              ])}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
