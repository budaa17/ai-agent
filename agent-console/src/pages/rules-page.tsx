import "@gorules/jdm-editor/dist/style.css";
import { DecisionGraph, JdmConfigProvider, type DecisionGraphType } from "@gorules/jdm-editor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Rocket, Save } from "lucide-react";
import { useState } from "react";
import { buildWatchApi, type RuleId } from "../api/client";
import { useToast } from "../components/toast";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeading } from "../components/ui";

const RULE_LABELS: Record<string, string> = {
  OVERDUE_WORK_ITEM: "Хугацаа хэтрэлт",
  MATERIAL_OVERUSE: "Материал хэтрүүлэлт",
  STOCK_SHORTAGE: "Нөөц хүрэлцэхгүй байдал",
  PRODUCTIVITY_DECLINE: "Бүтээмж бууралт",
  COST_AHEAD_OF_PROGRESS: "Зардал явцаас түрүүлэх",
  SUBCONTRACTOR_DEVIATION: "Туслан гүйцэтгэгчийн хоцролт",
  MISSING_DAILY_REPORT: "Өдрийн тайлан дутуу",
};

type RuleVersions = Awaited<ReturnType<typeof buildWatchApi.listRuleVersions>>;

export function RulesPage() {
  const [selectedRuleId, setSelectedRuleId] = useState<RuleId | null>(null);

  const rules = useQuery({ queryKey: ["rules"], queryFn: () => buildWatchApi.listRules() });
  const activeRuleId = selectedRuleId ?? rules.data?.[0]?.ruleId ?? null;

  const versions = useQuery({
    queryKey: ["rule-versions", activeRuleId],
    queryFn: () => buildWatchApi.listRuleVersions(activeRuleId as RuleId),
    enabled: activeRuleId !== null,
  });

  if (rules.isPending) return <LoadingState label="Дүрмийн жагсаалт ачаалж байна…" />;
  if (rules.isError) return <ErrorState error={rules.error} retry={() => void rules.refetch()} />;

  return (
    <>
      <PageHeading
        eyebrow="GORULES JDM EDITOR"
        title="Дүрмийн засварлагч"
        description="7 стандарт threshold дүрмийг код дахин байршуулахгүйгээр JDM decision table хэлбэрээр засах, хувилбарлах, нийтлэх (DET-14)."
        actions={
          <Badge tone="purple">
            <GitBranch /> {activeRuleId ?? ""}
          </Badge>
        }
      />
      <div className="split-grid">
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">RULES</p>
              <h2>7 дүрэм</h2>
            </div>
          </div>
          <div className="stack">
            {rules.data.map((rule) => (
              <Button
                key={rule.ruleId}
                variant={rule.ruleId === activeRuleId ? "primary" : "secondary"}
                onClick={() => setSelectedRuleId(rule.ruleId)}
              >
                {RULE_LABELS[rule.ruleId] ?? rule.ruleId}
                <Badge tone={rule.source === "TENANT" ? "info" : "neutral"}>
                  {rule.source === "TENANT"
                    ? `v${rule.latestVersion?.versionNumber ?? "?"}`
                    : "default"}
                </Badge>
              </Button>
            ))}
          </div>
        </Card>
        <Card>
          {activeRuleId === null || versions.isPending ? (
            <LoadingState label="Дүрмийн хувилбар ачаалж байна…" />
          ) : versions.isError ? (
            <ErrorState error={versions.error} retry={() => void versions.refetch()} />
          ) : (
            <RuleEditorPanel key={activeRuleId} ruleId={activeRuleId} versions={versions.data} />
          )}
        </Card>
      </div>
    </>
  );
}

function RuleEditorPanel({ ruleId, versions }: { ruleId: RuleId; versions: RuleVersions }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const latestDraft = versions.versions.find((version) => version.status === "DRAFT");
  const [graph, setGraph] = useState<DecisionGraphType>(
    () => (latestDraft?.jdmGraph ?? versions.defaultGraph) as unknown as DecisionGraphType,
  );
  const [draftVersionId, setDraftVersionId] = useState<string | null>(latestDraft?.id ?? null);

  const saveDraft = useMutation({
    mutationFn: () =>
      buildWatchApi.saveRuleDraft(
        ruleId,
        graph as unknown as Parameters<typeof buildWatchApi.saveRuleDraft>[1],
      ),
    onSuccess: (version) => {
      setDraftVersionId(version.id);
      showToast("Ноорог хадгалагдлаа", "success");
      void queryClient.invalidateQueries({ queryKey: ["rule-versions", ruleId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });

  const publish = useMutation({
    mutationFn: () => buildWatchApi.publishRuleVersion(ruleId, draftVersionId as string),
    onSuccess: () => {
      showToast("Дүрмийн хувилбар нийтлэгдлээ", "success");
      void queryClient.invalidateQueries({ queryKey: ["rule-versions", ruleId] });
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });

  return (
    <>
      <div className="card-heading">
        <div>
          <p className="eyebrow">JDM DECISION TABLE</p>
          <h2>{RULE_LABELS[ruleId] ?? ruleId}</h2>
        </div>
        <div className="stack-row">
          <Button
            variant="secondary"
            disabled={saveDraft.isPending}
            onClick={() => saveDraft.mutate()}
          >
            <Save /> {saveDraft.isPending ? "Хадгалж байна…" : "Ноорог хадгалах"}
          </Button>
          <Button
            disabled={draftVersionId === null || publish.isPending}
            onClick={() => publish.mutate()}
          >
            <Rocket /> {publish.isPending ? "Нийтэлж байна…" : "Нийтлэх"}
          </Button>
        </div>
      </div>
      <div className="jdm-editor-frame">
        <JdmConfigProvider>
          <DecisionGraph value={graph} onChange={(value) => setGraph(value)} />
        </JdmConfigProvider>
      </div>
    </>
  );
}
