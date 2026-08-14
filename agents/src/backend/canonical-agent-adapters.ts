import type { Phase9JobPayload } from "./jobs.js";
import { phase9JobPayloadSchema } from "./jobs.js";
import { consumePhase9Event } from "./outbox.js";
import {
  Phase9AgentAdapterRegistry,
  type Phase9AgentProductionAdapter,
} from "./production-adapters.js";
import type { Phase9OutboxRecord, Phase9Store, Phase9StoreTransaction } from "./store.js";

export type Phase9CanonicalAgentRunner = (
  payload: Phase9JobPayload,
  transaction: Phase9StoreTransaction,
) => Promise<Record<string, unknown>>;

export interface Phase9CanonicalAgentRunners {
  A0: Phase9CanonicalAgentRunner;
  A1: Phase9CanonicalAgentRunner;
  A2: Phase9CanonicalAgentRunner;
  A3: Phase9CanonicalAgentRunner;
  A4: Phase9CanonicalAgentRunner;
  A5: Phase9CanonicalAgentRunner;
}

function eventFromJob(payload: Phase9JobPayload): Phase9OutboxRecord {
  const now = new Date().toISOString();
  return {
    id: payload.eventId,
    tenantId: payload.tenantId,
    projectId: payload.projectId,
    eventType: payload.eventType,
    aggregateType: payload.aggregateType,
    aggregateId: payload.aggregateId,
    aggregateVersion: payload.aggregateVersion,
    idempotencyKey: payload.idempotencyKey,
    payload: payload.payload,
    headers: payload.headers,
    status: "PUBLISHED",
    availableAt: now,
    publishedAt: now,
    retryCount: 0,
    lastErrorCode: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: now,
  };
}

function assertEmbeddedScope(payload: Phase9JobPayload): void {
  const embeddedTenant = payload.payload.tenantId;
  const embeddedProject = payload.payload.projectId;
  if (
    (typeof embeddedTenant === "string" && embeddedTenant !== payload.tenantId) ||
    (typeof embeddedProject === "string" && embeddedProject !== payload.projectId)
  ) {
    throw new Error("Phase 9 agent payload scope mismatch");
  }
}

export function createPhase9CanonicalAgentAdapterRegistry(
  store: Phase9Store,
  runners: Phase9CanonicalAgentRunners,
): Phase9AgentAdapterRegistry {
  const adapters = (Object.keys(runners) as Array<keyof Phase9CanonicalAgentRunners>).map(
    (name): Phase9AgentProductionAdapter => ({
      name,
      version: `buildwatch-${name.toLocaleLowerCase("en-US")}-canonical-adapter-v1`,
      mode: name === "A4" ? "REQUEST" : "JOB",
      readOnly: name === "A4",
      run: async (input) => {
        const payload = phase9JobPayloadSchema.parse(input);
        assertEmbeddedScope(payload);
        if (name === "A4") {
          return store.read((transaction) => runners.A4(payload, transaction));
        }
        return consumePhase9Event(
          store,
          eventFromJob(payload),
          `phase9-agent-${name}`,
          (transaction) => runners[name](payload, transaction),
        );
      },
    }),
  );
  return new Phase9AgentAdapterRegistry(adapters);
}
