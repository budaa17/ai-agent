import { randomUUID } from "node:crypto";
import type { PlatformOverviewAttentionItem } from "./platform-overview-contracts.js";
import type { PlatformOverviewSignalSnapshot } from "./platform-overview-service.js";
import type {
  PlatformIncidentEvaluation,
  PlatformIncidentSeverity,
} from "./platform-incident-contracts.js";
import { platformIncidentEvaluationSchema } from "./platform-incident-contracts.js";
import type {
  PlatformIncidentEventRecord,
  PlatformIncidentRecord,
  PlatformIncidentStore,
} from "./platform-incident-store.js";

/**
 * Turns the overview's derived signals into persistent incidents.
 *
 * The `signalId` is the deduplication key: a rule that keeps firing for the
 * same scope stays one incident and accumulates history. A signal that stops
 * firing auto-resolves — but only when every source was readable, so a database
 * outage can never silently close the very incidents it should be raising.
 */

const RULE_SET_VERSION = "platform-overview-rules.v1";

/** Structural: `PlatformOverviewService` satisfies it, and so can a stub. */
export interface PlatformSignalSource {
  evaluateSignals(rawQuery: unknown): Promise<PlatformOverviewSignalSnapshot>;
}

export interface PlatformAlertEvaluatorDependencies {
  overview: PlatformSignalSource;
  incidents: PlatformIncidentStore;
}

function evidenceOf(signal: PlatformOverviewAttentionItem) {
  return signal.evidence.map((item) => ({
    metricKey: item.metricKey,
    value: item.value,
    unit: item.unit,
    observedAt: item.observedAt,
  }));
}

function incidentFromSignal(
  signal: PlatformOverviewAttentionItem,
  now: Date,
): PlatformIncidentRecord {
  return {
    id: randomUUID(),
    signalId: signal.signalId,
    ruleKey: signal.ruleKey,
    ruleVersion: signal.ruleVersion,
    severity: signal.severity,
    state: "OPEN",
    title: signal.title,
    impact: signal.impact,
    recommendedAction: signal.recommendedAction,
    diagnosticsHref: signal.diagnosticsHref,
    tenantId: signal.scope.tenantId,
    tenantName: signal.scope.tenantName,
    agentType: signal.scope.agentType,
    component: signal.scope.component,
    evidence: evidenceOf(signal),
    firstEvidenceAt: signal.firstEvidenceAt,
    lastEvidenceAt: signal.lastEvidenceAt ?? now.toISOString(),
    openedAt: now.toISOString(),
    acknowledgedAt: null,
    acknowledgedById: null,
    assignedToId: null,
    assignedAt: null,
    resolvedAt: null,
    resolvedById: null,
    resolutionNote: null,
    autoResolvedAt: null,
    reopenCount: 0,
    rowVersion: 1,
  };
}

function systemEvent(input: {
  incidentId: string;
  type: PlatformIncidentEventRecord["type"];
  fromState: PlatformIncidentRecord["state"] | null;
  toState: PlatformIncidentRecord["state"];
  correlationId: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}): PlatformIncidentEventRecord {
  return {
    id: randomUUID(),
    incidentId: input.incidentId,
    type: input.type,
    fromState: input.fromState,
    toState: input.toState,
    actorPrincipalId: null,
    actorRole: null,
    reason: null,
    note: null,
    correlationId: input.correlationId,
    idempotencyKey: null,
    metadata: { source: "PLATFORM_ALERT_EVALUATOR", ...(input.metadata ?? {}) },
    occurredAt: input.occurredAt.toISOString(),
  };
}

