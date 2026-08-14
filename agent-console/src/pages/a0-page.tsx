import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Calculator,
  FileSpreadsheet,
  FileUp,
  GitBranch,
  Layers3,
  Maximize2,
  Ruler,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  artifactUploadSizeError,
  buildWatchApi,
  sha256Hex,
  type A0ArtifactRole,
} from "../api/client";
import { DecisionPointer } from "../components/decision-pointer";
import { VersionCompare } from "../components/version-compare";
import { useToast } from "../components/toast";
import { artifactUploadIdempotencyKey } from "../lib/artifact-idempotency";
import { friendlyError } from "../lib/api-error";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
} from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import {
  entityBoolean,
  entityNumber,
  entityString,
  formatDate,
  formatMoney,
  formatNumber,
  todayIso,
} from "../lib/format";

const tabs = [
  { id: "intake", label: "Файл ба revision", icon: FileUp },
  { id: "drawing", label: "Зураг ба source", icon: Layers3 },
  { id: "quantity", label: "Quantity", icon: Ruler },
  { id: "estimate", label: "Estimate", icon: Calculator },
  { id: "wbs", label: "WBS / dependency", icon: GitBranch },
  { id: "schedule", label: "Gantt", icon: Maximize2 },
  { id: "baseline", label: "Baseline approval", icon: Boxes },
] as const;

type A0Tab = (typeof tabs)[number]["id"];

