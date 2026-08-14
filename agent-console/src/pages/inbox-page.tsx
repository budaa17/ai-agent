import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, ShieldAlert, X } from "lucide-react";
import { buildWatchApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Textarea,
} from "../components/ui";
import { JobHeadline } from "../components/job-headline";
import { useWorkspace } from "../hooks/use-workspace";
import { entityNumber, entityString, formatDate } from "../lib/format";
import { friendlyError } from "../lib/api-error";
import { latestActionableReviews, reviewReadiness } from "../lib/review-readiness";
import { contextRouteFor, resolveReviewTarget, targetTypeLabel } from "../lib/review-target";
import { roleTitle } from "../lib/roles";

type Row = Record<string, unknown>;

const DECISION_LABEL: Record<string, string> = {
  SUBMIT: "Бэлтгэсэн",
  APPROVE: "Баталсан",
  REJECT: "Татгалзсан",
  APPLY: "Хэрэгжүүлсэн",
  CANCEL: "Цуцалсан",
  SUPERSEDE: "Орлуулсан",
  CORRECT: "Залруулсан",
};

/**
 * The decision queue. Approving stages an artefact; applying is what actually
 * moves it into the baseline, and the two need different permissions. The
 * screen states which of the two the signed-in user can complete so nobody
 * approves something and assumes the work is done.
 */
