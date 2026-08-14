import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
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
  PageHeading,
  Textarea,
} from "../../components/ui";

type Decision = "APPROVE" | "DENY" | "REVOKE";

const decisionLabels: Record<Decision, string> = {
  APPROVE: "Зөвшөөрөх",
  DENY: "Татгалзах",
  REVOKE: "Цуцлах",
};

const eventLabels: Record<string, string> = {
  REQUESTED: "Хүсэлт гаргасан",
  APPROVED: "Зөвшөөрсөн",
  DENIED: "Татгалзсан",
  REVOKED: "Цуцалсан",
  EXPIRED: "Хугацаа дууссан",
  USED: "Ашигласан",
};

export function PlatformSupportAccessDetailPage() {
  const { grantId = "" } = useParams();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const grant = useQuery({
    queryKey: ["platform", "support-access", grantId],
    queryFn: () => platformApi.supportAccessGrant(grantId),
    retry: 1,
    staleTime: 5_000,
  });
  const retry = () => void grant.refetch();
  const data = grant.data;

  const mutation = useMutation({
    mutationFn: (input: { decision: Decision; reason: string; rowVersion: number }) =>
      platformApi.decideSupportAccess(
        grantId,
        input.decision.toLowerCase() as "approve" | "deny" | "revoke",
        { reason: input.reason, rowVersion: input.rowVersion },
      ),
    onSuccess: async (result) => {
      setDecision(null);
      setReason("");
      setOutcome(
        result.change.idempotent
          ? "Энэ шийдвэр өмнө нь бүртгэгдсэн тул давхар хийгдсэнгүй."
          : `${result.change.summary} · correlation ${result.change.correlationId}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["platform", "support-access"] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (data === undefined || decision === null) return;
    if (reason.trim().length < 8) {
      setValidation("Шалтгаан дор хаяж 8 тэмдэгт байх ёстой");
      return;
    }
    setValidation(null);
    mutation.mutate({ decision, reason: reason.trim(), rowVersion: data.grant.rowVersion });
  };

  return (
    <>
      <PageHeading
        eyebrow="SUPPORT ACCESS"
        title={data?.grant.ticketReference ?? grantId}
        description="Хугацаатай, зөвхөн уншдаг, маскласан хандалтын бүрэн түүх. Хүсэгч өөрөө зөвшөөрөх боломжгүй."
        actions={
          <Link className="platform-card-link" to="/platform/support-access">
            <ArrowLeft /> Хандалтын жагсаалт
          </Link>
        }
      />

      <DrilldownStates
        isPending={grant.isPending}
        isError={grant.isError}
        error={grant.error}
        retry={retry}
        problems={data?.problems}
        loadingLabel="Хандалт ачаалж байна…"
        errorTitle="Хандалт ачаалсангүй"
      />

      {data !== undefined ? (
        <div className="platform-overview-stack">
          <Card className={`platform-status-card state-${data.grant.state.toLowerCase()}`}>
            <div className="platform-status-main">
              <div className="platform-status-icon">
                <ShieldCheck />
              </div>
              <div>
                <p className="eyebrow">{data.grant.tenantName ?? data.grant.tenantId}</p>
                <h2>{stateLabel(data.grant.state)}</h2>
                <p>{data.grant.reason}</p>
              </div>
              <div className="platform-section-state">
                <Badge tone={stateTone(data.grant.state)}>{stateLabel(data.grant.state)}</Badge>
                {data.grant.active ? <Badge tone="warning">Одоо хүчинтэй</Badge> : null}
              </div>
            </div>
            <ul className="platform-cause-list">
              {data.grant.allowedOperations.map((operation) => (
                <li key={operation}>
                  <Badge tone="neutral">read-only</Badge>
                  <span>{operation}</span>
                </li>
              ))}
            </ul>
            <p className="muted">
              Агуулга үргэлж маскласан байна. Энэ хандалт tenant-ийн барилгын өгөгдлийг задлан
              харуулахгүй.
            </p>
          </Card>

          <div className="platform-stat-row">
            <StatTile
              label="Хүсэгч"
              value={data.grant.requestedBy.displayName ?? data.grant.requestedBy.principalId}
              hint={formatPlatformDateTime(data.grant.requestedAt)}
            />
            <StatTile
              label="Зөвшөөрсөн"
              value={
                data.grant.approvedBy === null
                  ? "Хүлээгдэж буй"
                  : (data.grant.approvedBy.displayName ?? data.grant.approvedBy.principalId)
              }
              hint={formatPlatformDateTime(data.grant.approvedAt)}
            />
            <StatTile
              label="Эхэлсэн"
              value={formatPlatformDateTime(data.grant.startsAt)}
            />
            <StatTile label="Дуусах" value={formatPlatformDateTime(data.grant.expiresAt)} />
            <StatTile label="Ашигласан" value={formatCount(data.grant.useCount)} />
            <StatTile
              label="Цуцалсан"
              value={
                data.grant.revokedBy === null
                  ? "—"
                  : (data.grant.revokedBy.displayName ?? data.grant.revokedBy.principalId)
              }
              hint={formatPlatformDateTime(data.grant.revokedAt)}
            />
          </div>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">DECISION</p>
                <h2>Шийдвэр</h2>
                <p>
                  {data.allowedActions.length === 0
                    ? "Энэ хандалт дээр таны хийж болох үйлдэл алга."
                    : data.canApprove
                      ? "Шийдвэр бүр шалтгаан шаардаж, audit бичлэг үүсгэнэ."
                      : "Та энэ хүсэлтийг гаргасан тул өөрөө зөвшөөрөх боломжгүй."}
                </p>
              </div>
              <div className="platform-section-state">
                {data.allowedActions.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={value === "APPROVE" ? "primary" : "secondary"}
                    onClick={() => {
                      mutation.reset();
                      setOutcome(null);
                      setReason("");
                      setDecision(value);
                    }}
                  >
                    {decisionLabels[value]}
                  </Button>
                ))}
              </div>
            </div>
            {outcome !== null ? (
              <p className="platform-action-outcome" role="status">
                {outcome}
              </p>
            ) : null}
            {decision !== null ? (
              <form
                className="platform-action-form"
                aria-label={decisionLabels[decision]}
                onSubmit={submit}
              >
                <h3>{decisionLabels[decision]}</h3>
                <Field label="Шалтгаан (audit-д хадгалагдана)">
                  <Textarea
                    value={reason}
                    rows={2}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                {validation !== null ? (
                  <p className="platform-filter-error" role="alert">
                    {validation}
                  </p>
                ) : null}
                {mutation.error !== null ? (
                  <ErrorState title="Шийдвэр амжилтгүй боллоо" error={mutation.error} />
                ) : null}
                <div className="platform-filter-actions">
                  <Button type="submit" disabled={mutation.isPending}>
                    {mutation.isPending ? "Илгээж байна…" : decisionLabels[decision]}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      mutation.reset();
                      setDecision(null);
                    }}
                  >
                    Болих
                  </Button>
                </div>
              </form>
            ) : null}
          </Card>

          <Card>
            <div className="platform-section-heading">
              <div>
                <p className="eyebrow">TIMELINE</p>
                <h2>Түүх</h2>
                <p>
                  {formatCount(data.timeline.total)} бичлэг
                  {data.timeline.truncated ? " · эхний 200 харагдаж байна" : ""}
                </p>
              </div>
            </div>
            <DataTable
              headers={["Хугацаа", "Үйл явдал", "Гүйцэтгэгч", "Шалтгаан", "Correlation"]}
              empty="Түүх алга"
              rows={data.timeline.items.map((event) => [
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
                <span key="reason">{event.reason ?? "—"}</span>,
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
