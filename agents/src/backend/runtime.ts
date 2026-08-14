import type { PrismaClient } from "@prisma/client";
import { createPhase9Api } from "./api.js";
import { Phase9ArtifactService } from "./artifact-service.js";
import { Phase9AuthService } from "./auth-service.js";
import { Phase9ApprovedCommandService } from "./command-service.js";
import type { Phase9BackendConfig } from "./config.js";
import { LocalPhase9ObjectStore } from "./object-store.js";
import { PrismaPhase9Store } from "./prisma-store.js";
import { Phase9ProjectService } from "./project-service.js";
import { Phase9ReviewService } from "./review-service.js";
import { Phase9RulesService } from "./rules-service.js";
import { Phase9TokenService, phase9Sha256 } from "./security.js";
import { PlatformTokenService } from "./platform-security.js";
import { PlatformAuthService } from "./platform-auth-service.js";
import { PrismaPlatformStore } from "./platform-store.js";
import { PrismaPlatformOverviewReadModel } from "./platform-overview-read-model.js";
import { PlatformOverviewService } from "./platform-overview-service.js";
import { PrismaPlatformDrilldownReadModel } from "./platform-drilldown-read-model.js";
import { PlatformDrilldownService } from "./platform-drilldown-service.js";
import { PrismaPlatformIncidentStore } from "./platform-incident-store.js";
import { PlatformIncidentService } from "./platform-incident-service.js";
import { PlatformAlertEvaluator } from "./platform-alert-evaluator.js";
import { PrismaPlatformQualityReadModel } from "./platform-quality-read-model.js";
import { PlatformQualityService } from "./platform-quality-service.js";
import { PrismaPlatformSupportAccessStore } from "./platform-support-access-store.js";
import { PlatformSupportAccessService } from "./platform-support-access-service.js";
import { TenantAccessPolicy } from "./tenant-access-policy.js";
import { PrismaTenantAccessSnapshotReader } from "./tenant-access-store.js";
import { resolveBillingConfig, resolveBillingPublicAppBaseUrl } from "./billing-config.js";
import {
  BillingCheckoutService,
  createBillingProviders,
  PrismaCheckoutIdempotencyStore,
} from "./billing-checkout-service.js";
import { PrismaBillingPriceResolver } from "./billing-price-resolver.js";
import { PrismaPublicPlanCatalog } from "./billing-public-catalog.js";
import { CompanySignupService } from "./billing-signup-service.js";
import { BillingWebhookService } from "./billing-webhook-service.js";
import { PrismaTenantUsageReader, TenantBillingService } from "./tenant-billing-service.js";
import { PlatformBillingService } from "./platform-billing-service.js";
import { createMailer, resolveSmtpConfig } from "./mailer.js";
import { createTenantLimitReservation } from "./tenant-limit-reservation.js";
import { LocalPhase10ArtifactStorage, Phase10FrontendService } from "./phase10-service.js";
import { Phase10A0IntakeService } from "./a0-intake-service.js";
import { createPhase11ArtifactSecurity } from "./phase11-artifact-security.js";
import { collectPhase11OperationalGauges } from "./phase11-observability.js";
import {
  AgentOperationalMetrics,
  createAgentLogger,
  startSentryErrorReporter,
} from "../runtime/logging.js";