const severityRank: Readonly<Record<PlatformIncidentSeverity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export class PlatformAlertEvaluator {
  private readonly overview: PlatformSignalSource;
  private readonly incidents: PlatformIncidentStore;

  constructor(
    dependencies: PlatformAlertEvaluatorDependencies,
    private readonly now: () => Date = () => new Date(),
    private readonly correlationId: () => string = () => randomUUID(),
  ) {
    this.overview = dependencies.overview;
    this.incidents = dependencies.incidents;
  }

  async evaluate(rawQuery: unknown = {}): Promise<PlatformIncidentEvaluation> {
    const snapshot = await this.overview.evaluateSignals(rawQuery);
    const at = new Date(this.now());
    const correlationId = this.correlationId();
    const active = await this.incidents.listActive();
    const unmatched = new Map(active.map((incident) => [incident.signalId, incident]));
    // Resolved incidents are looked up too: a returning signal must reopen the
    // original row, never create a second one under the same signal identity.
    const known = await this.incidents.statesBySignalIds(
      snapshot.signals.map((signal) => signal.signalId),
    );

    let opened = 0;
    let reopened = 0;
    let severityChanged = 0;
    let refreshed = 0;
    let autoResolved = 0;

    for (const signal of snapshot.signals) {
      const existing = unmatched.get(signal.signalId);
      if (existing === undefined) {
        const resolved = known.get(signal.signalId);
        if (resolved === undefined) {
          const record = incidentFromSignal(signal, at);
          await this.incidents.create(
            record,
            systemEvent({
              incidentId: record.id,
              type: "OPENED",
              fromState: null,
              toState: "OPEN",
              correlationId,
              occurredAt: at,
              metadata: { ruleKey: signal.ruleKey, severity: signal.severity },
            }),
          );
          opened += 1;
          continue;
        }
        const record = await this.incidents.findById(resolved.incidentId);
        if (record === null) continue;
        const next: PlatformIncidentRecord = {
          ...record,
          state: "REOPENED",
          severity: signal.severity,
          title: signal.title,
          impact: signal.impact,
          recommendedAction: signal.recommendedAction,
          diagnosticsHref: signal.diagnosticsHref,
          tenantName: signal.scope.tenantName,
          evidence: evidenceOf(signal),
          lastEvidenceAt: signal.lastEvidenceAt ?? at.toISOString(),
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
          autoResolvedAt: null,
          reopenCount: record.reopenCount + 1,
          rowVersion: record.rowVersion + 1,
        };
        const applied = await this.incidents.apply(
          next,
          systemEvent({
            incidentId: record.id,
            type: "REOPENED",
            fromState: record.state,
            toState: "REOPENED",
            correlationId,
            occurredAt: at,
            metadata: { reopenCount: next.reopenCount, previousResolvedAt: record.resolvedAt },
          }),
          record.rowVersion,
        );
        if (applied) reopened += 1;
        continue;
      }

      unmatched.delete(signal.signalId);
      const severityMoved = existing.severity !== signal.severity;
      const next: PlatformIncidentRecord = {
        ...existing,
        severity: signal.severity,
        title: signal.title,
        impact: signal.impact,
        recommendedAction: signal.recommendedAction,
        diagnosticsHref: signal.diagnosticsHref,
        tenantName: signal.scope.tenantName,
        evidence: evidenceOf(signal),
        firstEvidenceAt: existing.firstEvidenceAt ?? signal.firstEvidenceAt,
        lastEvidenceAt: signal.lastEvidenceAt ?? at.toISOString(),
        rowVersion: existing.rowVersion + 1,
      };
      // Only a severity move is worth a timeline entry; refreshing evidence on
      // every tick would bury the operator's own actions in noise.
      if (severityMoved) {
        const applied = await this.incidents.apply(
          next,
          systemEvent({
            incidentId: existing.id,
            type: "SEVERITY_CHANGED",
            fromState: existing.state,
            toState: existing.state,
            correlationId,
            occurredAt: at,
            metadata: {
              fromSeverity: existing.severity,
              toSeverity: signal.severity,
              escalated: severityRank[signal.severity] < severityRank[existing.severity],
            },
          }),
          existing.rowVersion,
        );
        if (applied) severityChanged += 1;
      } else {
        const applied = await this.incidents.apply(
          next,
          systemEvent({
            incidentId: existing.id,
            type: existing.state === "REOPENED" ? "REOPENED" : "OPENED",
            fromState: existing.state,
            toState: existing.state,
            correlationId,
            occurredAt: at,
            metadata: { refresh: true },
          }),
          existing.rowVersion,
        );
        if (applied) refreshed += 1;
      }
    }

    // A signal that stopped firing auto-resolves, but only when the evidence is
    // trustworthy: an unreadable source is absence of data, not absence of fault.
    if (snapshot.sourcesComplete) {
      for (const stale of unmatched.values()) {
        const next: PlatformIncidentRecord = {
          ...stale,
          state: "RESOLVED",
          resolvedAt: at.toISOString(),
          autoResolvedAt: at.toISOString(),
          resolvedById: null,
          resolutionNote: "Signal stopped firing; auto-resolved by the alert evaluator.",
          rowVersion: stale.rowVersion + 1,
        };
        const applied = await this.incidents.apply(
          next,
          systemEvent({
            incidentId: stale.id,
            type: "AUTO_RESOLVED",
            fromState: stale.state,
            toState: "RESOLVED",
            correlationId,
            occurredAt: at,
            metadata: { ruleKey: stale.ruleKey },
          }),
          stale.rowVersion,
        );
        if (applied) autoResolved += 1;
      }
    }

    const activeAfter = (await this.incidents.listActive()).length;
    return platformIncidentEvaluationSchema.parse({
      evaluatedAt: at.toISOString(),
      ruleSetVersion: RULE_SET_VERSION,
      opened,
      reopened,
      severityChanged,
      refreshed,
      autoResolved,
      activeAfter,
    });
  }
}
