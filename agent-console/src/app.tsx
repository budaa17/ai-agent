import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { RequireAuth, RequirePermission } from "./auth/route-guards";
import { RequirePlatformAuth, RequirePlatformPermission } from "./auth/platform-route-guards";
import { A0Page } from "./pages/a0-page";
import { A1Page } from "./pages/a1-page";
import { A2Page } from "./pages/a2-page";
import { A3Page } from "./pages/a3-page";
import { A4Page } from "./pages/a4-page";
import { A5Page } from "./pages/a5-page";
import { AdminPage } from "./pages/admin-page";
import { AlertsPage } from "./pages/alerts-page";
import { BillingPage } from "./pages/billing-page";
import { DashboardPage } from "./pages/dashboard-page";
import { FieldPage } from "./pages/field-page";
import { FieldReportPage } from "./pages/field-report-page";
import { InboxPage } from "./pages/inbox-page";
import { MaterialsPage } from "./pages/materials-page";
import { SyncPage } from "./pages/sync-page";
import { LoadingState } from "./components/ui";
import { LoginPage } from "./pages/login-page";
import { RegisterPage } from "./pages/register-page";
import { NotFoundPage } from "./pages/not-found-page";
import { ProjectsPage } from "./pages/projects-page";
import { PlatformShell } from "./platform/platform-shell";
import { ControlTowerPage } from "./pages/platform/control-tower-page";
import { PlatformAgentDetailPage } from "./pages/platform/agent-detail-page";
import { PlatformAgentRunDiagnosticsPage } from "./pages/platform/agent-run-diagnostics-page";
import { PlatformAgentRunsPage } from "./pages/platform/agent-runs-page";
import { PlatformAgentsPage } from "./pages/platform/agents-page";
import { PlatformAuditPage } from "./pages/platform/audit-page";
import { PlatformBillingPage } from "./pages/platform/billing-page";
import { PlatformIncidentDetailPage } from "./pages/platform/incident-detail-page";
import { PlatformIncidentsPage } from "./pages/platform/incidents-page";
import { PlatformQualityPage } from "./pages/platform/quality-page";
import { PlatformSupportAccessDetailPage } from "./pages/platform/support-access-detail-page";
import { PlatformSupportAccessPage } from "./pages/platform/support-access-page";
import { PlatformLoginPage } from "./pages/platform/platform-login-page";
import { PlatformReviewQualityPage } from "./pages/platform/review-quality-page";
import { PlatformSystemHealthPage } from "./pages/platform/system-health-page";
import { PlatformTenantHealthPage } from "./pages/platform/tenant-health-page";
import { PlatformTenantsPage } from "./pages/platform/tenants-page";
import { PlatformUsagePage } from "./pages/platform/usage-page";

// Lazy-loaded: @gorules/jdm-editor bundles Ant Design, which we don't want
// pulled into every route's chunk in a Tailwind-based console.
const RulesPage = lazy(() =>
  import("./pages/rules-page").then((module) => ({ default: module.RulesPage })),
);

// Marketing routes are lazy so a signed-in user never downloads them, and a
// visitor never downloads the workspace (landing-page-roadmap.md §11.2, §15.3).
const MarketingShell = lazy(() =>
  import("./marketing/marketing-shell").then((module) => ({ default: module.MarketingShell })),
);
const LandingPage = lazy(() =>
  import("./pages/marketing/landing-page").then((module) => ({ default: module.LandingPage })),
);
const PricingPage = lazy(() =>
  import("./pages/marketing/pricing-page").then((module) => ({ default: module.PricingPage })),
);
const CompanySignupPage = lazy(() =>
  import("./pages/marketing/company-signup-page").then((module) => ({
    default: module.CompanySignupPage,
  })),
);
const CheckoutSuccessPage = lazy(() =>
  import("./pages/marketing/checkout-success-page").then((module) => ({
    default: module.CheckoutSuccessPage,
  })),
);
const FeaturesPage = lazy(() =>
  import("./pages/marketing/static-pages").then((module) => ({ default: module.FeaturesPage })),
);
const SecurityPage = lazy(() =>
  import("./pages/marketing/static-pages").then((module) => ({ default: module.SecurityPage })),
);
const ContactPage = lazy(() =>
  import("./pages/marketing/static-pages").then((module) => ({ default: module.ContactPage })),
);
const TermsPage = lazy(() =>
  import("./pages/marketing/static-pages").then((module) => ({ default: module.TermsPage })),
);
const PrivacyPage = lazy(() =>
  import("./pages/marketing/static-pages").then((module) => ({ default: module.PrivacyPage })),
);

