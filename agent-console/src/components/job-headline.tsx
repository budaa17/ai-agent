import { ReactNode } from "react";

/**
 * The one sentence a role should read before anything else on their landing
 * page — "Танд шалгах 8 зүйл байна" rather than a wall of tiles they have to
 * interpret. Everything below it is supporting detail.
 */
export function JobHeadline({
  question,
  count,
  unit,
  detail,
  tone = "neutral",
  action,
}: {
  /** What this role came to find out, in their own words. */
  question: string;
  count: number;
  unit: string;
  detail?: string;
  tone?: "neutral" | "attention" | "clear";
  action?: ReactNode;
}) {
  const settled = count === 0;
  return (
    <section className={`job-headline tone-${settled ? "clear" : tone}`}>
      <p className="job-question">{question}</p>
      <p className="job-answer">
        <strong>{count}</strong>
        <span>{unit}</span>
      </p>
      {detail !== undefined ? <p className="job-detail">{detail}</p> : null}
      {action !== undefined ? <div className="job-action">{action}</div> : null}
    </section>
  );
}
