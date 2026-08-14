import { createHash } from "node:crypto";
import { z } from "zod";
import {
  dailyWorkPlanStateTransitionV1Schema,
  type DailyWorkPlanStateTransitionV1,
} from "../contracts/index.js";
import { contractIsoDateTimeSchema } from "../contracts/common.js";
import { stableStringify } from "./deterministic.js";

export const a5PlanReviewAuditEntrySchema = z
  .object({
    transition: dailyWorkPlanStateTransitionV1Schema,
    correctedFieldPaths: z.array(z.string().trim().min(1).max(500)).max(500),
    recordedAt: contractIsoDateTimeSchema,
    entryHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type A5PlanReviewAuditEntry = z.infer<typeof a5PlanReviewAuditEntrySchema>;

export class A5DailyPlanReviewLedger {
  readonly #statusByPlanId = new Map<string, DailyWorkPlanStateTransitionV1["fromStatus"]>();
  readonly #entryByTransitionId = new Map<string, A5PlanReviewAuditEntry>();
  readonly #historyByPlanId = new Map<string, A5PlanReviewAuditEntry[]>();

  register(
    dailyWorkPlanVersionId: string,
    initialStatus: DailyWorkPlanStateTransitionV1["fromStatus"] = "DRAFT",
  ): void {
    const existing = this.#statusByPlanId.get(dailyWorkPlanVersionId);
    if (existing !== undefined && existing !== initialStatus) {
      throw new Error("Daily plan is already registered with a different status");
    }
    this.#statusByPlanId.set(dailyWorkPlanVersionId, initialStatus);
  }

  apply(
    input: unknown,
    correctedFieldPaths: readonly string[] = [],
    recordedAt?: string,
  ): A5PlanReviewAuditEntry {
    const transition = dailyWorkPlanStateTransitionV1Schema.parse(input);
    const existing = this.#entryByTransitionId.get(transition.transitionId);
    if (existing !== undefined) {
      const same = stableStringify(existing.transition) === stableStringify(transition);
      if (!same) {
        throw new Error("Transition ID was reused with different content");
      }
      return existing;
    }
    const current = this.#statusByPlanId.get(transition.dailyWorkPlanVersionId);
    if (current === undefined) {
      throw new Error("Daily plan is not registered");
    }
    if (current !== transition.fromStatus) {
      throw new Error(`Daily plan current status is ${current}, not ${transition.fromStatus}`);
    }
    const normalizedPaths = [...new Set(correctedFieldPaths)].sort();
    if (
      transition.toStatus === "DRAFT" &&
      transition.fromStatus !== "REJECTED" &&
      normalizedPaths.length === 0
    ) {
      throw new Error("Correction transition requires corrected field paths");
    }
    const timestamp = recordedAt ?? transition.transitionedAt;
    const hashInput = stableStringify({ transition, normalizedPaths, timestamp });
    const entry = a5PlanReviewAuditEntrySchema.parse({
      transition,
      correctedFieldPaths: normalizedPaths,
      recordedAt: timestamp,
      entryHash: createHash("sha256").update(hashInput).digest("hex"),
    });
    this.#entryByTransitionId.set(transition.transitionId, entry);
    this.#statusByPlanId.set(transition.dailyWorkPlanVersionId, transition.toStatus);
    const history = this.#historyByPlanId.get(transition.dailyWorkPlanVersionId) ?? [];
    history.push(entry);
    this.#historyByPlanId.set(transition.dailyWorkPlanVersionId, history);
    return entry;
  }

  status(dailyWorkPlanVersionId: string) {
    return this.#statusByPlanId.get(dailyWorkPlanVersionId) ?? null;
  }

  history(dailyWorkPlanVersionId: string): A5PlanReviewAuditEntry[] {
    return [...(this.#historyByPlanId.get(dailyWorkPlanVersionId) ?? [])];
  }
}
