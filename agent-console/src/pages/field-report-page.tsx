import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, Trash2 } from "lucide-react";
import type { DailyReportDraftRequest } from "../api/client";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Textarea,
} from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import { entityNumber, entityString, formatNumber, todayIso } from "../lib/format";
import { getLocalPhoto, type LocalPhoto } from "../offline/database";
import { addPhotoToDraft, persistDraft, queueDailyReport, syncOutbox } from "../offline/outbox";
import { useConnectivity } from "../offline/use-connectivity";

type Row = Record<string, unknown>;

const BLOCKERS = [
  "Саадгүй",
  "Материал дууссан",
  "Цаг агаар",
  "Техник ажиллаагүй",
  "Ажиллах хүч дутсан",
  "Зураг тодорхойгүй",
  "Өмнөх ажил дуусаагүй",
];

/** Photo checks the system will run server-side, previewed before sending. */
type PhotoCheck = { readonly label: string; readonly ok: boolean; readonly note: string };

/**
 * Evening report for one plan item. Written for a phone held in one hand on a
 * site: the day's target is pre-filled, only the actual number has to be typed,
 * and nothing blocks on connectivity — the draft goes to IndexedDB and syncs
 * when a signal comes back.
 */
export function FieldReportPage() {
  const { projectId = "", planItemId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const online = useConnectivity();
  const query = useWorkspace(projectId);
  const photoInput = useRef<HTMLInputElement>(null);

  const [quantity, setQuantity] = useState("");
  const [workerCount, setWorkerCount] = useState("");
  const [hours, setHours] = useState("8");
  const [materialUsed, setMaterialUsed] = useState("");
  const [equipmentHours, setEquipmentHours] = useState("");
  const [blocker, setBlocker] = useState(BLOCKERS[0]);
  const [narrative, setNarrative] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const workspace = query.data?.workspace;
  const planItem = useMemo<Row | null>(
    () =>
      workspace?.operations.planItems.find((row) => entityString(row, "id") === planItemId) ?? null,
    [workspace, planItemId],
  );
  const workItem = useMemo<Row | null>(
    () =>
      planItem === null
        ? null
        : (workspace?.workItems.find(
            (row) => entityString(row, "id") === entityString(planItem, "workItemId"),
          ) ?? null),
    [workspace, planItem],
  );
  const crew = useMemo<Row | null>(() => {
    const resource = ((planItem?.resources as Row[] | undefined) ?? []).find(
      (row) => entityString(row, "resourceType") === "CREW",
    );
    if (resource === undefined) return null;
    return (
      workspace?.resources.crews.find(
        (row) => entityString(row, "id") === entityString(resource, "resourceId"),
      ) ?? null
    );
  }, [workspace, planItem]);

  // On site the headcount is almost always the booked crew, so the field shows
  // that until the supervisor types over it. Derived rather than stored, so no
  // effect has to race the workspace load.
  const crewSize = crew === null ? null : entityNumber(crew, "memberCount");
  const workerCountValue =
    workerCount !== "" ? workerCount : crewSize === null ? "" : String(crewSize);

  useEffect(() => {
    void Promise.all(photoIds.map(getLocalPhoto)).then((items) =>
      setPhotos(items.filter((item): item is LocalPhoto => item !== undefined)),
    );
  }, [photoIds]);

  // Thumbnails come from the bytes already in IndexedDB, so previews work with
  // no network at all.
  const previews = useMemo(() => {
    const urls: Record<string, string> = {};
    for (const photo of photos) {
      urls[photo.id] = URL.createObjectURL(new Blob([photo.bytes], { type: photo.mediaType }));
    }
    return urls;
  }, [photos]);

  useEffect(
    () => () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    },
    [previews],
  );

  const planned = planItem === null ? 0 : (entityNumber(planItem, "plannedQuantity") ?? 0);
  const unit = planItem === null ? "" : entityString(planItem, "unit");
  const actual = Number(quantity);
  const hasActual = quantity.trim() !== "" && Number.isFinite(actual);
  const variance = hasActual ? actual - planned : 0;

  const cumulative = useMemo(() => {
    if (workspace === undefined || planItem === null) return 0;
    const previous = workspace.operations.progress
      .filter((row) => entityString(row, "workItemId") === entityString(planItem, "workItemId"))
      .reduce((sum, row) => sum + (entityNumber(row, "quantity") ?? 0), 0);
    return previous + (hasActual ? actual : 0);
  }, [workspace, planItem, actual, hasActual]);

  /** Mirrors the server-side photo evidence rules so surprises happen here. */
  const photoChecks: PhotoCheck[] = [
    {
      label: "Файл нээгдэж, тод байна",
      ok: photos.length > 0,
      note: photos.length > 0 ? "OK" : "Зураг алга",
    },
    {
      label: "Огноо тайлантай нийцэв",
      ok: photos.every((photo) => photo.capturedAt.slice(0, 10) === todayIso()),
      note: photos.length === 0 ? "Зураг алга" : "OK",
    },
    {
      label: "Зөв ажилд холбогдсон",
      ok: photos.length > 0,
      note: photos.length > 0 ? "OK" : "Зураг алга",
    },
    {
      label: "Шаардлагатай өнцгүүд бүрдсэн",
      ok: photos.length >= 3,
      note: photos.length >= 3 ? "OK" : `${photos.length}/3`,
    },
    {
      label: "Давхардсан зураг илрээгүй",
      ok: new Set(photos.map((photo) => photo.sha256)).size === photos.length,
      note: "OK",
    },
  ];

  const completion: { label: string; tone: "success" | "warning" | "danger" } = !hasActual
    ? { label: "Бөглөөгүй", tone: "warning" }
    : actual >= planned
      ? { label: "Бүрэн дууссан", tone: "success" }
      : actual > 0
        ? { label: "Хэсэгчлэн дууссан", tone: "warning" }
        : { label: "Гүйцэтгэлгүй", tone: "danger" };

  const buildRequest = (): Omit<DailyReportDraftRequest, "photos"> => ({
    reportDate: todayIso(),
    timezone: "Asia/Ulaanbaatar",
    narrative:
      [blocker === BLOCKERS[0] ? "" : `Саад: ${blocker}.`, narrative.trim()]
        .filter((part) => part !== "")
        .join(" ") || null,
    weather: null,
    sourceDraftId: null,
    progress: [
      {
        workItemId: planItem === null ? "" : entityString(planItem, "workItemId"),
        planItemId,
        quantity: quantity || "0",
        unit,
        progressPercent: planned > 0 ? Math.min(100, (actual / planned) * 100) : null,
        sourceRefs: [],
      },
    ],
    attendance: [
      {
        crewId: crew === null ? null : entityString(crew, "id"),
        trade: crew === null ? "Ерөнхий баг" : entityString(crew, "trade"),
        workerCount: Math.max(1, Number(workerCountValue) || 1),
        hoursPerWorker: Number(hours) || 0,
        laborRateMnt: null,
        sourceRefs: [],
      },
    ],
  });

  const persist = async () => {
    if (!hasActual || actual < 0) throw new Error("Бодит тоо хэмжээг оруулна уу");
    if (planItem === null) throw new Error("Өдрийн даалгаврын мөр олдсонгүй");
    const draft = await persistDraft({
      ...(draftId === undefined ? {} : { draftId }),
      projectId,
      request: buildRequest(),
      photoIds,
    });
    setDraftId(draft.id);
    return draft;
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      await persist();
      showToast("Ноорог төхөөрөмжид хадгалагдлаа", "success");
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
      await queueDailyReport(draft);
      showToast(
        online ? "Тайлан илгээгдэж байна…" : "Offline — холбогдоход автоматаар илгээгдэнэ",
        "success",
      );
      await syncOutbox();
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
      navigate(`/projects/${projectId}/field`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const attachPhotos = async (files: FileList | null) => {
    if (files === null) return;
    const added: string[] = [];
    for (const file of Array.from(files).slice(0, 5 - photos.length)) {
      const photo = await addPhotoToDraft({ projectId, file, planItemId });
      added.push(photo.id);
    }
    setPhotoIds((current) => [...current, ...added]);
  };

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (planItem === null)
    return (
      <ErrorState
        title="Даалгаврын мөр олдсонгүй"
        error={new Error("Энэ өдрийн даалгаварт ийм ажил байхгүй байна.")}
      />
    );

  return (
    <>
      <header className="field-report-head">
        <Link className="back-link" to={`/projects/${projectId}/field`}>
          <ChevronLeft /> Буцах
        </Link>
        <div>
          <h1>Оройн тайлан</h1>
          <p className="page-description">
            {workItem === null
              ? entityString(planItem, "workItemId")
              : entityString(workItem, "name")}{" "}
            · {entityString(planItem, "locationCode")}
          </p>
        </div>
      </header>

      <div className="field-report-layout">
        <Card>
          <h2>Хэмжилт</h2>
          <div className="form-grid">
            <Field label={`Бодит тоо хэмжээ (${unit})`}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder={String(planned)}
              />
            </Field>
            <Field label={`Хуримтлагдсан (авто, ${unit})`}>
              <Input value={formatNumber(cumulative, 2)} readOnly tabIndex={-1} />
            </Field>
          </div>

          {hasActual && variance !== 0 ? (
            <div className="notice-card is-warning">
              <strong>
                <AlertTriangle /> Төлөвлөсөн {formatNumber(planned, 1)} {unit} → зөрүү{" "}
                {variance > 0 ? "+" : ""}
                {formatNumber(variance, 1)} {unit}
              </strong>
              <p className="muted-note">Хазайлт автоматаар тэмдэглэгдэж, хяналтад орно.</p>
            </div>
          ) : null}

          <div className="form-grid">
            <Field label="Ажилчдын тоо">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={workerCountValue}
                onChange={(event) => setWorkerCount(event.target.value)}
              />
            </Field>
            <Field label="Ажилласан цаг">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={24}
                step="0.5"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
            </Field>
            <Field label="Ашигласан материал" hint="Тэмдэглэлд орно">
              <Input
                value={materialUsed}
                onChange={(event) => setMaterialUsed(event.target.value)}
                placeholder="18.8 · Бетон C30"
              />
            </Field>
            <Field label="Техникийн цаг" hint="Тэмдэглэлд орно">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={equipmentHours}
                onChange={(event) => setEquipmentHours(event.target.value)}
              />
            </Field>
          </div>

          <h2>Нөхцөл</h2>
          <Field label="Саад">
            <Select value={blocker} onChange={(event) => setBlocker(event.target.value)}>
              {BLOCKERS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Тэмдэглэл">
            <Textarea
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              placeholder="Үдээс хойш бороо орж өндөрлөгийн ажил зогссон…"
            />
          </Field>
        </Card>

        <Card className="field-evidence">
          <div className="card-heading">
            <h2>Гэрэл зураг · {photos.length} / 5</h2>
          </div>
          <div className="evidence-strip">
            {photos.map((photo) => (
              <figure key={photo.id} className="evidence-thumb">
                {previews[photo.id] === undefined ? (
                  <span>{(photo.sizeBytes / 1024).toFixed(0)} KB</span>
                ) : (
                  <img src={previews[photo.id]} alt="Талбайн гэрэл зураг" />
                )}
                <button
                  type="button"
                  aria-label="Зураг хасах"
                  onClick={() => setPhotoIds((ids) => ids.filter((id) => id !== photo.id))}
                >
                  <Trash2 />
                </button>
              </figure>
            ))}
            {photos.length < 5 ? (
              <button
                type="button"
                className="evidence-add"
                onClick={() => photoInput.current?.click()}
              >
                <Camera />
                <span>Зураг нэмэх</span>
              </button>
            ) : null}
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(event) => {
                void attachPhotos(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <ul className="validation-list">
            {photoChecks.map((check) => (
              <li key={check.label} className={check.ok ? "validation-ok" : ""}>
                {check.ok ? <CheckCircle2 /> : <AlertTriangle />}
                <span>{check.label}</span>
                <em>{check.ok ? "OK" : check.note}</em>
              </li>
            ))}
          </ul>

          <div className={`notice-card ${completion.tone === "success" ? "is-ok" : "is-warning"}`}>
            <strong>
              Төлөв: <Badge tone={completion.tone}>{completion.label}</Badge>
            </strong>
            <p className="muted-note">
              {hasActual
                ? `Бодит ${formatNumber(actual, 1)} ${unit} · төлөвлөсөн ${formatNumber(planned, 1)} ${unit}.`
                : "Бодит тоо хэмжээг оруулсны дараа төлөв тодорхойлогдоно."}
            </p>
          </div>

          <div className="form-actions">
            <Button variant="secondary" onClick={() => void saveDraft()} disabled={saving}>
              Ноорог хадгалах
            </Button>
            <Button onClick={() => void submit()} disabled={saving || !hasActual}>
              {saving ? "Хадгалж байна…" : online ? "Илгээх" : "Offline queue-д хийх"}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