export function App() {
  return (
    <Routes>
      {/* Public marketing. Registered before the authenticated tree so a
          visitor reaches the landing page without a redirect to sign in. */}
      <Route
        element={
          <Suspense fallback={<LoadingState />}>
            <MarketingShell />
          </Suspense>
        }
      >
        <Route path="/" element={<LandingPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/company-signup" element={<CompanySignupPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/platform/login" element={<PlatformLoginPage />} />
      <Route element={<RequirePlatformAuth />}>
        <Route path="/platform" element={<PlatformShell />}>
          <Route element={<RequirePlatformPermission permission="PLATFORM_OVERVIEW_READ" />}>
            <Route index element={<ControlTowerPage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_TENANT_HEALTH_READ" />}>
            <Route path="tenants" element={<PlatformTenantsPage />} />
            <Route path="tenants/:tenantId/health" element={<PlatformTenantHealthPage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_AGENT_HEALTH_READ" />}>
            <Route path="agents" element={<PlatformAgentsPage />} />
            <Route path="agents/:agentType" element={<PlatformAgentDetailPage />} />
            <Route path="agent-runs" element={<PlatformAgentRunsPage />} />
          </Route>
          <Route
            element={<RequirePlatformPermission permission="PLATFORM_AGENT_RUN_DIAGNOSTICS_READ" />}
          >
            <Route
              path="agent-runs/:runId/diagnostics"
              element={<PlatformAgentRunDiagnosticsPage />}
            />
          </Route>
          {/* Reading incidents needs only overview permission; acting on one
              is re-checked server-side against PLATFORM_INCIDENT_MANAGE. */}
          <Route element={<RequirePlatformPermission permission="PLATFORM_OVERVIEW_READ" />}>
            <Route path="incidents" element={<PlatformIncidentsPage />} />
            <Route path="incidents/:incidentId" element={<PlatformIncidentDetailPage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_REVIEW_MONITOR_READ" />}>
            <Route path="review-quality" element={<PlatformReviewQualityPage />} />
            <Route path="quality" element={<PlatformQualityPage />} />
          </Route>
          {/* Reading the grant trail is an audit concern; requesting or deciding
              is re-checked server-side against PLATFORM_SUPPORT_ACCESS_GRANT. */}
          <Route element={<RequirePlatformPermission permission="PLATFORM_AUDIT_READ" />}>
            <Route path="support-access" element={<PlatformSupportAccessPage />} />
            <Route path="support-access/:grantId" element={<PlatformSupportAccessDetailPage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_BILLING_READ" />}>
            <Route path="billing" element={<PlatformBillingPage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_USAGE_READ" />}>
            <Route path="usage" element={<PlatformUsagePage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_SYSTEM_HEALTH_READ" />}>
            <Route path="system-health" element={<PlatformSystemHealthPage />} />
          </Route>
          <Route element={<RequirePlatformPermission permission="PLATFORM_AUDIT_READ" />}>
            <Route path="audit" element={<PlatformAuditPage />} />
          </Route>
        </Route>
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* No index route here. `/` is the public landing page, and an index
              route inside the authenticated tree outranks it in React Router's
              matcher — which sent every visitor to the sign-in screen. A signed-in
              person reaches the workspace from the header instead. */}
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<DashboardPage />} />
          {/* Decision queue: every role can read it, the queue itself filters. */}
          <Route path="projects/:projectId/inbox" element={<InboxPage />} />
          <Route element={<RequirePermission permission="DESIGN_READ" />}>
            <Route path="projects/:projectId/a0" element={<A0Page />} />
          </Route>
          <Route element={<RequirePermission permission="PLAN_READ" />}>
            <Route path="projects/:projectId/field" element={<FieldPage />} />
          </Route>
          <Route element={<RequirePermission permission="REPORT_SUBMIT" />}>
            <Route path="projects/:projectId/field/:planItemId" element={<FieldReportPage />} />
            <Route path="projects/:projectId/sync" element={<SyncPage />} />
          </Route>
          <Route element={<RequirePermission permission="INVENTORY_READ" />}>
            <Route path="projects/:projectId/materials" element={<MaterialsPage />} />
          </Route>
          <Route element={<RequirePermission permission="REPORT_READ" />}>
            <Route path="projects/:projectId/a1" element={<A1Page />} />
            <Route path="projects/:projectId/a3" element={<A3Page />} />
          </Route>
          <Route element={<RequirePermission permission="FORECAST_READ" />}>
            <Route path="projects/:projectId/a2" element={<A2Page />} />
          </Route>
          <Route element={<RequirePermission permission="CHAT_READ" />}>
            <Route path="projects/:projectId/a4" element={<A4Page />} />
          </Route>
          <Route element={<RequirePermission permission="PLAN_READ" />}>
            <Route path="projects/:projectId/a5" element={<A5Page />} />
          </Route>
          <Route path="projects/:projectId/alerts" element={<AlertsPage />} />
          <Route element={<RequirePermission permission="TENANT_ADMIN" />}>
            <Route path="admin" element={<AdminPage />} />
          </Route>
          {/* Billing stays reachable while the workspace is gated, so it is
              guarded by its own permission rather than by TENANT_ADMIN. */}
          <Route element={<RequirePermission permission="TENANT_BILLING_READ" />}>
            <Route path="admin/billing" element={<BillingPage />} />
          </Route>
          <Route element={<RequirePermission permission="RULES_MANAGE" />}>
            <Route
              path="admin/rules"
              element={
                <Suspense fallback={<LoadingState label="Дүрмийн засварлагч ачаалж байна…" />}>
                  <RulesPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
