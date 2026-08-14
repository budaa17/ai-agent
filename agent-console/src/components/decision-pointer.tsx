import { Link } from "react-router-dom";
import { ArrowRight, Inbox } from "lucide-react";
import { entityString } from "../lib/format";

type Row = Record<string, unknown>;

/**
 * Screens used to carry their own approval widget, which meant a manager had to
 * open five of them to find out what needed deciding. Discovery now lives in
 * one queue; a screen that has work waiting only points at it.
 */
export function DecisionPointer({
  projectId,
  reviews,
  targetTypes,
  label,
}: {
  projectId: string;
  reviews: readonly Row[];
  /** Which review target types belong to this screen. */
  targetTypes: readonly string[];
  label: string;
}) {
  const waiting = reviews.filter(
    (review) =>
      entityString(review, "status") === "REVIEW_REQUIRED" &&
      targetTypes.includes(entityString(review, "targetType")),
  );
  if (waiting.length === 0) return null;
  return (
    <Link className="decision-pointer" to={`/projects/${projectId}/inbox`}>
      <Inbox />
      <span>
        <strong>
          {waiting.length} {label}
        </strong>
        <small>Шийдвэрүүд нэг дор — Миний шийдвэрүүд рүү очих</small>
      </span>
      <ArrowRight />
    </Link>
  );
}
