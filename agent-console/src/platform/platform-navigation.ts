import {
  Activity,
  Bot,
  Building2,
  ClipboardCheck,
  CreditCard,
  FlaskConical,
  Gauge,
  KeyRound,
  ListChecks,
  ScrollText,
  ShieldAlert,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { PlatformPermission } from "../api/platform-schemas";

export interface PlatformNavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission: PlatformPermission;
  end: boolean;
}

export interface PlatformNavigationSection {
  label: string;
  items: readonly PlatformNavigationItem[];
}

export const platformNavigation: readonly PlatformNavigationSection[] = [
  {
    label: "CONTROL TOWER",
    items: [
      {
        label: "Control Tower",
        path: "/platform",
        icon: Gauge,
        permission: "PLATFORM_OVERVIEW_READ",
        end: true,
      },
      {
        label: "Инцидент",
        path: "/platform/incidents",
        icon: ShieldAlert,
        permission: "PLATFORM_OVERVIEW_READ",
        end: false,
      },
    ],
  },
  {
    label: "TENANT MANAGEMENT",
    items: [
      {
        label: "Компаниуд",
        path: "/platform/tenants",
        icon: Building2,
        permission: "PLATFORM_TENANT_HEALTH_READ",
        end: false,
      },
    ],
  },
  {
    label: "AI OPERATIONS",
    items: [
      {
        label: "Агент ба run-ууд",
        path: "/platform/agents",
        icon: Bot,
        permission: "PLATFORM_AGENT_HEALTH_READ",
        end: false,
      },
      {
        label: "Agent run-ууд",
        path: "/platform/agent-runs",
        icon: ListChecks,
        permission: "PLATFORM_AGENT_HEALTH_READ",
        end: false,
      },
      {
        label: "Review ба чанар",
        path: "/platform/review-quality",
        icon: ClipboardCheck,
        permission: "PLATFORM_REVIEW_MONITOR_READ",
        end: false,
      },
      {
        label: "AI чанар",
        path: "/platform/quality",
        icon: FlaskConical,
        permission: "PLATFORM_REVIEW_MONITOR_READ",
        end: false,
      },
    ],
  },
  {
    label: "PLATFORM",
    items: [
      {
        label: "Төлбөр",
        path: "/platform/billing",
        icon: CreditCard,
        permission: "PLATFORM_BILLING_READ",
        end: false,
      },
      {
        label: "Ашиглалт ба зардал",
        path: "/platform/usage",
        icon: WalletCards,
        permission: "PLATFORM_USAGE_READ",
        end: false,
      },
      {
        label: "Системийн төлөв",
        path: "/platform/system-health",
        icon: Activity,
        permission: "PLATFORM_SYSTEM_HEALTH_READ",
        end: false,
      },
      {
        label: "Дэмжлэгийн хандалт",
        path: "/platform/support-access",
        icon: KeyRound,
        permission: "PLATFORM_AUDIT_READ",
        end: false,
      },
      {
        label: "Audit log",
        path: "/platform/audit",
        icon: ScrollText,
        permission: "PLATFORM_AUDIT_READ",
        end: false,
      },
    ],
  },
] as const;

export function platformRoleLabel(role: string | undefined): string {
  switch (role) {
    case "PLATFORM_SUPER_ADMIN":
      return "Platform Super Admin";
    case "PLATFORM_OPERATOR":
      return "Platform Operator";
    case "PLATFORM_AUDITOR":
      return "Platform Auditor";
    default:
      return "Platform хэрэглэгч";
  }
}
