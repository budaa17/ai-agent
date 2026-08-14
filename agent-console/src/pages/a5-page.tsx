import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  HardHat,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { DailyReportDraftRequest } from "../api/client";
import { DecisionPointer } from "../components/decision-pointer";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeading,
  Select,
  Textarea,
} from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import { entityNumber, entityString, formatDate, formatNumber, todayIso } from "../lib/format";
import {
  getLocalPhoto,
  listOutboxEntries,
  listProjectDrafts,
  removeLocalPhoto,
  type LocalPhoto,
} from "../offline/database";
import {
  addPhotoToDraft,
  persistDraft,
  queueDailyReport,
  retryOutboxEntry,
  syncOutbox,
} from "../offline/outbox";

const tabs = [
  { id: "plan", label: "Өнөөдрийн plan", icon: CalendarCheck },
  { id: "report", label: "Оройн тайлан", icon: ClipboardCheck },
  { id: "verification", label: "Verification", icon: Camera },
] as const;

export const DAILY_REPORT_FLOW_STEPS = ["Ажил", "Гүйцэтгэл", "Хүн/зураг", "Илгээх"] as const;
export const DAILY_REPORT_PRIMARY_TAP_TARGET = 10;

export function estimateDailyReportPrimaryTaps(withPhoto = true): number {
  return 1 + 3 + (withPhoto ? 1 : 0) + 1;
}

type A5Tab = (typeof tabs)[number]["id"];

export function A5Page() {
  const { projectId } = useParams();
  const query = useWorkspace(projectId);
  const [tab, setTab] = useState<A5Tab>("plan");
  if (projectId === undefined) return null;
  if (query.isPending) return <LoadingState label="A5 daily execution ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const workspace = query.data.workspace;
  const canSubmitReport = workspace.permissions.includes("REPORT_SUBMIT");
  return (
    <>
      <PageHeading
        eyebrow="ӨДРИЙН ЯВЦ"
        title="Өдрийн төлөвлөгөө ба гүйцэтгэл"
        description="Төлөвлөгөөний зөрчил, offline тайлан, фото нотолгоо, verification болон rolling forecast."
        actions={
          <Badge tone={navigator.onLine ? "success" : "warning"}>
            {navigator.onLine ? "LIVE" : "OFFLINE"}
          </Badge>
        }
      />
      <div className="tab-list" role="tablist" aria-label="A5 ажлын шат">
        {tabs
          .filter((item) => item.id !== "report" || canSubmitReport)
          .map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              <Icon />
              {item.label}
            </button>
          );
          })}
      </div>
      {tab === "plan" ? <PlanBoard projectId={projectId} workspace={workspace} /> : null}
      {tab === "report" && canSubmitReport ? (
        <DailyReportWizard projectId={projectId} workspace={workspace} />
      ) : null}
      {tab === "verification" ? <VerificationView workspace={workspace} /> : null}
    </>
  );
}

type Workspace = NonNullable<ReturnType<typeof useWorkspace>["data"]>["workspace"];

