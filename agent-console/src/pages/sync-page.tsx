import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from "lucide-react";
import { useToast } from "../components/toast";
import { Badge, Button, Card, EmptyState, PageHeading } from "../components/ui";
import { formatDate } from "../lib/format";
import { listOutboxEntries, type DailyReportOutboxEntry } from "../offline/database";
import { retryOutboxEntry, subscribeOutbox, syncOutbox } from "../offline/outbox";
import { useConnectivity } from "../offline/use-connectivity";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Илгээхийг хүлээж буй",
  SYNCING: "Илгээж байна",
  RETRY: "Дахин оролдоно",
  CONFLICT: "Зөрчилтэй",
  SENT: "Илгээгдсэн",
};

/**
 * What is still sitting on this phone. A supervisor who reported from a
 * basement needs to know, without asking anyone, whether the office has the
 * numbers yet.
 */
export function SyncPage() {
  const { projectId = "" } = useParams();
  const online = useConnectivity();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<DailyReportOutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void listOutboxEntries(projectId).then(setEntries);
    };
    refresh();
    return subscribeOutbox(refresh);
  }, [projectId]);

  const waiting = entries.filter((entry) => entry.status !== "SENT");
  const conflicts = entries.filter((entry) => entry.status === "CONFLICT");

  const runSync = async () => {
    setBusy(true);
    try {
      await syncOutbox();
      showToast("Sync дуусав", "success");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="Offline"
        title={`Sync дараалал · ${waiting.length}`}
        description="Төхөөрөмж дээр хадгалагдсан тайлангууд. Холбогдоход автоматаар илгээгдэнэ."
        actions={
          <Button onClick={() => void runSync()} disabled={!online || busy || waiting.length === 0}>
            <RefreshCw /> {busy ? "Илгээж байна…" : "Одоо илгээх"}
          </Button>
        }
      />

      {!online ? (
        <Card className="notice-card is-warning">
          <strong>
            <AlertTriangle /> Интернэт алга
          </strong>
          <p className="muted-note">
            Тайлан төхөөрөмжид хадгалагдаж байна. Сүлжээ сэргэмэгц өөрөө илгээгдэнэ — юу ч
            алдагдахгүй.
          </p>
        </Card>
      ) : null}

      {conflicts.length > 0 ? (
        <Card className="notice-card is-warning">
          <strong>
            <AlertTriangle /> {conflicts.length} тайлан зөрчилтэй
          </strong>
          <p className="muted-note">
            Сервер хүлээж авахаас татгалзсан. Ихэвчлэн тухайн өдрийн тайлан аль хэдийн бүртгэгдсэн
            эсвэл өгөгдөл шалгалт давсангүй гэсэн үг.
          </p>
        </Card>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="Дараалал хоосон"
          description="Илгээгдээгүй тайлан алга. Оройн тайлан бөглөсний дараа энд харагдана."
        />
      ) : (
        <Card>
          <ul className="outbox-list">
            {entries.map((entry) => (
              <li key={entry.id} className={`outbox-item status-${entry.status.toLowerCase()}`}>
                <div>
                  <strong>{formatDate(entry.request.reportDate)}</strong>
                  <small>
                    {entry.request.progress.length} ажлын мөр · {entry.photoIds.length} зураг ·{" "}
                    {entry.attemptCount} оролдлого
                  </small>
                  {entry.lastError !== null ? (
                    <small className="conflict-message">{entry.lastError}</small>
                  ) : null}
                </div>
                <Badge
                  tone={
                    entry.status === "SENT"
                      ? "success"
                      : entry.status === "CONFLICT"
                        ? "danger"
                        : "warning"
                  }
                >
                  {entry.status === "SENT" ? <CheckCircle2 /> : <Send />}
                  {STATUS_LABEL[entry.status] ?? entry.status}
                </Badge>
                {entry.status === "RETRY" || entry.status === "CONFLICT" ? (
                  <Button
                    variant="secondary"
                    onClick={() => void retryOutboxEntry(entry.id, entry.status === "CONFLICT")}
                  >
                    Дахин илгээх
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
