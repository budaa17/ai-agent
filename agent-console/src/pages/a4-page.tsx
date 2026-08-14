import { Bot, Eraser, Send, ShieldCheck, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { buildWatchApi } from "../api/client";
import type { A4Answer } from "../api/schemas";
import { Badge, Button, Card, ErrorState, Field, PageHeading, Textarea } from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  answer?: A4Answer;
}

export function A4Page() {
  const { projectId } = useParams();
  const workspace = useWorkspace(projectId);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (projectId === undefined) return null;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 2 || sending) return;
    setQuestion("");
    setError(null);
    setSending(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    try {
      const answer = await buildWatchApi.ask(projectId, text);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: answer.answer, answer },
      ]);
    } catch (caught) {
      setError(caught);
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="ЛАВЛАГАА"
        title="Эх сурвалжтай төслийн лавлагаа"
        description="A4 зөвхөн таны эрхтэй project workspace-ийг уншина. Санхүү, progress, forecast, critical path, alert-ийн хариулт бүр source-той."
        actions={
          <Badge tone="success">
            <ShieldCheck /> READ ONLY
          </Badge>
        }
      />
      <div className="chat-layout">
        <Card className="chat-card">
          <div className="chat-scope">
            <ShieldCheck />
            <div>
              <strong>{workspace.data?.workspace.project.code ?? projectId}</strong>
              <span>
                {workspace.data?.workspace.role ?? "PROJECT_READ"} · tenant/project scope enforced
              </span>
            </div>
            <Button variant="ghost" onClick={() => setMessages([])}>
              <Eraser /> Шинэ чат
            </Button>
          </div>
          <div className="chat-messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <div>
                  <Bot />
                </div>
                <h2>Төслөөсөө асуугаарай</h2>
                <p>“Төсөв хэд вэ?”, “Явц хэдэн хувь вэ?”, “Critical ажил хэд байна?”</p>
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={`chat-message ${message.role}`}>
                  <div>{message.role === "user" ? <User /> : <Bot />}</div>
                  <section>
                    <span>{message.role === "user" ? "Та" : "A4"}</span>
                    <p>{message.text}</p>
                    {message.answer !== undefined ? (
                      <>
                        <div className="source-chips">
                          {message.answer.sources.map((source) => (
                            <details key={source.sourceId}>
                              <summary>
                                {source.entityType}.{source.field}
                              </summary>
                              <pre>{JSON.stringify(source.value, null, 2)}</pre>
                              <small>{source.entityId}</small>
                            </details>
                          ))}
                        </div>
                        <small className="tool-line">
                          Tools: {message.answer.toolNames.join(", ")} · {message.answer.status}
                        </small>
                      </>
                    ) : null}
                  </section>
                </article>
              ))
            )}
            {sending ? (
              <article className="chat-message assistant">
                <div>
                  <Bot />
                </div>
                <section>
                  <span>A4</span>
                  <p className="typing">Эрхтэй tool result-ийг шалгаж байна…</p>
                </section>
              </article>
            ) : null}
          </div>
          {error !== null ? <ErrorState error={error} /> : null}
          <form className="chat-composer" onSubmit={(event) => void send(event)}>
            <Field label="Асуулт">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Жишээ: Төслийн бодит гүйцэтгэл хэдэн хувь байна?"
              />
            </Field>
            <Button type="submit" disabled={sending || question.trim().length < 2}>
              <Send /> Илгээх
            </Button>
          </form>
        </Card>
        <Card className="chat-policy">
          <p className="eyebrow">GROUNDING POLICY</p>
          <h2>A4 юу хийхгүй вэ?</h2>
          <ul>
            <li>Өгөгдөл бичих, засахгүй.</li>
            <li>Өөр tenant/project-ийн мэдээлэл харахгүй.</li>
            <li>Source байхгүй бол “нотолгоо хангалтгүй” гэж хэлнэ.</li>
            <li>Таамагласан тоог бодит мэт танилцуулахгүй.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