function PlanBoard({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  const plans = workspace.operations.plans;
  const activePlan =
    plans.find((plan) => entityString(plan, "planDate").slice(0, 10) === todayIso()) ?? plans[0];
  const planId = activePlan === undefined ? null : entityString(activePlan, "id");
  const items = workspace.operations.planItems.filter(
    (item) => planId === null || entityString(item, "planId") === planId,
  );
  const reviews = workspace.reviews.filter(
    (review) => entityString(review, "targetType") === "DAILY_WORK_PLAN",
  );
  return (
    <div className="stack">
      <div className="metric-grid compact">
        <Card className="metric-card">
          <span>Plan date</span>
          <strong>
            {activePlan === undefined ? "—" : formatDate(entityString(activePlan, "planDate"))}
          </strong>
          <small>{entityString(activePlan ?? {}, "status")}</small>
        </Card>
        <Card className="metric-card">
          <span>Plan item</span>
          <strong>{items.length}</strong>
          <small>{items.filter(hasConflict).length} conflict</small>
        </Card>
        <Card className="metric-card">
          <span>Crew</span>
          <strong>{workspace.resources.crews.length}</strong>
          <small>{workspace.resources.equipment.length} equipment</small>
        </Card>
      </div>
      <div className="plan-board">
        {items.length === 0 ? (
          <Card>
            <EmptyState
              title="Өдрийн plan алга"
              description="A5 planning engine ажилласны дараа plan item-ууд энд харагдана."
            />
          </Card>
        ) : (
          items.map((item) => (
            <Card
              key={entityString(item, "id")}
              className={hasConflict(item) ? "plan-item has-conflict" : "plan-item"}
            >
              <div className="plan-sequence">
                {formatNumber(entityNumber(item, "sequence") ?? 0, 0)}
              </div>
              <div className="plan-content">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">{entityString(item, "workItemId")}</p>
                    <h2>{entityString(item, "title", "workItemName", "description")}</h2>
                  </div>
                  {hasConflict(item) ? (
                    <Badge tone="danger">
                      <AlertTriangle /> Conflict
                    </Badge>
                  ) : (
                    <Badge tone="success">
                      <CheckCircle2 /> Ready
                    </Badge>
                  )}
                </div>
                <div className="plan-facts">
                  <span>
                    <HardHat /> {nestedCount(item, "resources")} resource
                  </span>
                  <span>
                    <CloudUpload /> {nestedCount(item, "materials")} material
                  </span>
                  <span>
                    <CheckCircle2 /> {nestedCount(item, "preconditions")} precondition
                  </span>
                </div>
                {hasConflict(item) ? (
                  <p className="conflict-message">
                    Материал, нөөц эсвэл precondition бүрэн хангагдаагүй. Батлахаас өмнө шалтгааныг
                    шалгана уу.
                  </p>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </div>
      <DecisionPointer
        projectId={projectId}
        reviews={reviews}
        targetTypes={["DAILY_WORK_PLAN"]}
        label="өдрийн даалгаврын шийдвэр хүлээгдэж байна"
      />
    </div>
  );
}

function nestedCount(entity: Record<string, unknown>, key: string): number {
  return Array.isArray(entity[key]) ? entity[key].length : 0;
}

function hasConflict(item: Record<string, unknown>): boolean {
  if (["BLOCKED", "CONFLICT"].includes(entityString(item, "status", "readiness"))) return true;
  for (const key of ["materials", "resources", "preconditions"]) {
    const records = Array.isArray(item[key]) ? (item[key] as Record<string, unknown>[]) : [];
    if (
      records.some(
        (record) =>
          record.satisfied === false ||
          record.available === false ||
          record.status === "SHORTAGE" ||
          record.status === "BLOCKED",
      )
    )
      return true;
  }
  return false;
}

function DailyReportWizard({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const photoInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [tapCount, setTapCount] = useState(0);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [reportDate, setReportDate] = useState(todayIso());
  const [workItemId, setWorkItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("м3");
  const [progressPercent, setProgressPercent] = useState("");
  const [trade, setTrade] = useState("Ерөнхий баг");
  const [workerCount, setWorkerCount] = useState("1");
  const [hours, setHours] = useState("8");
  const [narrative, setNarrative] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const selectedPlanItem = workspace.operations.planItems.find(
    (item) => entityString(item, "workItemId") === workItemId,
  );

  const refreshQueue = () => setQueueVersion((value) => value + 1);
  useEffect(() => {
    void Promise.all(photoIds.map(getLocalPhoto)).then((items) =>
      setPhotos(items.filter((item): item is LocalPhoto => item !== undefined)),
    );
  }, [photoIds]);

  const request = (): Omit<DailyReportDraftRequest, "photos"> => ({
    reportDate,
    timezone: "Asia/Ulaanbaatar",
    narrative: narrative.trim() || null,
    weather: null,
    sourceDraftId: null,
    progress: [
      {
        workItemId,
        planItemId: selectedPlanItem === undefined ? null : entityString(selectedPlanItem, "id"),
        quantity: quantity || "0",
        unit,
        progressPercent: progressPercent === "" ? null : Number(progressPercent),
        sourceRefs: [],
      },
    ],
    attendance: [
      {
        crewId: null,
        trade,
        workerCount: Number(workerCount),
        hoursPerWorker: Number(hours),
        laborRateMnt: null,
        sourceRefs: [],
      },
    ],
  });

  const persist = async () => {
    if (workItemId === "" || Number(quantity) < 0 || unit.trim() === "")
      throw new Error("Ажил, quantity, unit талбарыг шалгана уу");
    const draft = await persistDraft({
      ...(draftId === undefined ? {} : { draftId }),
      projectId,
      request: request(),
      photoIds,
    });
    setDraftId(draft.id);
    return draft;
  };

  const save = async () => {
    setSaving(true);
    try {
      await persist();
      showToast("Draft төхөөрөмжийн IndexedDB-д хадгалагдлаа", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const draft = await persist();
      const entry = await queueDailyReport(draft);
      showToast(
        navigator.onLine
          ? "Тайлан queue-д орж sync эхэллээ"
          : "Offline тайлан алдалгүй queue-д хадгалагдлаа",
        "success",
      );
      await syncOutbox();
      const current = (await listOutboxEntries(projectId)).find(
        (candidate) => candidate.id === entry.id,
      );
      if (current?.status === "SENT") {
        showToast("Тайлан backend-д REVIEW_REQUIRED төлөвтэй хүрлээ", "success");
        await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
      }
      refreshQueue();
      setTapCount((value) => value + 1);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const advance = () => {
    if (step === 1 && workItemId === "") {
      showToast("Ажил сонгоно уу", "error");
      return;
    }
    if (step === 2 && (quantity === "" || Number(quantity) < 0)) {
      showToast("Quantity оруулна уу", "error");
      return;
    }
    setStep((value) => Math.min(4, value + 1));
    setTapCount((value) => value + 1);
  };

  const addFiles = async (files: FileList | null) => {
    if (files === null) return;
    const accepted = [...files].slice(0, 5 - photoIds.length);
    const stored: string[] = [];
    for (const file of accepted) {
      if (!file.type.startsWith("image/")) continue;
      const photo = await addPhotoToDraft({
        projectId,
        file,
        planItemId: selectedPlanItem === undefined ? null : entityString(selectedPlanItem, "id"),
      });
      stored.push(photo.id);
    }
    setPhotoIds((current) => [...current, ...stored]);
    setTapCount((value) => value + 1);
  };

  return (
    <div className="stack">
      <div className="wizard-progress" aria-label={`Алхам ${step} / 4`}>
        {DAILY_REPORT_FLOW_STEPS.map((label, index) => (
          <div key={label} className={step >= index + 1 ? "active" : ""}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>
      <div className="wizard-layout">
        <Card className="wizard-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">MOBILE DAILY FLOW</p>
              <h2>
                {step === 1
                  ? "Ажил сонгох"
                  : step === 2
                    ? "Гүйцэтгэл оруулах"
                    : step === 3
                      ? "Хүн ба нотолгоо"
                      : "Хянаж илгээх"}
              </h2>
            </div>
            <Badge tone={tapCount <= DAILY_REPORT_PRIMARY_TAP_TARGET ? "success" : "danger"}>
              {tapCount} / {DAILY_REPORT_PRIMARY_TAP_TARGET} tap
            </Badge>
          </div>
          {step === 1 ? (
            <div className="form-grid">
              <Field label="Тайлангийн огноо">
                <Input
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                />
              </Field>
              <Field label="Work item">
                <Select
                  value={workItemId}
                  onChange={(event) => {
                    setWorkItemId(event.target.value);
                    setTapCount((value) => value + 1);
                  }}
                >
                  <option value="">Ажил сонгох</option>
                  {workspace.workItems.map((item) => (
                    <option key={entityString(item, "id")} value={entityString(item, "id")}>
                      {entityString(item, "code")} · {entityString(item, "name")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="form-grid">
              <Field label="Өнөөдрийн quantity">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>
              <Field label="Нэгж">
                <Input value={unit} onChange={(event) => setUnit(event.target.value)} />
              </Field>
              <Field label="Нийт progress %">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={progressPercent}
                  onChange={(event) => setProgressPercent(event.target.value)}
                />
              </Field>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="stack">
              <div className="form-grid">
                <Field label="Баг / мэргэжил">
                  <Input value={trade} onChange={(event) => setTrade(event.target.value)} />
                </Field>
                <Field label="Хүний тоо">
                  <Input
                    type="number"
                    min="1"
                    value={workerCount}
                    onChange={(event) => setWorkerCount(event.target.value)}
                  />
                </Field>
                <Field label="Нэг хүний цаг">
                  <Input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={hours}
                    onChange={(event) => setHours(event.target.value)}
                  />
                </Field>
                <Field label="Тайлбар">
                  <Textarea
                    value={narrative}
                    onChange={(event) => setNarrative(event.target.value)}
                    placeholder="Саад, материал, хийсэн ажлын тэмдэглэл"
                  />
                </Field>
              </div>
              <button
                className="photo-capture"
                type="button"
                onClick={() => photoInput.current?.click()}
                disabled={photoIds.length >= 5}
              >
                <Camera />
                <strong>1–5 зураг авах / сонгох</strong>
                <span>{photoIds.length}/5 offline хадгалсан</span>
              </button>
              <input
                ref={photoInput}
                className="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(event) => {
                  void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <div className="photo-strip">
                {photos.map((photo) => (
                  <div key={photo.id}>
                    <img
                      src={URL.createObjectURL(new Blob([photo.bytes], { type: photo.mediaType }))}
                      alt={photo.fileName}
                    />
                    <button
                      type="button"
                      aria-label={`${photo.fileName} устгах`}
                      onClick={() => {
                        void removeLocalPhoto(photo.id);
                        setPhotoIds((ids) => ids.filter((id) => id !== photo.id));
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="review-summary">
              <SummaryRow label="Огноо" value={reportDate} />
              <SummaryRow
                label="Ажил"
                value={entityString(
                  workspace.workItems.find((item) => entityString(item, "id") === workItemId) ?? {},
                  "name",
                )}
              />
              <SummaryRow label="Quantity" value={`${quantity} ${unit}`} />
              <SummaryRow
                label="Progress"
                value={progressPercent === "" ? "—" : `${progressPercent}%`}
              />
              <SummaryRow label="Ирц" value={`${workerCount} хүн × ${hours} цаг`} />
              <SummaryRow label="Зураг" value={`${photoIds.length}`} />
              <p>
                Илгээсний дараа шууд approved болохгүй. Backend-д <strong>REVIEW_REQUIRED</strong>{" "}
                draft үүснэ.
              </p>
            </div>
          ) : null}
          <div className="wizard-actions">
            <Button
              variant="ghost"
              disabled={step === 1 || saving}
              onClick={() => setStep((value) => Math.max(1, value - 1))}
            >
              Өмнөх
            </Button>
            <Button
              variant="secondary"
              disabled={saving || workItemId === ""}
              onClick={() => void save()}
            >
              {saving ? "Хадгалж байна…" : "Draft хадгалах"}
            </Button>
            {step < 4 ? (
              <Button onClick={advance}>Дараах</Button>
            ) : (
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? "Sync хийж байна…" : navigator.onLine ? "Илгээх" : "Offline queue-д хийх"}
              </Button>
            )}
          </div>
        </Card>
        <OutboxPanel projectId={projectId} version={queueVersion} onChange={refreshQueue} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OutboxPanel({
  projectId,
  version,
  onChange,
}: {
  projectId: string;
  version: number;
  onChange: () => void;
}) {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof listOutboxEntries>>>([]);
  const [draftCount, setDraftCount] = useState(0);
  useEffect(() => {
    void Promise.all([listOutboxEntries(projectId), listProjectDrafts(projectId)]).then(
      ([nextEntries, drafts]) => {
        setEntries(nextEntries);
        setDraftCount(drafts.length);
      },
    );
  }, [projectId, version]);
  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">OFFLINE OUTBOX</p>
          <h2>Sync төлөв</h2>
        </div>
        <Badge tone="info">{draftCount} draft</Badge>
      </div>
      <div className="outbox-list">
        {entries.length === 0 ? (
          <p className="muted">Queue хоосон.</p>
        ) : (
          entries
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className={`outbox-item status-${entry.status.toLowerCase()}`}>
                <div>
                  <strong>{entry.request.reportDate}</strong>
                  <span>
                    {entry.status} · оролдлого {entry.attemptCount}
                  </span>
                  {entry.lastError !== null ? <small>{entry.lastError}</small> : null}
                </div>
                {["RETRY", "CONFLICT"].includes(entry.status) ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void retryOutboxEntry(entry.id, entry.status === "CONFLICT").then(onChange)
                    }
                  >
                    <RefreshCcw /> Retry
                  </Button>
                ) : (
                  <Badge
                    tone={
                      entry.status === "SENT"
                        ? "success"
                        : entry.status === "CONFLICT"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {entry.status}
                  </Badge>
                )}
              </div>
            ))
        )}
      </div>
    </Card>
  );
}

function VerificationView({ workspace }: { workspace: Workspace }) {
  const latest = workspace.operations.verifications[0];
  const relatedPhotos = workspace.operations.photos.slice(0, 6);
  return (
    <div className="stack">
      <div className="metric-grid compact">
        <Card className="metric-card">
          <span>Verification</span>
          <strong>{workspace.operations.verifications.length}</strong>
          <small>{entityString(latest ?? {}, "status")}</small>
        </Card>
        <Card className="metric-card">
          <span>Variance</span>
          <strong>{workspace.operations.variances.length}</strong>
          <small>Plan vs actual</small>
        </Card>
        <Card className="metric-card">
          <span>Photo evidence</span>
          <strong>{workspace.operations.photos.length}</strong>
          <small>Metadata + links</small>
        </Card>
      </div>
      <div className="split-grid">
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">SOURCE COMPARISON</p>
              <h2>Before / after / source</h2>
            </div>
            <Camera />
          </div>
          <div className="comparison-grid">
            {relatedPhotos.map((photo, index) => (
              <div key={entityString(photo, "id")} className="comparison-tile">
                <span>{index % 2 === 0 ? "BEFORE" : "AFTER"}</span>
                <div className="photo-placeholder">
                  <Camera />
                </div>
                <strong>{formatDate(entityString(photo, "capturedAt"))}</strong>
                <small>{entityString(photo, "quality.status", "status")}</small>
              </div>
            ))}
            {relatedPhotos.length === 0 ? (
              <EmptyState
                title="Фото нотолгоо алга"
                description="A5 тайлангаар зураг ирсний дараа харьцуулалт үүснэ."
              />
            ) : null}
          </div>
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">VERIFICATION ISSUES</p>
              <h2>Зөрчил ба хориг</h2>
            </div>
          </div>
          <DataTable
            headers={["Date", "Status", "Verified %", "Source hash"]}
            rows={workspace.operations.verifications.map((verification) => [
              formatDate(entityString(verification, "verificationDate")),
              <Badge
                key="status"
                tone={entityString(verification, "status") === "APPROVED" ? "success" : "warning"}
              >
                {entityString(verification, "status")}
              </Badge>,
              `${formatNumber(entityNumber(verification, "verifiedProgressPercent"))}%`,
              entityString(verification, "sourceHash").slice(0, 12),
            ])}
          />
        </Card>
      </div>
    </div>
  );
}
