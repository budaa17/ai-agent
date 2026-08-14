import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { buildWatchApi } from "../api/client";
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
  Select,
} from "../components/ui";
import { JobHeadline } from "../components/job-headline";
import { useWorkspace } from "../hooks/use-workspace";
import { entityNumber, entityString, formatDate, formatNumber, materialCode } from "../lib/format";

type Row = Record<string, unknown>;

type Demand = {
  readonly materialId: string;
  readonly unit: string;
  readonly required: number;
  readonly available: number;
  readonly shortage: number;
  readonly days: { readonly date: string; readonly required: number; readonly shortage: number }[];
};

/**
 * The storekeeper's screen. Movement recording still needs a backend endpoint,
 * so this shows the half the API does expose: what the approved daily plans are
 * about to consume and where the plan itself says stock will not cover it.
 */
export function MaterialsPage() {
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useWorkspace(projectId);
  const inventory = useQuery({
    queryKey: ["inventory", projectId],
    queryFn: () => buildWatchApi.inventory(projectId),
    enabled: projectId !== "",
  });
  const [movementType, setMovementType] = useState<"RECEIPT" | "ISSUE">("RECEIPT");
  const [materialItemId, setMaterialItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const workspace = query.data?.workspace;
  const canWrite = workspace?.permissions.includes("INVENTORY_WRITE") ?? false;
  const selectedMaterial = inventory.data?.balances.find(
    (material) => material.materialItemId === materialItemId,
  );
  const movement = useMutation({
    mutationFn: (input: Parameters<typeof buildWatchApi.createStockMovement>[1]) =>
      buildWatchApi.createStockMovement(projectId, input, `inventory-${crypto.randomUUID()}`),
    onSuccess: async () => {
      setQuantity("");
      setReason("");
      showToast("Агуулахын хөдөлгөөн append-only ledger-т бүртгэгдлээ", "success");
      await queryClient.invalidateQueries({ queryKey: ["inventory", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });

  const demands = useMemo<Demand[]>(() => {
    if (workspace === undefined) return [];
    const planDate = new Map(
      workspace.operations.plans.map((plan) => [
        entityString(plan, "id"),
        entityString(plan, "planDate"),
      ]),
    );
    const byMaterial = new Map<string, Demand>();
    for (const item of workspace.operations.planItems) {
      const date = planDate.get(entityString(item, "planId")) ?? "";
      for (const material of (item.materials as Row[] | undefined) ?? []) {
        const materialId = entityString(material, "materialItemId");
        const required = entityNumber(material, "requiredQuantity") ?? 0;
        const available = entityNumber(material, "availableQuantity") ?? 0;
        const shortage = entityNumber(material, "shortageQuantity") ?? 0;
        const current = byMaterial.get(materialId) ?? {
          materialId,
          unit: entityString(material, "unit"),
          required: 0,
          available: 0,
          shortage: 0,
          days: [],
        };
        byMaterial.set(materialId, {
          ...current,
          required: current.required + required,
          available: current.available + available,
          shortage: current.shortage + shortage,
          days: [...current.days, { date, required, shortage }],
        });
      }
    }
    return [...byMaterial.values()].sort((left, right) => right.shortage - left.shortage);
  }, [workspace]);

  const shortages = demands.filter((demand) => demand.shortage > 0);

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (inventory.isPending) return <LoadingState label="Материалын ledger ачаалж байна…" />;
  if (inventory.isError)
    return <ErrorState error={inventory.error} retry={() => void inventory.refetch()} />;
  if (workspace === undefined) return <LoadingState />;

  return (
    <>
      <JobHeadline
        question="Өнөөдөр юу олгох вэ?"
        count={demands.length}
        unit="материал шаардлагатай"
        detail={
          shortages.length > 0
            ? `${shortages.length} материалын нөөц хүрэлцэхгүй байна.`
            : "Батлагдсан даалгавруудад нөөц хүрэлцэж байна."
        }
        tone={shortages.length > 0 ? "attention" : "neutral"}
      />

      {shortages.length > 0 ? (
        <Card className="shortage-banner">
          <strong>
            <AlertTriangle /> {shortages.length} материалд дутагдал илэрсэн
          </strong>
          <ul className="shortage-list">
            {shortages.map((demand) => (
              <li key={demand.materialId}>
                <span>{materialCode(demand.materialId)}</span>
                <Badge tone="danger">
                  {formatNumber(demand.shortage, 2)} {demand.unit} дутуу
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="shortage-banner is-ok">
          <strong>
            <PackageCheck /> Одоогийн даалгаварт материалын дутагдал алга
          </strong>
        </Card>
      )}

      {demands.length === 0 ? (
        <EmptyState
          title="Материалын хэрэгцээ бүртгэгдээгүй"
          description="Өдрийн даалгаварт материал холбогдоогүй байна. Ажлын норм тохируулсны дараа энд хэрэгцээ гарч ирнэ."
        />
      ) : (
        <Card>
          <h2>Материал тус бүрээр</h2>
          <DataTable
            headers={["Материал", "Нэгж", "Нийт хэрэгцээ", "Боломжтой", "Дутагдал", "Өдөр"]}
            rows={demands.map((demand) => [
              materialCode(demand.materialId),
              demand.unit,
              formatNumber(demand.required, 2),
              formatNumber(demand.available, 2),
              demand.shortage > 0 ? (
                <Badge tone="danger">{formatNumber(demand.shortage, 2)}</Badge>
              ) : (
                <Badge tone="success">0</Badge>
              ),
              `${demand.days.length}`,
            ])}
          />
        </Card>
      )}

      <Card className="mt-6">
        <h2>Ойрын өдрүүдийн хэрэгцээ</h2>
        <DataTable
          headers={["Огноо", "Материал", "Хэрэгцээ", "Дутагдал"]}
          empty="Даалгавар алга"
          rows={demands
            .flatMap((demand) =>
              demand.days.map((day) => ({
                ...day,
                materialId: demand.materialId,
                unit: demand.unit,
              })),
            )
            .sort((left, right) => right.date.localeCompare(left.date))
            .slice(0, 24)
            .map((day) => [
              formatDate(day.date),
              materialCode(day.materialId),
              `${formatNumber(day.required, 2)} ${day.unit}`,
              day.shortage > 0 ? <Badge tone="danger">{formatNumber(day.shortage, 2)}</Badge> : "—",
            ])}
        />
      </Card>

      {canWrite ? (
        <Card className="mt-6">
          <h2>Орлого / зарлага бүртгэх</h2>
          <div className="form-grid">
            <Field label="Хөдөлгөөн">
              <Select
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as "RECEIPT" | "ISSUE")}
              >
                <option value="RECEIPT">Орлого</option>
                <option value="ISSUE">Зарлага</option>
              </Select>
            </Field>
            <Field label="Материал">
              <Select value={materialItemId} onChange={(event) => setMaterialItemId(event.target.value)}>
                <option value="">Сонгох</option>
                {inventory.data.balances.map((material) => (
                  <option key={material.materialItemId} value={material.materialItemId}>
                    {material.code} · {material.name} · үлдэгдэл {material.quantity} {material.unit}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Тоо хэмжээ${selectedMaterial ? ` (${selectedMaterial.unit})` : ""}`}>
              <Input type="number" min="0.00000001" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
            <Field label="Үндэслэл">
              <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Падаан, олголтын дугаар эсвэл тайлбар" />
            </Field>
          </div>
          <Button
            disabled={movement.isPending || selectedMaterial === undefined || Number(quantity) <= 0 || reason.trim().length < 3}
            onClick={() =>
              movement.mutate({
                movementType,
                materialItemId,
                quantity,
                unit: selectedMaterial?.unit ?? null,
                occurredAt: new Date().toISOString(),
                warehouseCode: "MAIN",
                referenceType: "MANUAL",
                referenceId: crypto.randomUUID(),
                reversalOfId: null,
                reason,
              })
            }
          >
            {movement.isPending ? "Бүртгэж байна…" : "Ledger-т нэмэх"}
          </Button>
        </Card>
      ) : null}

      <Card className="mt-6">
        <h2>Append-only хөдөлгөөний түүх</h2>
        <DataTable
          headers={["Огноо", "Материал", "Төрөл", "Тоо", "Үндэслэл", "Залруулга"]}
          empty="Хөдөлгөөн алга"
          rows={inventory.data.movements.map((entry) => {
            const reversed = inventory.data.movements.some(
              (candidate) => entityString(candidate, "reversalOfId") === entityString(entry, "id"),
            );
            return [
              formatDate(entityString(entry, "occurredAt")),
              materialCode(entityString(entry, "materialItemId")),
              entityString(entry, "movementType"),
              `${entityString(entry, "quantity")} ${entityString(entry, "unit")}`,
              entityString(entry, "reason"),
              canWrite && entityString(entry, "movementType") !== "REVERSAL" && !reversed ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    movement.mutate({
                      movementType: "REVERSAL",
                      materialItemId: null,
                      quantity: null,
                      unit: null,
                      occurredAt: new Date().toISOString(),
                      warehouseCode: "MAIN",
                      referenceType: "REVERSAL",
                      referenceId: crypto.randomUUID(),
                      reversalOfId: entityString(entry, "id"),
                      reason: `Залруулга: ${entityString(entry, "reason")}`,
                    })
                  }
                >
                  Буцаах
                </Button>
              ) : reversed ? (
                <Badge tone="neutral">Буцаасан</Badge>
              ) : (
                "—"
              ),
            ];
          })}
        />
      </Card>
    </>
  );
}