export function createPhase9ProductionRuntime(client: PrismaClient, config: Phase9BackendConfig) {
  const logger = createAgentLogger({ service: "buildwatch-api" });
  const errorReporter = startSentryErrorReporter();
  const metrics = new AgentOperationalMetrics();
  const store = new PrismaPhase9Store(client);
  const tokens = new Phase9TokenService({
    secret: config.jwtSecret,
    issuer: "buildwatch-api",
    audience: "buildwatch-web",
  });
  const auth = new Phase9AuthService(store, tokens);
  const platformStore = new PrismaPlatformStore(client);
  const platformTokens = new PlatformTokenService({ secret: config.jwtSecret });
  const platformAuth = new PlatformAuthService(
    platformStore,
    platformTokens,
    undefined,
    undefined,
    config.requirePlatformMfa,
  );
  const platformOverviewReadModel = new PrismaPlatformOverviewReadModel(client);
  const platformIncidentStore = new PrismaPlatformIncidentStore(client);
  const platformOverview = new PlatformOverviewService(
    platformOverviewReadModel,
    undefined,
    platformIncidentStore,
  );
  const platformDrilldown = new PlatformDrilldownService({
    drilldown: new PrismaPlatformDrilldownReadModel(client),
    overview: platformOverviewReadModel,
  });
  const platformIncidents = new PlatformIncidentService({
    incidents: platformIncidentStore,
    audit: platformStore,
    credentials: {
      passwordHash: async (principalId) =>
        (
          await client.platformCredential.findUnique({
            where: { principalId },
            select: { passwordHash: true },
          })
        )?.passwordHash ?? null,
    },
  });
  const platformAlertEvaluator = new PlatformAlertEvaluator({
    overview: platformOverview,
    incidents: platformIncidentStore,
  });
  const platformQuality = new PlatformQualityService(new PrismaPlatformQualityReadModel(client));
  const platformSupportAccess = new PlatformSupportAccessService({
    grants: new PrismaPlatformSupportAccessStore(client),
    audit: platformStore,
  });
  const tenantAccess = new TenantAccessPolicy(
    new PrismaTenantAccessSnapshotReader(client, logger),
    { metrics, logger },
  );
  // Billing channels are resolved from the environment and validated at startup:
  // a sandbox key or a non-Stripe provider in production fails here rather than
  // during someone's first real payment (roadmap-subscription Phase 1).
  const billingConfig = resolveBillingConfig();
  const billingPublicAppBaseUrl = resolveBillingPublicAppBaseUrl(billingConfig);
  const billingProviders = createBillingProviders({
    config: billingConfig,
    manualInstructionsBaseUrl: `${billingPublicAppBaseUrl}/company-signup`,
  });
  const billingPriceResolver = new PrismaBillingPriceResolver(client);
  const publicPlans = new PrismaPublicPlanCatalog(client);
  const billingCheckout = new BillingCheckoutService({
    config: billingConfig,
    providers: billingProviders,
    priceResolver: billingPriceResolver,
    idempotency: new PrismaCheckoutIdempotencyStore(client),
  });
  // A configured SMTP transport is what turns a paid signup into an account the
  // buyer can actually use; without one the password link has nowhere to go.
  const smtpConfig = resolveSmtpConfig();
  if (config.nodeEnv === "production" && smtpConfig === null) {
    throw new Error(
      "Refusing to start: production company signup requires SMTP_HOST and SMTP_FROM",
    );
  }
  const mailer = createMailer({
    config: smtpConfig,
    logger,
    production: config.nodeEnv === "production",
  });
  const billingSignups = new CompanySignupService({
    client,
    checkout: billingCheckout,
    provider: billingConfig.provider,
    successUrl: `${billingPublicAppBaseUrl}/checkout/success`,
    publicBaseUrl: billingPublicAppBaseUrl,
    verificationSecret: config.emailVerificationSecret,
    mailer,
    nodeEnv: config.nodeEnv,
    logger,
  });
  const billingWebhooks = new BillingWebhookService({
    client,
    providers: billingProviders,
    priceResolver: billingPriceResolver,
    environment: billingConfig.environment,
    accessPolicy: tenantAccess,
    provisioner: billingSignups,
    mailer,
    publicBaseUrl: config.publicBaseUrl,
    logger,
    metrics,
  });
  const platformBilling = new PlatformBillingService({ client, accessPolicy: tenantAccess });
  const tenantUsage = new PrismaTenantUsageReader(client);
  const tenantLimits = createTenantLimitReservation({ policy: tenantAccess });
  const tenantBilling = new TenantBillingService({
    client,
    usage: tenantUsage,
    providers: billingProviders,
    accessPolicy: tenantAccess,
  });
  const projects = new Phase9ProjectService(store, config.cursorSecret);
  const commands = new Phase9ApprovedCommandService(store);
  const reviews = new Phase9ReviewService(store);
  const rules = new Phase9RulesService(client);
  const artifacts = new Phase9ArtifactService(
    store,
    config.artifactSigningSecret,
    config.publicBaseUrl,
  );
  const objectStore = new LocalPhase9ObjectStore(config.artifactRoot);
  const a0Intake = new Phase10A0IntakeService(client, projects, {
    read: (asset) => objectStore.read(asset as never),
  });
  const frontend = new Phase10FrontendService(
    client,
    projects,
    new LocalPhase10ArtifactStorage(config.artifactRoot),
    undefined,
    createPhase11ArtifactSecurity({
      maxBytes: config.maxArtifactBytes,
      clamAv:
        config.clamAvHost === null
          ? null
          : {
              host: config.clamAvHost,
              port: config.clamAvPort,
              timeoutMs: config.clamAvTimeoutMs,
            },
    }),
    a0Intake,
    { read: (asset) => objectStore.read(asset as never) },
    tenantLimits,
  );
  // One list, used both to build the API and to expose the services. Keeping two
  // copies in sync by hand is how the subscription access gate silently went
  // missing from the served app while still appearing in the returned object.
  const services = {
    auth,
    platformAuth,
    platformOverview,
    platformDrilldown,
    platformIncidents,
    platformQuality,
    platformSupportAccess,
    platformBilling,
    tenantAccess,
    billingWebhooks,
    billingSignups,
    publicPlans,
    tenantBilling,
    tenantUsage,
    invitationLookup: async (token: string) => {
      const invitation = await client.tenantInvitation.findUnique({
        where: { tokenHash: phase9Sha256(token) },
        select: { tenantId: true },
      });
      return invitation?.tenantId ?? null;
    },
    projects,
    commands,
    reviews,
    artifacts,
    objectStore,
    frontend,
    rules,
  } satisfies Partial<Parameters<typeof createPhase9Api>[0]>;

  const app = createPhase9Api(
    {
      ...services,
      readiness: async () => {
        try {
          await client.$queryRaw`SELECT 1`;
          return true;
        } catch {
          return false;
        }
      },
      operationalGauges: () => collectPhase11OperationalGauges(client),
    },
    {
      nodeEnv: config.nodeEnv,
      trustProxyHops: config.trustProxyHops,
      rateLimitWindowMs: config.apiRateLimitWindowMs,
      apiRateLimitMaxRequests: config.apiRateLimitMaxRequests,
      authRateLimitMaxRequests: config.authRateLimitMaxRequests,
      maxArtifactBytes: config.maxArtifactBytes,
      metricsToken: config.metricsToken,
      logger,
      errorReporter,
      metrics,
    },
  );
  return {
    app,
    store,
    tokens,
    platformStore,
    platformTokens,
    platformIncidentStore,
    platformAlertEvaluator,
    logger,
    errorReporter,
    metrics,
    billing: {
      config: billingConfig,
      providers: billingProviders,
      priceResolver: billingPriceResolver,
    },
    services,
  };
}
