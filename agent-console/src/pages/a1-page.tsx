import { AlertCircle, CheckCircle2, FileImage, Quote } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { buildWatchApi, sha256Hex } from "../api/client";
import { ReviewAction } from "../components/review-action";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeading,
  Textarea,
} from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import { entityString, formatDate, formatNumber } from "../lib/format";

export function A1Page() {
  const { projectId } = useParams();
  const query = useWorkspace(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (projectId === undefined) return null;
  if (query.isPending) return <LoadingState label="A1 draft inbox ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const workspace = query.data.workspace;
  const drafts = workspace.assistants.a1Drafts;
  const selected = drafts.find((draft) => entityString(draft, "id") === selectedId) ?? drafts[0];
  const review =
    selected === undefined
      ? undefined
      : workspace.reviews
          .filter(
            (task) => entityString(task, "targetId") === entityString(selected, "id"),
          )
          .sort(
            (left, right) =>
              (Number(right.targetVersion) || 0) - (Number(left.targetVersion) || 0),
          )[0];
  const canDecide =
    review !== undefined &&
    (entityString(review, "assignedRole") === workspace.role ||
      ["SUPER_ADMIN", "COMPANY_ADMIN"].includes(workspace.role));
  return (
    <>
      <PageHeading
        eyebrow="ТАЛБАЙН ТАЙЛАН"
        title="Бүтэцлэсэн draft review"
        description="Original source, structured field, confidence, evidence болон validation-ийг зэрэгцүүлж хүний шийдвэр гаргана."
        actions={<Badge tone="purple">{drafts.length} draft</Badge>}
      />
      {workspace.permissions.includes("AGENT_RUN") ? (
        <A1IntakePanel projectId={projectId} />
      ) : null}
      {drafts.length === 0 ? (
        <EmptyState
          title="A1 draft алга"
          description="Text/image intake ажилласны дараа draft inbox-д орж ирнэ."
        />
      ) : (
        <div className="review-workspace">
          <Card className="inbox-list">
            <div className="card-heading">
              <div>
                <p className="eyebrow">INBOX</p>
                <h2>Review хүлээж буй</h2>
              </div>
            </div>
            {drafts.map((draft) => (
              <button
                key={entityString(draft, "id")}
                type="button"
                className={
                  entityString(draft, "id") === entityString(selected ?? {}, "id") ? "active" : ""
                }
                onClick={() => setSelectedId(entityString(draft, "id"))}
              >
                <div>
                  <strong>{draftTitle(draft)}</strong>
                  <span>{formatDate(entityString(draft, "createdAt"))}</span>
                </div>
                <Badge tone={statusTone(entityString(draft, "status"))}>
                  {entityString(draft, "status")}
                </Badge>
              </button>
            ))}
          </Card>
          {selected === undefined ? null : (
            <div className="stack">
              <Card>
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">ORIGINAL SOURCE</p>
                    <h2>
                      {entityString(selected, "sourceFileName") === "—"
                        ? "Талбайн тэмдэглэл"
                        : entityString(selected, "sourceFileName")}
                    </h2>
                  </div>
                  <Badge tone="neutral">{entityString(selected, "sourceType")}</Badge>
                </div>
                <blockquote className="source-quote">
                  <Quote />
                  {entityString(selected, "sourceText")}
                </blockquote>
                {entityString(selected, "sourceFileName") !== "—" ? (
                  <div className="source-file">
                    <FileImage />
                    <div>
                      <strong>{entityString(selected, "sourceFileName")}</strong>
                      <span>{entityString(selected, "sourceMediaType")}</span>
                    </div>
                  </div>
                ) : null}
              </Card>
              <StructuredDraft draft={selected} />
              {workspace.permissions.includes("AGENT_RUN") ? (
                <A1CorrectionForm projectId={projectId} draft={selected} />
              ) : null}
              <ValidationPanel draft={selected} />
              {review !== undefined ? (
                <Card>
                  <div className="card-heading">
                    <div>
                      <p className="eyebrow">HUMAN GATE</p>
                      <h2>Draft шийдвэр</h2>
                    </div>
                    <Badge tone="warning">{entityString(review, "status")}</Badge>
                  </div>
                  {canDecide ? (
                    <ReviewAction projectId={projectId} task={review} />
                  ) : (
                    <p className="muted">
                      {entityString(review, "assignedRole")} role-ийн reviewer шийдвэрлэнэ.
                    </p>
                  )}
                </Card>
              ) : (
                <Card className="notice-card">
                  <AlertCircle />
                  <div>
                    <strong>Correction шаардлагатай</strong>
                    <p>
                      Validation алдааг засаж хадгалсны дараа canonical ReviewTask автоматаар
                      үүснэ. Review task-гүй draft canonical data-д хэрэгжихгүй.
                    </p>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const numberFields = new Set([
  "progressPercent",
  "previousProgressPercent",
  "daysWithoutProgress",
]);
const dateFields = new Set([
  "reportDate",
  "plannedStartDate",
  "plannedEndDate",
  "actualStartDate",
  "actualEndDate",
  "forecastEndDate",
]);
const hiddenFields = new Set(["schemaVersion", "language", "issueTypes"]);

function A1CorrectionForm({
  projectId,
  draft,
}: {
  projectId: string;
  draft: Record<string, unknown>;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const draftId = entityString(draft, "id");
  const [structured, setStructured] = useState<Record<string, unknown>>(() =>
    record(draft.structuredData),
  );
  const [reason, setReason] = useState("");
  useEffect(() => {
    setStructured(record(draft.structuredData));
    setReason("");
  }, [draftId, draft.structuredData]);
  const correction = useMutation({
    mutationFn: () =>
      buildWatchApi.correctA1Draft(
        projectId,
        draftId,
        {
          expectedRowVersion: Number(draft.rowVersion) || 1,
          structuredData: structured,
          reason: reason.trim(),
        },
        `a1-correction-${draftId}-${crypto.randomUUID()}`,
      ),
    onSuccess: async (result) => {
      showToast(
        result.reviewTaskId === null
          ? "Засвар хадгалагдсан ч validation алдаа үлдсэн байна"
          : "Засвар хадгалагдаж, шинэ canonical review task үүслээ",
        result.reviewTaskId === null ? "error" : "success",
      );
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });
  if (!["READY_FOR_REVIEW", "NEEDS_CORRECTION"].includes(entityString(draft, "status"))) {
    return null;
  }
  const setField = (field: string, raw: string) => {
    setStructured((current) => ({
      ...current,
      [field]: raw === "" ? null : numberFields.has(field) ? Number(raw) : raw,
    }));
  };
  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">HUMAN CORRECTION</p>
          <h2>Structured талбар засах</h2>
        </div>
        <Badge tone="info">v{Number(draft.rowVersion) || 1}</Badge>
      </div>
      <div className="form-grid">
        <Field label="Хэл">
          <select
            value={stringValue(structured.language) ?? "mn"}
            onChange={(event) => setField("language", event.target.value)}
          >
            <option value="mn">Монгол</option>
            <option value="en">English</option>
            <option value="mixed">Mixed</option>
          </select>
        </Field>
        {Object.entries(structured)
          .filter(([field]) => !hiddenFields.has(field))
          .map(([field, value]) => (
            <Field key={field} label={field}>
              <Input
                type={dateFields.has(field) ? "date" : numberFields.has(field) ? "number" : "text"}
                value={stringValue(value) ?? ""}
                onChange={(event) => setField(field, event.target.value)}
              />
            </Field>
          ))}
        <Field label="Issue types (таслалаар)">
          <Input
            value={Array.isArray(structured.issueTypes) ? structured.issueTypes.join(", ") : ""}
            onChange={(event) =>
              setStructured((current) => ({
                ...current,
                issueTypes: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
          />
        </Field>
      </div>
      <Field label="Засварын үндэслэл">
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ямар талбарыг ямар эх сурвалжаар зассанаа бичнэ үү"
        />
      </Field>
      <Button
        disabled={correction.isPending || reason.trim().length < 3}
        onClick={() => correction.mutate()}
      >
        {correction.isPending ? "Validation шалгаж байна…" : "Засвар хадгалж review-д илгээх"}
      </Button>
    </Card>
  );
}

function A1IntakePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [sourceText, setSourceText] = useState("");
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [image, setImage] = useState<File | null>(null);
  const intake = useMutation({
    mutationFn: async () => {
      let imageArtifactId: string | null = null;
      if (image !== null) {
        const sha256 = await sha256Hex(image);
        const uploaded = await buildWatchApi.uploadArtifact(
          projectId,
          image,
          image.name,
          `a1-image-${sha256}`,
          sha256,
        );
        imageArtifactId = uploaded.artifactId;
      }
      return buildWatchApi.processA1Intake(projectId, {
        requestId: `a1-ui-${crypto.randomUUID()}`,
        referenceDate,
        sourceText: sourceText.trim() || null,
        imageArtifactId,
      });
    },
    onSuccess: async (result) => {
      showToast(`A1 draft ${result.status} төлөвтэй үүслээ`, "success");
      setSourceText("");
      setImage(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });
  return (
    <Card className="mb-6">
      <div className="card-heading">
        <div>
          <p className="eyebrow">A1 LIVE INTAKE</p>
          <h2>Текст / зураг бүтэцлэх</h2>
        </div>
        <Badge tone="purple">OpenAI</Badge>
      </div>
      <div className="form-grid">
        <Field label="Талбайн тэмдэглэл">
          <Textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Ажлын код, quantity, progress, хүн цаг, материал, саадыг бичнэ үү"
          />
        </Field>
        <Field label="Лавлах огноо">
          <Input type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} />
        </Field>
        <Field label="Фото нотолгоо">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setImage(event.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      <Button
        disabled={intake.isPending || (sourceText.trim() === "" && image === null)}
        onClick={() => intake.mutate()}
      >
        {intake.isPending ? "AI бүтэцлэж байна…" : "A1 draft үүсгэх"}
      </Button>
    </Card>
  );
}

function draftTitle(draft: Record<string, unknown>): string {
  const structured = record(draft.structuredData);
  return (
    stringValue(structured.workItemName) ??
    stringValue(structured.workItemCode) ??
    entityString(draft, "requestId", "id")
  );
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "APPROVED") return "success";
  if (["READY_FOR_REVIEW", "NEEDS_CORRECTION"].includes(status)) return "warning";
  if (["FAILED", "REJECTED"].includes(status)) return "danger";
  return "neutral";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function StructuredDraft({ draft }: { draft: Record<string, unknown> }) {
  const structured = record(draft.structuredData);
  const confidence = record(draft.confidence);
  const fieldScores = useMemo(
    () =>
      new Map(
        (Array.isArray(confidence.fields) ? confidence.fields : [])
          .map((entry) => record(entry))
          .map((entry) => [stringValue(entry.field) ?? "", Number(entry.score)]),
      ),
    [confidence.fields],
  );
  const rows = Object.entries(structured).filter(
    ([, value]) => !Array.isArray(value) && (typeof value !== "object" || value === null),
  );
  const overall = Number(confidence.overall);
  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">STRUCTURED DRAFT</p>
          <h2>AI-аас гаргасан талбарууд</h2>
        </div>
        <Badge tone={overall >= 0.8 ? "success" : overall >= 0.6 ? "warning" : "danger"}>
          Confidence {Number.isFinite(overall) ? formatNumber(overall, 2) : "—"}
        </Badge>
      </div>
      <div className="structured-fields">
        {rows.map(([field, value]) => {
          const score = fieldScores.get(field);
          const low = score !== undefined && score < 0.75;
          return (
            <div key={field} className={low ? "low-confidence" : ""}>
              <span>{field}</span>
              <strong>{stringValue(value) ?? "null"}</strong>
              <Badge tone={low ? "warning" : "success"}>
                {score === undefined || !Number.isFinite(score) ? "n/a" : formatNumber(score, 2)}
              </Badge>
            </div>
          );
        })}
      </div>
      <p className="muted">
        Бага итгэлтэй талбар шар өнгөөр ялгарна. Source evidence-гүй утгыг шууд canonical data
        болгохгүй.
      </p>
    </Card>
  );
}

function ValidationPanel({ draft }: { draft: Record<string, unknown> }) {
  const validation = record(draft.validation);
  const issues = Array.isArray(validation.issues) ? validation.issues.map(record) : [];
  const valid = validation.valid === true;
  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">LOGIC VALIDATION</p>
          <h2>Schema ба логик шалгалт</h2>
        </div>
        <Badge tone={valid ? "success" : "danger"}>{valid ? "VALID" : "NEEDS CORRECTION"}</Badge>
      </div>
      <div className="validation-list">
        {issues.length === 0 ? (
          <div className="validation-ok">
            <CheckCircle2 />
            <span>Алдаа, warning илрээгүй.</span>
          </div>
        ) : (
          issues.map((issue, index) => (
            <div key={index}>
              <AlertCircle />
              <div>
                <strong>{stringValue(issue.code) ?? "VALIDATION"}</strong>
                <span>{stringValue(issue.message) ?? JSON.stringify(issue)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