export function A0Page() {
  const { projectId } = useParams();
  const query = useWorkspace(projectId);
  const [tab, setTab] = useState<A0Tab>("intake");
  if (projectId === undefined) return null;
  if (query.isPending) return <LoadingState label="A0 workspace ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const workspace = query.data.workspace;
  return (
    <>
      <PageHeading
        eyebrow="ЗУРАГ ТӨСӨЛ БА ТӨСӨВ"
        title="Зураг → quantity → estimate → schedule"
        description="AI/детерминистик үр дүн бүр эх сурвалжтай харагдаж, baseline болохоос өмнө хүний review шаарддаг."
        actions={<Badge tone="info">{workspace.design.documents.length} document</Badge>}
      />
      <div className="tab-list" role="tablist" aria-label="A0 ажлын шат">
        {tabs.map((item) => {
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
      {tab === "intake" ? <IntakeTab projectId={projectId} workspace={workspace} /> : null}
      {tab === "drawing" ? <DrawingTab workspace={workspace} /> : null}
      {tab === "quantity" ? <QuantityTab workspace={workspace} /> : null}
      {tab === "estimate" ? <EstimateTab workspace={workspace} /> : null}
      {tab === "wbs" ? <WbsTab workspace={workspace} /> : null}
      {tab === "schedule" ? <ScheduleTab workspace={workspace} /> : null}
      {tab === "baseline" ? <BaselineTab projectId={projectId} workspace={workspace} /> : null}
    </>
  );
}

type Workspace = ReturnType<typeof useWorkspace>["data"] extends infer Result
  ? Result extends { workspace: infer Value }
    ? Value
    : never
  : never;

const a0RoleOptions: readonly { value: A0ArtifactRole; label: string }[] = [
  { value: "MATERIAL_PRICE_CATALOG", label: "Материалын үнийн каталог" },
  { value: "MATERIAL_NORMS", label: "Материалын норм" },
  { value: "BOQ_WORK_ITEMS", label: "BOQ / ажлын тоо хэмжээ" },
  { value: "WBS_DEPENDENCIES", label: "WBS ба dependency" },
  { value: "DRAWING_REFERENCE", label: "Зураг / PDF эх сурвалж" },
];

function detectA0Role(fileName: string, mediaType: string): A0ArtifactRole | "IGNORE" {
  const normalized = fileName.toLowerCase();
  if (mediaType.startsWith("image/") || mediaType === "application/pdf") {
    return "DRAWING_REFERENCE";
  }
  if (/price|үнэ/u.test(normalized)) return "MATERIAL_PRICE_CATALOG";
  if (/norm|норм/u.test(normalized)) return "MATERIAL_NORMS";
  if (/boq|quantity|тоо.?хэмжээ/u.test(normalized)) return "BOQ_WORK_ITEMS";
  if (/wbs|depend|schedule|хамаарал/u.test(normalized)) return "WBS_DEPENDENCIES";
  return "IGNORE";
}

export function a0IntakeFailureMessage(error: unknown): string {
  const friendly = friendlyError(error);
  const raw = friendly.message;
  if (
    raw.includes("supported A0 sheet") ||
    raw.includes("Required sheet") ||
    raw.includes("Workbook sheet count")
  ) {
    return "Сонгосон XLSX нь BuildWatch A0 загварт тохирохгүй байна. Үүрэг тус бүрийн workbook sheet яг Price_Catalog, Material_Norms, BOQ, WBS нэртэй бөгөөд шаардлагатай баганатай байх ёстой. PDF/зураг нь зөвхөн DRAWING_REFERENCE болно.";
  }
  if (raw.includes("must be an XLSX workbook")) {
    return "Материалын үнэ, норм, BOQ болон WBS үүрэгт зөвхөн BuildWatch загварын XLSX сонгоно. PDF/зурагт DRAWING_REFERENCE үүрэг онооно.";
  }
  if (raw.includes("Required column")) {
    return `XLSX загварын шаардлагатай багана дутуу байна. ${raw}`;
  }
  return `${friendly.title}. ${raw}`;
}

function IntakeTab({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  const canUpload = workspace.permissions.includes("ARTIFACT_UPLOAD");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerName, setViewerName] = useState<string | null>(null);
  const [viewerArtifactId, setViewerArtifactId] = useState<string | null>(null);
  const [viewerExpiresAt, setViewerExpiresAt] = useState<string | null>(null);
  const [artifactRoles, setArtifactRoles] = useState<Record<string, A0ArtifactRole | "IGNORE">>({});
  const [effectiveDate, setEffectiveDate] = useState(workspace.project.plannedStart.slice(0, 10));
  const [revisionCode, setRevisionCode] = useState("R0");
  const [lastResult, setLastResult] = useState<Awaited<
    ReturnType<typeof buildWatchApi.processA0Intake>
  > | null>(null);
  useEffect(() => {
    setArtifactRoles((current) => {
      const next = { ...current };
      workspace.artifacts.forEach((artifact) => {
        const id = entityString(artifact, "id");
        if (next[id] === undefined) {
          next[id] = detectA0Role(
            entityString(artifact, "originalFileName"),
            entityString(artifact, "mediaType"),
          );
        }
      });
      return next;
    });
  }, [workspace.artifacts]);
  // A ticking clock keeps the expiry check pure at render time; reading the
  // wall clock while rendering is what the compiler forbids.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const viewerExpired =
    viewerExpiresAt !== null && clock > 0 && Date.parse(viewerExpiresAt) - 5_000 <= clock;
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const sizeError = artifactUploadSizeError(file.size);
      if (sizeError !== null) throw new Error(sizeError);
      const sha256 = await sha256Hex(file);
      return buildWatchApi.uploadArtifact(
        projectId,
        file,
        file.name,
        artifactUploadIdempotencyKey(projectId, sha256),
        sha256,
      );
    },
    onSuccess: async () => {
      showToast("Файл object storage болон asset registry-д хадгалагдлаа", "success");
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(a0IntakeFailureMessage(error), "error"),
  });
  const processIntake = useMutation({
    mutationFn: async () => {
      const artifacts = workspace.artifacts.flatMap((artifact) => {
        const artifactId = entityString(artifact, "id");
        const role = artifactRoles[artifactId] ?? "IGNORE";
        return role === "IGNORE" ? [] : [{ artifactId, role }];
      });
      const canonical = JSON.stringify({ projectId, effectiveDate, revisionCode, artifacts });
      const digest = await sha256Hex(new Blob([canonical], { type: "application/json" }));
      return buildWatchApi.processA0Intake(
        projectId,
        {
          schemaVersion: 1,
          requestId: `a0-${digest.slice(0, 24)}`,
          revisionCode,
          effectiveDate,
          artifacts,
        },
        `a0-intake-${digest}`,
      );
    },
    onSuccess: async (result) => {
      setLastResult(result);
      showToast("A0 quantity, estimate, CPM schedule, baseline review draft үүслээ", "success");
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });
  const selectedRoles = Object.values(artifactRoles).filter((role) => role !== "IGNORE");
  const requiredRoles: readonly A0ArtifactRole[] = [
    "MATERIAL_PRICE_CATALOG",
    "MATERIAL_NORMS",
    "BOQ_WORK_ITEMS",
    "WBS_DEPENDENCIES",
  ];
  const packageReady = requiredRoles.every(
    (role) => selectedRoles.filter((selected) => selected === role).length === 1,
  );
  const openArtifact = async (artifact: Record<string, unknown>) => {
    const artifactId = entityString(artifact, "id");
    const signed = await buildWatchApi.signedArtifactUrl(projectId, artifactId);
    setViewerUrl(signed.url);
    setViewerName(entityString(artifact, "originalFileName"));
    setViewerArtifactId(artifactId);
    // Signed links live 5 minutes. Rather than let the frame silently 403,
    // the viewer retires a moment early and offers to mint a fresh one.
    setViewerExpiresAt(signed.expiresAt);
  };

  const reopenArtifact = async () => {
    if (viewerArtifactId === null) return;
    const artifact = workspace.artifacts.find(
      (candidate) => entityString(candidate, "id") === viewerArtifactId,
    );
    if (artifact !== undefined) await openArtifact(artifact);
  };
  return (
    <div className="split-grid">
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">UPLOAD</p>
            <h2>Зураг, Excel, PDF оруулах</h2>
          </div>
          <FileSpreadsheet />
        </div>
        <button
          className="dropzone"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending || !canUpload}
        >
          <FileUp />
          <strong>
            {!canUpload
              ? "Файл оруулах эрхгүй"
              : upload.isPending
                ? "Checksum ба upload хийж байна…"
                : "Файл сонгох"}
          </strong>
          <span>DWG, PDF, XLSX, JPEG, PNG, WebP · ≤100 MiB</span>
        </button>
        {canUpload ? (
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".dwg,.pdf,.xlsx,.jpg,.jpeg,.png,.webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) upload.mutate(file);
              event.target.value = "";
            }}
          />
        ) : null}
        <div className="artifact-list a0-artifact-list">
          {workspace.artifacts.map((artifact) => (
            <div className="a0-artifact-row" key={entityString(artifact, "id")}>
              <button type="button" onClick={() => void openArtifact(artifact)}>
                <FileSpreadsheet />
                <div>
                  <strong>{entityString(artifact, "originalFileName")}</strong>
                  <span>
                    {entityString(artifact, "mediaType")} ·{" "}
                    {formatNumber(entityNumber(artifact, "sizeBytes"), 0)} byte
                  </span>
                </div>
                <Badge tone="success">{entityString(artifact, "status")}</Badge>
              </button>
              <label>
                <span>Тооцоонд ашиглах үүрэг</span>
                <select
                  disabled={!canUpload}
                  value={artifactRoles[entityString(artifact, "id")] ?? "IGNORE"}
                  onChange={(event) =>
                    setArtifactRoles((current) => ({
                      ...current,
                      [entityString(artifact, "id")]: event.target.value as
                        A0ArtifactRole | "IGNORE",
                    }))
                  }
                >
                  <option value="IGNORE">Энэ багцад ашиглахгүй</option>
                  {a0RoleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          {workspace.artifacts.length === 0 ? (
            <p className="muted">Оруулсан artifact алга.</p>
          ) : null}
        </div>
        <div className="a0-process-panel">
          <div className="form-note" role="note">
            <strong>A0 боловсруулах structured багц</strong>
            <span>
              PDF/зураг нь зөвхөн эх сурвалж. Тооцоо үүсгэхийн тулд sheet нь яг
              <code>Price_Catalog</code>, <code>Material_Norms</code>, <code>BOQ</code>,
              <code>WBS</code> нэртэй дөрвөн BuildWatch XLSX шаардлагатай.
            </span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Хүчин төгөлдөр огноо</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Revision код</span>
              <input
                value={revisionCode}
                maxLength={100}
                pattern="[A-Za-z0-9._]+(?:-[A-Za-z0-9._]+)*"
                onChange={(event) => setRevisionCode(event.target.value)}
              />
            </label>
          </div>
          <div className="a0-readiness">
            {requiredRoles.map((role) => {
              const count = selectedRoles.filter((selected) => selected === role).length;
              return (
                <span key={role} className={count === 1 ? "ready" : "missing"}>
                  {count === 1 ? "✓" : "!"}{" "}
                  {a0RoleOptions.find((item) => item.value === role)?.label}
                </span>
              );
            })}
          </div>
          <Button
            disabled={
              !packageReady ||
              !canUpload ||
              revisionCode.trim().length === 0 ||
              effectiveDate.length === 0 ||
              processIntake.isPending
            }
            onClick={() => processIntake.mutate()}
          >
            {processIntake.isPending
              ? "Workbook шалгаж, CPM бодож байна…"
              : "A0 багцыг боловсруулж review draft үүсгэх"}
          </Button>
          <p className="muted">
            Upload нь зөвхөн файл хадгална. Энэ үйлдэл formula-г дахин бодож, source-той draft
            үүсгэнэ; автоматаар baseline батлахгүй.
          </p>
          {lastResult !== null ? (
            <div className="a0-result-summary">
              <Badge tone="warning">{lastResult.status}</Badge>
              <strong>{formatMoney(Number(lastResult.estimateTotalMnt))}</strong>
              <span>
                {lastResult.counts.quantityItems} quantity ·{" "}
                {lastResult.counts.materialRequirements} material ·{" "}
                {lastResult.counts.scheduleActivities} activity
              </span>
              <span>
                CPM: {lastResult.plannedStart} → {lastResult.plannedFinish}
              </span>
              {lastResult.warnings.map((warning) => (
                <small key={warning}>{warning}</small>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
      <Card className="viewer-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">SIGNED VIEWER</p>
            <h2>{viewerName ?? "PDF / artifact preview"}</h2>
          </div>
          <Badge tone="neutral">5 минутын URL</Badge>
        </div>
        {viewerUrl === null ? (
          <EmptyState
            title="Artifact сонгоно уу"
            description="Файлын мөр дээр дарж богино настай signed URL-аар нээнэ."
          />
        ) : viewerExpired ? (
          <EmptyState
            title="Холбоосын хугацаа дууслаа"
            description="Аюулгүй байдлын үүднээс файлын холбоос 5 минутын настай. Дахин нээнэ үү."
            action={<Button onClick={() => void reopenArtifact()}>Дахин нээх</Button>}
          />
        ) : (
          <iframe title={viewerName ?? "Artifact"} src={viewerUrl} className="artifact-viewer" />
        )}
      </Card>
    </div>
  );
}

function DrawingTab({ workspace }: { workspace: Workspace }) {
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const selected =
    workspace.design.elements.find(
      (element) => entityString(element, "id") === selectedElementId,
    ) ?? workspace.design.elements[0];
  return (
    <div className="split-grid">
      <Card className="drawing-canvas-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">DRAWING SOURCE</p>
            <h2>Element ба эх сурвалж</h2>
          </div>
          <Badge tone="info">{workspace.design.elements.length} element</Badge>
        </div>
        <div className="drawing-canvas">
          <div className="drawing-sheet">
            <span className="axis axis-x">A — B — C — D</span>
            <span className="axis axis-y">
              1<br />2<br />3<br />4
            </span>
            {workspace.design.elements.slice(0, 12).map((element, index) => (
              <button
                key={entityString(element, "id")}
                type="button"
                className={
                  entityString(element, "id") === entityString(selected ?? {}, "id")
                    ? "selected"
                    : ""
                }
                style={{
                  left: `${12 + (index % 4) * 20}%`,
                  top: `${18 + Math.floor(index / 4) * 23}%`,
                }}
                onClick={() => setSelectedElementId(entityString(element, "id"))}
                aria-label={entityString(element, "elementCode", "elementType", "id")}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
        <div className="source-detail">
          <Ruler />
          <div>
            <strong>
              {selected === undefined
                ? "Element сонгоно уу"
                : entityString(selected, "elementCode", "elementType")}
            </strong>
            <span>
              Page: {selected === undefined ? "—" : entityString(selected, "pageId")} · Confidence:{" "}
              {selected === undefined
                ? "—"
                : formatNumber(entityNumber(selected, "confidence") ?? 0, 2)}
            </span>
          </div>
        </div>
      </Card>
      <div className="stack">
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">REVISION REGISTER</p>
              <h2>Баримт ба revision</h2>
            </div>
          </div>
          <DataTable
            headers={["Document", "Revision", "Status", "Огноо"]}
            rows={workspace.design.revisions.map((revision) => [
              entityString(revision, "documentId"),
              entityString(revision, "revisionNumber", "revisionCode"),
              <Badge key="status" tone="neutral">
                {entityString(revision, "status")}
              </Badge>,
              formatDate(entityString(revision, "createdAt")),
            ])}
          />
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">SCALE CALIBRATION</p>
              <h2>Масштабын нотолгоо</h2>
            </div>
          </div>
          <DataTable
            headers={["Page", "Ratio", "Status", "Confidence"]}
            rows={workspace.design.scales.map((scale) => [
              entityString(scale, "pageId"),
              entityString(scale, "scaleText", "scaleRatio", "denominator"),
              <Badge
                key="status"
                tone={entityString(scale, "status") === "CONFIRMED" ? "success" : "warning"}
              >
                {entityString(scale, "status")}
              </Badge>,
              formatNumber(entityNumber(scale, "confidence") ?? 0, 2),
            ])}
          />
        </Card>
      </div>
    </div>
  );
}

function QuantityTab({ workspace }: { workspace: Workspace }) {
  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">QUANTITY TAKEOFF</p>
          <h2>Тоо хэмжээ ба source trace</h2>
        </div>
        <Badge tone="purple">{workspace.commercial.quantityVersions.length} version</Badge>
      </div>
      <DataTable
        headers={["Work code", "Тайлбар", "Quantity", "Unit", "Method", "Confidence"]}
        rows={workspace.commercial.quantityItems.map((item) => [
          entityString(item, "workCode", "lineCode"),
          entityString(item, "description", "name"),
          formatNumber(entityNumber(item, "quantity", "normalizedQuantity")),
          entityString(item, "unit"),
          entityString(item, "formulaCode", "calculationMethod", "method"),
          <Badge
            key="confidence"
            tone={entityString(item, "verificationStatus") === "VERIFIED" ? "success" : "warning"}
          >
            {entityString(item, "verificationStatus")}
          </Badge>,
        ])}
        empty="Quantity takeoff үүсээгүй"
      />
    </Card>
  );
}

function EstimateTab({ workspace }: { workspace: Workspace }) {
  const total = workspace.commercial.estimateLines.reduce(
    (sum, line) => sum + (entityNumber(line, "lineTotal", "totalCost", "amount") ?? 0),
    0,
  );
  const materialRequirements = workspace.commercial.estimateAssumptions.flatMap((assumption) => {
    if (entityString(assumption, "assumptionCode") !== "MATERIAL_REQUIREMENTS") return [];
    return Array.isArray(assumption.value)
      ? assumption.value.filter(
          (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
        )
      : [];
  });
  return (
    <div className="stack">
      <div className="metric-grid compact">
        <Card className="metric-card">
          <span>Estimate version</span>
          <strong>{workspace.commercial.estimateVersions.length}</strong>
          <small>Норм/үнийн mapping</small>
        </Card>
        <Card className="metric-card">
          <span>Нийт estimate</span>
          <strong>{formatMoney(total)}</strong>
          <small>{workspace.commercial.estimateLines.length} мөр</small>
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">NORM & PRICE</p>
            <h2>Estimate review</h2>
          </div>
        </div>
        <DataTable
          headers={["Line", "Ажил", "Норм", "Quantity", "Unit price", "Total"]}
          rows={workspace.commercial.estimateLines.map((line) => [
            entityString(line, "lineCode"),
            entityString(line, "description", "workName"),
            entityString(line, "normCode", "priceCode"),
            `${formatNumber(entityNumber(line, "quantity"))} ${entityString(line, "unit")}`,
            formatMoney(entityNumber(line, "unitPrice", "unitRate")),
            formatMoney(entityNumber(line, "lineTotal", "totalCost", "amount")),
          ])}
          empty="Estimate line үүсээгүй"
        />
      </Card>
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">MATERIAL BREAKDOWN</p>
            <h2>Норм × quantity × үнэ</h2>
          </div>
          <Badge tone="info">{materialRequirements.length}</Badge>
        </div>
        <DataTable
          headers={["BOQ", "Material", "Norm", "Required", "Unit price", "Amount"]}
          rows={materialRequirements.map((line) => [
            entityString(line, "boqCode"),
            `${entityString(line, "materialCode")} · ${entityString(line, "materialName")}`,
            entityString(line, "normCode"),
            `${formatNumber(entityNumber(line, "quantity"))} ${entityString(line, "unit")}`,
            formatMoney(entityNumber(line, "unitPriceMnt")),
            formatMoney(entityNumber(line, "amountMnt")),
          ])}
          empty="Материалын норм/үнийн задаргаа үүсээгүй"
        />
      </Card>
    </div>
  );
}

function WbsTab({ workspace }: { workspace: Workspace }) {
  const workItems =
    workspace.workItems.length > 0 ? workspace.workItems : workspace.schedule.activities;
  const dependencies =
    workspace.dependencies.length > 0 ? workspace.dependencies : workspace.schedule.dependencies;
  const activityCodeById = new Map(
    workspace.schedule.activities.map((activity) => [
      entityString(activity, "id"),
      entityString(activity, "code"),
    ]),
  );
  return (
    <div className="split-grid">
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">WBS</p>
            <h2>Ажлын бүтэц</h2>
          </div>
          <Badge tone="info">{workItems.length}</Badge>
        </div>
        <div className="wbs-tree">
          {workItems.map((item) => (
            <div
              key={entityString(item, "id")}
              className={entityBoolean(item, "isCritical") ? "critical" : ""}
            >
              <span>{entityString(item, "code")}</span>
              <strong>{entityString(item, "name")}</strong>
              <small>
                {entityString(item, "status")} ·{" "}
                {formatNumber(entityNumber(item, "progressPercent"))}%
              </small>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">DEPENDENCIES</p>
            <h2>Хамаарлын graph</h2>
          </div>
          <GitBranch />
        </div>
        <DataTable
          headers={["Predecessor", "Төрөл", "Successor", "Lag"]}
          rows={dependencies.map((dependency) => [
            activityCodeById.get(entityString(dependency, "predecessorId")) ??
              entityString(dependency, "predecessorId", "predecessorWorkItemId"),
            entityString(dependency, "dependencyType", "type"),
            activityCodeById.get(entityString(dependency, "successorId")) ??
              entityString(dependency, "successorId", "successorWorkItemId"),
            `${formatNumber(entityNumber(dependency, "lagDays") ?? 0)} өдөр`,
          ])}
          empty="Dependency байхгүй"
        />
      </Card>
    </div>
  );
}

function ScheduleTab({ workspace }: { workspace: Workspace }) {
  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">SCHEDULE / GANTT</p>
          <h2>Төлөвлөгөө ба бодит явц</h2>
        </div>
        <Badge tone="warning">Critical тодруулсан</Badge>
      </div>
      <Gantt
        activities={
          workspace.schedule.activities.length > 0
            ? workspace.schedule.activities
            : workspace.workItems
        }
      />
    </Card>
  );
}

export function ganttActivityRange(activity: Record<string, unknown>) {
  return {
    start: Date.parse(entityString(activity, "plannedStart")),
    end: Date.parse(entityString(activity, "plannedFinish", "plannedEnd")),
  };
}

const ganttDayMs = 86_400_000;

type GanttEntry = ReturnType<typeof ganttActivityRange> & {
  activity: Record<string, unknown>;
};

function ganttPosition(value: number, minimum: number, span: number) {
  return ((value - minimum) / span) * 100;
}

function ganttDateLabel(value: number) {
  const date = new Date(value);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function ganttFullDateLabel(value: number) {
  const date = new Date(value);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join(".");
}

function ganttMonthLabel(value: number) {
  const date = new Date(value);
  return `${date.getUTCFullYear()} · ${date.getUTCMonth() + 1} сар`;
}

function ganttDurationDays(entry: GanttEntry) {
  const durationMinutes = entityNumber(entry.activity, "durationMinutes");
  if (durationMinutes !== null && durationMinutes > 0) {
    return Math.max(1, Math.ceil(durationMinutes / 480));
  }
  return Math.max(1, Math.ceil((entry.end - entry.start) / ganttDayMs) + 1);
}

export function buildGanttTimeline(minimum: number, maximum: number) {
  const span = Math.max(ganttDayMs, maximum - minimum);
  const startDate = new Date(minimum);
  let cursor = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1);
  const months: Array<{
    key: string;
    value: number;
    label: string;
    left: number;
    width: number;
  }> = [];
  while (cursor <= maximum) {
    const next = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + 1, 1);
    const visibleStart = Math.max(cursor, minimum);
    const visibleEnd = Math.min(next, maximum);
    months.push({
      key: new Date(cursor).toISOString(),
      value: visibleStart,
      label: ganttMonthLabel(cursor),
      left: ganttPosition(visibleStart, minimum, span),
      width: Math.max(0.8, ((visibleEnd - visibleStart) / span) * 100),
    });
    cursor = next;
  }

  const spanDays = Math.max(1, Math.ceil(span / ganttDayMs));
  const ticks: Array<{ value: number; left: number; label: string }> = [];
  if (spanDays > 180) {
    for (const month of months) {
      ticks.push({
        value: month.value,
        left: ganttPosition(month.value, minimum, span),
        label: ganttDateLabel(month.value),
      });
    }
  } else {
    const tickDays = spanDays <= 62 ? 7 : 14;
    for (let value = minimum; value <= maximum; value += tickDays * ganttDayMs) {
      ticks.push({
        value,
        left: ganttPosition(value, minimum, span),
        label: ganttDateLabel(value),
      });
    }
  }
  if (ticks.at(-1)?.value !== maximum) {
    ticks.push({ value: maximum, left: 100, label: ganttDateLabel(maximum) });
  }
  return { span, spanDays, months, ticks };
}

function Gantt({ activities }: { activities: Record<string, unknown>[] }) {
  const normalized = useMemo(
    () =>
      activities
        .map((activity) => ({
          activity,
          ...ganttActivityRange(activity),
        }))
        .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end)),
    [activities],
  );
  if (normalized.length === 0)
    return (
      <EmptyState
        title="Хуваарь үүсээгүй"
        description="Хуваарь нь батлагдсан тоо хэмжээ, бүтээмжийн нормоос үүсдэг. Эхлээд «Файл ба revision» табаас зураг төсөл оруулж, масштабыг баталгаажуулна уу."
      />
    );
  const minimum = Math.min(...normalized.map((entry) => entry.start));
  const maximum = Math.max(...normalized.map((entry) => entry.end));
  const timeline = buildGanttTimeline(minimum, maximum);
  const criticalCount = normalized.filter((entry) =>
    entityBoolean(entry.activity, "isCritical"),
  ).length;
  const today = Date.parse(`${todayIso()}T00:00:00.000Z`);
  const todayVisible = today >= minimum && today <= maximum;
  const todayLeft = ganttPosition(today, minimum, timeline.span);
  const timelineWidth = Math.max(760, Math.min(1_800, timeline.spanDays * 3.1));
  return (
    <div className="gantt-workspace">
      <div className="gantt-summary">
        <div>
          <span>Төслийн эхлэл</span>
          <strong>{ganttFullDateLabel(minimum)}</strong>
        </div>
        <div>
          <span>Төлөвлөсөн дуусах</span>
          <strong>{ganttFullDateLabel(maximum)}</strong>
        </div>
        <div>
          <span>Нийт хугацаа</span>
          <strong>{timeline.spanDays + 1} хуанлийн өдөр</strong>
        </div>
        <div>
          <span>Ажил / critical</span>
          <strong>
            {normalized.length} / {criticalCount}
          </strong>
        </div>
      </div>
      <div className="gantt-legend" aria-label="Gantt тайлбар">
        <span>
          <i className="regular" /> Энгийн ажил
        </span>
        <span>
          <i className="critical" /> Critical ажил
        </span>
        <span>
          <i className="progress" /> Бодит гүйцэтгэл
        </span>
        {todayVisible ? (
          <span>
            <i className="today" /> Өнөөдөр
          </span>
        ) : null}
      </div>
      <div className="gantt-scroll" tabIndex={0} aria-label="Gantt хүснэгт, хөндлөн гүйлгэнэ">
        <div
          className="gantt"
          style={{ "--gantt-timeline-width": `${timelineWidth}px` } as React.CSSProperties}
        >
          <div className="gantt-header">
            <div className="gantt-label-header">
              <strong>Ажил</strong>
              <span>Эхлэх → дуусах · хугацаа</span>
            </div>
            <div className="gantt-calendar">
              <div className="gantt-months">
                {timeline.months.map((month) => (
                  <span
                    key={month.key}
                    style={{ left: `${month.left}%`, width: `${month.width}%` }}
                  >
                    {month.label}
                  </span>
                ))}
              </div>
              <div className="gantt-date-ticks">
                {timeline.ticks.map((tick, index) => (
                  <span
                    key={tick.value}
                    className={index === timeline.ticks.length - 1 ? "last" : ""}
                    style={{ left: `${tick.left}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
              {todayVisible ? (
                <i className="gantt-today-line header" style={{ left: `${todayLeft}%` }} />
              ) : null}
            </div>
          </div>
          {normalized.map((entry) => {
            const { activity, start, end } = entry;
            const left = ganttPosition(start, minimum, timeline.span);
            const width = Math.max(0.8, ((end - start) / timeline.span) * 100);
            const progress = Math.max(
              0,
              Math.min(100, entityNumber(activity, "progressPercent") ?? 0),
            );
            const critical = entityBoolean(activity, "isCritical");
            const durationDays = ganttDurationDays(entry);
            const title = `${entityString(activity, "code", "activityCode")} · ${ganttFullDateLabel(start)} → ${ganttFullDateLabel(end)} · ${durationDays} ажлын өдөр`;
            return (
              <div className="gantt-row" key={entityString(activity, "id")}>
                <div className="gantt-label-cell">
                  <div>
                    <strong>{entityString(activity, "code", "activityCode")}</strong>
                    {critical ? <Badge tone="warning">Critical</Badge> : null}
                  </div>
                  <span>{entityString(activity, "name")}</span>
                  <small>
                    {ganttFullDateLabel(start)} → {ganttFullDateLabel(end)} · {durationDays} ажлын
                    өдөр
                  </small>
                </div>
                <div className="gantt-track">
                  {timeline.ticks.map((tick) => (
                    <i
                      key={tick.value}
                      className="gantt-gridline"
                      style={{ left: `${tick.left}%` }}
                    />
                  ))}
                  {todayVisible ? (
                    <i className="gantt-today-line" style={{ left: `${todayLeft}%` }} />
                  ) : null}
                  <div
                    className={`gantt-bar ${critical ? "critical" : ""}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={title}
                    aria-label={title}
                  >
                    <i className="gantt-progress" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="gantt-help">
        Доорх хүснэгтийг хөндлөн гүйлгэж бүх сар, өдрийг харна. Бар дээр хулганаа аваачвал
        дэлгэрэнгүй хугацаа гарна.
      </p>
    </div>
  );
}

function BaselineTab({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  return (
    <div className="stack">
      <DecisionPointer
        projectId={projectId}
        reviews={workspace.reviews}
        targetTypes={["QUANTITY_TAKEOFF", "ESTIMATE", "SCHEDULE", "BASELINE"]}
        label="суурь хувилбарын шийдвэр хүлээгдэж байна"
      />
      <VersionCompare projectId={projectId} workspace={workspace} />
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">BASELINE VERSIONS</p>
            <h2>Locked суурь</h2>
          </div>
          <Badge tone="purple">{workspace.commercial.baselines.length}</Badge>
        </div>
        <DataTable
          headers={["Version", "Status", "Source hash", "Approved"]}
          rows={workspace.commercial.baselines.map((baseline) => [
            entityString(baseline, "versionNumber", "name"),
            <Badge
              key="status"
              tone={entityString(baseline, "status") === "APPROVED" ? "success" : "warning"}
            >
              {entityString(baseline, "status")}
            </Badge>,
            entityString(baseline, "sourceHash").slice(0, 12),
            formatDate(entityString(baseline, "approvedAt", "createdAt")),
          ])}
          empty="Baseline үүсээгүй"
        />
      </Card>
    </div>
  );
}
