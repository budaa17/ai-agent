import { phase9Sha256 } from "./security.js";

export interface PlatformOverviewSignalIdentityScope {
  tenantId: string | null;
  agentType: string | null;
  component: string | null;
}

/**
 * Stable across the derived-signal and persistent-incident implementations.
 * Keep the version and unit-separator encoding unchanged for overview.v1.
 */
export function platformOverviewSignalId(
  ruleKey: string,
  signalScope: PlatformOverviewSignalIdentityScope,
): string {
  return phase9Sha256(
    [
      "v1",
      ruleKey,
      signalScope.tenantId ?? "",
      signalScope.agentType ?? "",
      signalScope.component ?? "",
    ].join("\u001f"),
  );
}
