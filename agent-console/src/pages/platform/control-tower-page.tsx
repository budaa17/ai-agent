import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { platformApi } from "../../api/platform-client";
import type { PlatformOverviewQuery } from "../../api/platform-schemas";
import {
  AgentHealthPanel,
  AttentionPanel,
  formatPlatformDateTime,
  OverviewLoadingPanels,
  OverviewProblems,
  PlatformKpiGrid,
  PlatformStatusPanel,
  RecentAuditPanel,
  SectionProblems,
  SystemHealthPanel,
  TenantHealthPanel,
} from "../../components/platform/platform-overview-panels";
import {
  overviewQueryFromSearchParams,
  overviewQueryToSearchParams,
  PlatformOverviewFilters,
} from "../../components/platform/platform-overview-filters";
import { ErrorState, PageHeading } from "../../components/ui";

export function ControlTowerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const activeQuery = useMemo(
    () => overviewQueryFromSearchParams(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const overview = useQuery({
    queryKey: ["platform", "overview", activeQuery],
    queryFn: () => platformApi.overview(activeQuery),
    retry: 1,
    staleTime: 15_000,
  });

  const applyFilters = (query: PlatformOverviewQuery) => {
    setSearchParams(overviewQueryToSearchParams(query), { replace: true });
  };
  const tenantOptions =
    overview.data?.tenantHealthPreview.items.map((tenant) => ({
      id: tenant.tenantId,
      name: tenant.name,
    })) ?? [];
  const agentOptions =
    overview.data?.agentHealthPreview.items.map((agent) => agent.agentType) ?? [];
  const retry = () => void overview.refetch();
  const problemsFor = (section: NonNullable<typeof overview.data>["problems"][number]["section"]) =>
    overview.data?.problems.filter((problem) => problem.section === section) ?? [];

  return (
    <>
      <PageHeading
        eyebrow="PLATFORM OPERATIONS"
        title="Control Tower"
        description="Tenant, AI agent, review болон платформын техникийн төлөвийг backend-ийн deterministic дүрэм, freshness болон sample context-тэй нь хянана."
        actions={
          overview.data === undefined ? undefined : (
            <div className="platform-refresh-meta" aria-live="polite">
              <span>Үүсгэсэн: {formatPlatformDateTime(overview.data.generatedAt)}</span>
              <small>As of: {formatPlatformDateTime(overview.data.asOf)}</small>
            </div>
          )
        }
      />

      <PlatformOverviewFilters
        key={searchKey}
        query={activeQuery}
        tenantOptions={tenantOptions}
        agentOptions={agentOptions}
        fetching={overview.isFetching}
        onApply={applyFilters}
        onRefresh={retry}
      />

      {overview.isPending ? <OverviewLoadingPanels /> : null}
      {overview.isError ? (
        <ErrorState
          title="Control Tower өгөгдөл ачаалсангүй"
          error={overview.error}
          retry={retry}
        />
      ) : null}

      {overview.data !== undefined ? (
        <div className="platform-overview-stack">
          {overview.data.partial ? (
            <OverviewProblems problems={overview.data.problems} retry={retry} />
          ) : null}
          <PlatformStatusPanel overview={overview.data} />
          <PlatformKpiGrid
            problems={overview.data.problems}
            kpis={overview.data.kpis}
            retry={retry}
          />
          <div className="platform-overview-primary-grid">
            <AttentionPanel attention={overview.data.attention} />
            <div className="platform-panel-stack">
              <SectionProblems problems={problemsFor("SYSTEM")} retry={retry} />
              <SystemHealthPanel system={overview.data.systemHealth} />
            </div>
          </div>
          <div className="platform-panel-stack">
            <SectionProblems problems={problemsFor("TENANTS")} retry={retry} />
            <TenantHealthPanel preview={overview.data.tenantHealthPreview} />
          </div>
          <div className="platform-panel-stack">
            <SectionProblems problems={problemsFor("AGENTS")} retry={retry} />
            <AgentHealthPanel preview={overview.data.agentHealthPreview} />
          </div>
          <div className="platform-panel-stack">
            <SectionProblems problems={problemsFor("AUDIT")} retry={retry} />
            <RecentAuditPanel audit={overview.data.recentAudit} />
          </div>
        </div>
      ) : null}
    </>
  );
}
