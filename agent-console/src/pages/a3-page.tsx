import { Download, FileCheck2, FileText, Printer } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { buildWatchApi } from "../api/client";
import { ReviewAction } from "../components/review-action";
import { useToast } from "../components/toast";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeading } from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import { entityString, formatDate } from "../lib/format";

export function A3Page() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const query = useWorkspace(projectId);
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const generate = useMutation({
    mutationFn: () =>
      buildWatchApi.generateA3Documents(projectId as string, {
        requestId: `a3-ui-${crypto.randomUUID()}`,
        asOf: new Date().toISOString(),
        includePdf: true,
      }),
    onSuccess: async (result) => {
      showToast(`${result.draftIds.length} A3 draft үүслээ`, "success");
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });
  if (projectId === undefined) return null;
  if (query.isPending) return <LoadingState label="A3 баримт бичгүүд ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const workspace = query.data.workspace;
  const drafts = workspace.assistants.a3Drafts;
  const selected = drafts.find((draft) => entityString(draft, "id") === selectedId) ?? drafts[0];
  const pdfs = workspace.artifacts.filter(
    (artifact) => entityString(artifact, "mediaType") === "application/pdf",
  );
  const matchingReview =
    selected === undefined
      ? undefined
      : workspace.reviews.find(
          (review) => entityString(review, "targetId") === entityString(selected, "id"),
        );
  const openPdf = async (artifact: Record<string, unknown>) => {
    try {
      setPreviewUrl(
        (await buildWatchApi.signedArtifactUrl(projectId, entityString(artifact, "id"))).url,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="АЛБАН БИЧИГ"
        title="Тайлан ба албан бичгийн draft"
        description="Source-backed content, review decision, immutable approved version болон signed PDF preview."
        actions={
          <div className="stack-row">
            {workspace.permissions.includes("AGENT_RUN") ? (
              <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? "Бэлтгэж байна…" : "Шинэ тайлан бэлтгэх"}
              </Button>
            ) : null}
            <Badge tone="info">
              {drafts.length} draft · {pdfs.length} PDF
            </Badge>
          </div>
        }
      />
      {drafts.length === 0 && pdfs.length === 0 ? (
        <EmptyState
          title="A3 document алга"
          description="A3 scheduled/request flow ажилласны дараа draft болон PDF энд харагдана."
        />
      ) : (
        <div className="document-workspace">
          <Card className="document-list">
            <div className="card-heading">
              <div>
                <p className="eyebrow">DOCUMENTS</p>
                <h2>Ноорог</h2>
              </div>
              <FileText />
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
                <FileCheck2 />
                <div>
                  <strong>{entityString(draft, "title")}</strong>
                  <span>
                    {entityString(draft, "type")} · {formatDate(entityString(draft, "sourceAsOf"))}
                  </span>
                </div>
                <Badge tone={entityString(draft, "status") === "APPROVED" ? "success" : "warning"}>
                  {entityString(draft, "status")}
                </Badge>
              </button>
            ))}
            <div className="pdf-list">
              <p className="eyebrow">PDF ARTIFACTS</p>
              {pdfs.map((artifact) => (
                <button
                  type="button"
                  key={entityString(artifact, "id")}
                  onClick={() => void openPdf(artifact)}
                >
                  <Printer />
                  <span>{entityString(artifact, "originalFileName")}</span>
                  <Download />
                </button>
              ))}
            </div>
          </Card>
          <div className="stack">
            <Card className="document-preview">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">DRAFT PREVIEW</p>
                  <h2>
                    {selected === undefined
                      ? "Document сонгоно уу"
                      : entityString(selected, "title")}
                  </h2>
                </div>
                {selected === undefined ? null : (
                  <Badge tone="neutral">{entityString(selected, "status")}</Badge>
                )}
              </div>
              {selected === undefined ? (
                <EmptyState
                  title="Draft сонгоно уу"
                  description="Зүүн жагсаалтаас баримт сонгоно."
                />
              ) : (
                <pre>{JSON.stringify(selected.content, null, 2)}</pre>
              )}
            </Card>
            {previewUrl !== null ? (
              <Card>
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">SIGNED PDF</p>
                    <h2>PDF preview</h2>
                  </div>
                </div>
                <iframe className="artifact-viewer" title="A3 PDF" src={previewUrl} />
              </Card>
            ) : null}
            {matchingReview !== undefined ? (
              <Card>
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">APPROVAL</p>
                    <h2>Баримтын шийдвэр</h2>
                  </div>
                </div>
                <ReviewAction projectId={projectId} task={matchingReview} />
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