export function InboxPage() {
  const { projectId = "" } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useWorkspace(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);

  const workspace = query.data?.workspace;
  const myRole = workspace?.role;

  const pending = useMemo(
    () =>
      latestActionableReviews(
        (workspace?.reviews ?? []).filter(
          (task) => entityString(task, "status") === "REVIEW_REQUIRED",
        ),
      ),
    [workspace],
  );
  const mine = useMemo(() => {
    const assigned = pending.filter((task) => entityString(task, "assignedRole") === myRole);
    if (workspace === undefined) return assigned;
    return assigned.slice().sort((left, right) => {
      const leftReady = reviewReadiness(workspace, left).ready ? 1 : 0;
      const rightReady = reviewReadiness(workspace, right).ready ? 1 : 0;
      return rightReady - leftReady;
    });
  }, [pending, myRole, workspace]);
  const others = useMemo(
    () => pending.filter((task) => entityString(task, "assignedRole") !== myRole),
    [pending, myRole],
  );

  const selected = useMemo<Row | null>(
    () => mine.find((task) => entityString(task, "id") === selectedId) ?? mine[0] ?? null,
    [mine, selectedId],
  );

  const decide = useMutation({
    mutationFn: async (input: {
      task: Row;
      decision: "APPROVE" | "REJECT";
      alsoApply: boolean;
      override?: boolean;
    }) => {
      const trimmed = reason.trim();
      if (trimmed.length < 3) throw new Error("Шийдвэрийн үндэслэл 3-аас доошгүй тэмдэгт байна");
      const taskId = entityString(input.task, "id");
      const rowVersion = entityNumber(input.task, "rowVersion") ?? 1;
      const decision = await buildWatchApi.decideReview(
        projectId,
        taskId,
        {
          decision: input.decision,
          expectedRowVersion: rowVersion,
          reason: trimmed,
          emergencyOverride: input.override === true,
        },
        `review-${taskId}-${crypto.randomUUID()}`,
      );
      if (input.decision === "REJECT" || !input.alsoApply) return { applied: false, blocked: null };
      try {
        await buildWatchApi.applyApprovedCommand(
          projectId,
          {
            reviewTaskId: taskId,
            targetType: entityString(input.task, "targetType") as never,
            targetId: entityString(input.task, "targetId"),
            // The decision just bumped the task; use the version it reports
            // rather than assuming how far it moved.
            targetVersion: entityNumber(input.task, "targetVersion") ?? 1,
            expectedRowVersion: decision.rowVersion,
            sourceHash: entityString(input.task, "sourceHash"),
            reason: trimmed,
          },
          `apply-${taskId}-${crypto.randomUUID()}`,
        );
        return { applied: true, blocked: null };
      } catch (error) {
        // The approval is already recorded and must not be reported as a
        // failure. Surface the apply problem separately so nobody re-approves
        // something that is in fact approved.
        return { applied: false, blocked: friendlyError(error).message };
      }
    },
    onSuccess: async (result) => {
      if (result.blocked !== null) {
        showToast(`Батлагдлаа. Хэрэгжүүлэх алхам амжилтгүй: ${result.blocked}`, "error");
      } else {
        showToast(
          result.applied ? "Батлагдаж, суурь хувилбарт хэрэгжлээ" : "Шийдвэр хадгалагдлаа",
          "success",
        );
      }
      setReason("");
      setSelectedId(null);
      setOverrideOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: async (error) => {
      const friendly = friendlyError(error);
      showToast(`${friendly.title}. ${friendly.message}`, "error");
      // A stale row version means our copy is behind. Pull the fresh one so the
      // next attempt is made against what the server actually holds.
      if (friendly.reloadable) {
        await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
        setSelectedId(null);
        setReason("");
      }
    },
  });

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (workspace === undefined) return <LoadingState />;

  const target = selected === null ? null : resolveReviewTarget(workspace, selected);
  const readiness =
    selected === null
      ? { ready: true, dependencies: [], unmet: [] }
      : reviewReadiness(workspace, selected);
  // Prepared / Reviewed / Approved already exist as decision rows; the queue
  // just never showed them. No new backend field is needed for the trail.
  const trail = ((selected?.decisions as Row[] | undefined) ?? [])
    .slice()
    .sort((left, right) =>
      entityString(left, "decidedAt").localeCompare(entityString(right, "decidedAt")),
    );
  const isOwnSubmission =
    selected !== null && entityString(selected, "createdByUserId") === auth.session?.user.id;
  const reasonReady = reason.trim().length >= 3;
  const contextRoute =
    selected === null ? null : contextRouteFor(entityString(selected, "targetType"));
  const canOverride =
    myRole !== undefined &&
    ["SUPER_ADMIN", "COMPANY_ADMIN", "PROJECT_MANAGER"].includes(myRole) &&
    (isOwnSubmission || entityString(selected ?? {}, "assignedRole") !== myRole);
  const canApply =
    target === null
      ? false
      : auth.hasProjectPermission(projectId, "COMMAND_APPLY") &&
        auth.hasProjectPermission(projectId, target.applyPermission);
  // Baseline and recovery apply straight through COMMAND_APPLY, so naming it
  // twice would read as a bug.
  const requiredPermissions =
    target === null || target.applyPermission === "COMMAND_APPLY"
      ? "COMMAND_APPLY эрх"
      : `${target.applyPermission} + COMMAND_APPLY эрх`;

  return (
    <>
      <JobHeadline
        question="Таны шийдвэр хүлээж байна уу?"
        count={mine.length}
        unit={mine.length === 0 ? "хүлээгдэж буй зүйл" : "зүйл шийдвэрлэх хэрэгтэй"}
        tone="attention"
        detail={
          mine.length === 0
            ? "Одоогоор бүх зүйл шийдэгдсэн байна."
            : "Батлах нь бэлтгэнэ, хэрэгжүүлэх нь суурь хувилбарт оруулна."
        }
      />
      {mine.length === 0 ? (
        <EmptyState
          title="Хүлээгдэж буй шийдвэр алга"
          description={
            others.length === 0
              ? "Энэ төсөлд хянагдахыг хүлээж буй зүйл байхгүй байна."
              : `Бусад үүрэгт ${others.length} даалгавар хүлээгдэж байна — тэдгээрийг та шийдэх эрхгүй.`
          }
        />
      ) : (
        <div className="inbox-layout">
          <Card className="inbox-queue">
            <ul className="inbox-list">
              {mine.map((task) => {
                const id = entityString(task, "id");
                const summary = resolveReviewTarget(workspace, task);
                const active = selected !== null && entityString(selected, "id") === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`inbox-row ${active ? "is-active" : ""}`}
                      onClick={() => {
                        setSelectedId(id);
                        setReason("");
                      }}
                    >
                      <span className="inbox-type">{summary.typeLabel}</span>
                      <strong>{summary.title}</strong>
                      <small>
                        {summary.subtitle ?? entityString(task, "targetId")} ·{" "}
                        {formatDate(entityString(task, "createdAt"))}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected !== null && target !== null ? (
            <Card className="inbox-detail">
              <p className="eyebrow">{target.typeLabel}</p>
              <h2>{target.title}</h2>
              {target.subtitle !== null ? (
                <p className="page-description">{target.subtitle}</p>
              ) : null}

              {target.metrics.length > 0 ? (
                <dl className="detail-list">
                  {target.metrics.map((metric) => (
                    <div key={metric.label}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {/*
                Four-eyes is enforced server-side. Saying so before the button is
                pressed beats letting the request fail with a 403 the reader has
                to decode.
              */}
              {!readiness.ready ? (
                <div className="notice-card is-warning">
                  <strong>
                    <ShieldAlert /> Эхлээд өмнөх шатуудыг батална
                  </strong>
                  <p className="muted-note">
                    {readiness.unmet.map((item) => `${item.label}: ${item.status}`).join(" · ")}
                  </p>
                </div>
              ) : isOwnSubmission ? (
                <div className="notice-card is-warning">
                  <strong>
                    <ShieldAlert /> Та үүнийг үүсгэсэн тул батлах боломжгүй
                  </strong>
                  <p className="muted-note">
                    Four-eyes дүрмээр өөрийн илгээсэн зүйлийг өөрөө батлахыг хориглоно. Өөр{" "}
                    {entityString(selected, "assignedRole")} эрхтэй хүн шийдвэрлэнэ.
                  </p>
                </div>
              ) : (
                <div className={`notice-card ${canApply ? "is-ok" : "is-warning"}`}>
                  <strong>
                    {canApply
                      ? "Та батлаад шууд хэрэгжүүлж чадна"
                      : "Та батлаж чадна, харин хэрэгжүүлж чадахгүй"}
                  </strong>
                  <p>
                    {canApply
                      ? `Хэрэгжүүлэхэд ${requiredPermissions} шаардлагатай — танд бий.`
                      : `Хэрэгжүүлэхэд ${requiredPermissions} хэрэгтэй. Батлагдсаны дараа эрх бүхий хүн суурь хувилбарт оруулна.`}
                  </p>
                </div>
              )}

              <Field
                label="Шийдвэрийн үндэслэл"
                hint="Аудитын бүртгэлд үлдэнэ. 3-аас доошгүй тэмдэгт."
              >
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Яагаад ийм шийдвэр гаргаснаа бичнэ үү"
                  disabled={isOwnSubmission}
                />
              </Field>

              {contextRoute !== null ? (
                <Link
                  className="link-button context-link"
                  to={`/projects/${projectId}/${contextRoute}`}
                >
                  Эх сурвалж, нотолгоог бүтнээр нь харах →
                </Link>
              ) : null}

              {trail.length > 0 ? (
                <div className="decision-trail">
                  <p className="eyebrow">Явц</p>
                  <ol>
                    {trail.map((step) => (
                      <li key={entityString(step, "id")}>
                        <strong>
                          {DECISION_LABEL[entityString(step, "decision")] ??
                            entityString(step, "decision")}
                        </strong>
                        <span>{roleTitle(entityString(step, "actorRole"))}</span>
                        <small>{formatDate(entityString(step, "decidedAt"))}</small>
                        {step.emergencyOverride === true ? (
                          <Badge tone="danger">Override</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <div className="form-actions">
                <Button
                  variant="secondary"
                  disabled={decide.isPending || isOwnSubmission || !reasonReady}
                  onClick={() =>
                    decide.mutate({ task: selected, decision: "REJECT", alsoApply: false })
                  }
                >
                  <X /> Татгалзах
                </Button>
                <Button
                  disabled={decide.isPending || isOwnSubmission || !reasonReady || !readiness.ready}
                  onClick={() =>
                    decide.mutate({ task: selected, decision: "APPROVE", alsoApply: canApply })
                  }
                >
                  <CheckCircle2 />
                  {decide.isPending
                    ? "Хадгалж байна…"
                    : !readiness.ready
                      ? "Өмнөх шат хүлээж байна"
                      : canApply
                        ? "Батлах ба хэрэгжүүлэх"
                        : "Батлах"}
                </Button>
              </div>

              {/*
                Override exists so a one-engineer project cannot deadlock on
                four-eyes. It is deliberately a secondary path: hidden behind a
                link, needs its own confirmation, and lands in the audit log.
              */}
              {canOverride ? (
                overrideOpen ? (
                  <div className="notice-card is-warning override-panel">
                    <strong>
                      <ShieldAlert /> Emergency Override
                    </strong>
                    <p className="muted-note">
                      Энэ үйлдэл стандарт approval flow-ийг алгасана. Хэн, хэзээ, ямар үндэслэлээр
                      давсныг аудитын бүртгэлд үүрд үлдээнэ.
                    </p>
                    <div className="form-actions">
                      <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
                        Болих
                      </Button>
                      <Button
                        variant="danger"
                        disabled={decide.isPending || !reasonReady}
                        onClick={() =>
                          decide.mutate({
                            task: selected,
                            decision: "APPROVE",
                            alsoApply: canApply,
                            override: true,
                          })
                        }
                      >
                        Override хийж батлах
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="link-button override-link"
                    onClick={() => setOverrideOpen(true)}
                  >
                    ⋯ Emergency override
                  </button>
                )
              ) : null}
            </Card>
          ) : null}
        </div>
      )}

      {others.length > 0 ? (
        <Card className="mt-6">
          <p className="eyebrow">Бусад үүрэгт</p>
          <h2>Өөр хүн шийдэх {others.length} даалгавар</h2>
          <ul className="inbox-list is-muted">
            {others.map((task) => (
              <li key={entityString(task, "id")}>
                <div className="inbox-row is-readonly">
                  <span className="inbox-type">
                    {targetTypeLabel(entityString(task, "targetType"))}
                  </span>
                  <strong>{entityString(task, "targetId")}</strong>
                  <small>
                    <ShieldAlert /> {entityString(task, "assignedRole")} шийднэ
                  </small>
                </div>
              </li>
            ))}
          </ul>
          <Badge tone="neutral">Танд эдгээрийг шийдэх эрх байхгүй</Badge>
        </Card>
      ) : null}
    </>
  );
}
