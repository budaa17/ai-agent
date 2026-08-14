import {
  AlertTriangle,
  Boxes,
  ClipboardCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

/**
 * Navigation answers a different question from permissions.
 *
 *   Backend  — can this user reach this resource?
 *   Frontend — does this user need this screen to do their job?
 *
 * So the sidebar is not a projection of the permission set. Agent codes
 * (A0…A5) stay in the architecture and never reach a menu label, entries are
 * ordered by the work each role actually does, and roles that share a screen
 * may name it differently because they come to it for different reasons.
 *
 * Permissions still gate every entry — this only decides which of the screens a
 * role *may* open are worth putting in front of them.
 */

export type NavEntry = {
  /** Route segment under /projects/:projectId, "" for the project root. */
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission: string;
};

const ENTRIES = {
  home: { path: "", label: "Нүүр", icon: LayoutDashboard, permission: "PROJECT_READ" },
  decisions: { path: "inbox", label: "Миний шийдвэрүүд", icon: Inbox, permission: "PROJECT_READ" },
  today: { path: "field", label: "Өнөөдөр", icon: ClipboardCheck, permission: "PLAN_READ" },
  sync: { path: "sync", label: "Sync дараалал", icon: RefreshCw, permission: "REPORT_SUBMIT" },
  materials: { path: "materials", label: "Материал", icon: Package, permission: "INVENTORY_READ" },
  design: { path: "a0", label: "Зураг төсөл ба төсөв", icon: Boxes, permission: "DESIGN_READ" },
  reports: { path: "a1", label: "Тайлан", icon: Sparkles, permission: "REPORT_READ" },
  risk: { path: "a2", label: "Эрсдэл ба прогноз", icon: TrendingDown, permission: "FORECAST_READ" },
  documents: { path: "a3", label: "Баримт бичиг", icon: FileText, permission: "REPORT_READ" },
  ask: { path: "a4", label: "Лавлагаа", icon: ShieldCheck, permission: "CHAT_READ" },
  progress: { path: "a5", label: "Төслийн явц", icon: ClipboardCheck, permission: "PLAN_READ" },
  alerts: { path: "alerts", label: "Анхааруулга", icon: AlertTriangle, permission: "PROJECT_READ" },
} as const satisfies Record<string, NavEntry>;

type EntryKey = keyof typeof ENTRIES;

/**
 * Same screen, different job. An engineer opens the review queue to check work;
 * a manager opens it to decide. Naming it after the reason they came keeps the
 * menu in the reader's language rather than the system's.
 */
const LABEL_OVERRIDES: Readonly<Partial<Record<string, Partial<Record<EntryKey, string>>>>> = {
  ENGINEER: {
    decisions: "Шалгах зүйлс",
    progress: "Гүйцэтгэл баталгаажуулах",
    reports: "Талбайн тайлан",
  },
  SITE_SUPERVISOR: {
    reports: "Миний тайлангууд",
    documents: "Баримт",
  },
  STOREKEEPER: {
    materials: "Материалын хэрэгцээ",
    progress: "Өнөөдрийн олголт",
  },
  OBSERVER: {
    progress: "Явц",
    design: "Батлагдсан төсөв",
    reports: "Фото тайлан",
  },
  COMPANY_ADMIN: { decisions: "Хүлээгдэж буй шийдвэр" },
  SUPER_ADMIN: { decisions: "Хүлээгдэж буй шийдвэр" },
};

/**
 * The sidebar lists only the screens where a role *starts* work. Anything they
 * merely read is reached by a link from the screen that raised it — an alert
 * from the dashboard, a draft from the decision queue.
 *
 * That rule is what keeps these lists at two to five entries. A menu long
 * enough to need scanning has already failed the person holding the phone.
 */
const ORDER: Readonly<Record<string, readonly EntryKey[]>> = {
  // Configures the system; joins the project loop only to unblock it.
  SUPER_ADMIN: ["home", "decisions", "design", "materials"],
  COMPANY_ADMIN: ["home", "decisions", "design", "materials"],
  // "Юуг одоо шийдэх хэрэгтэй вэ?"
  PROJECT_MANAGER: ["decisions", "home", "progress", "risk", "documents"],
  // "Мэдүүлсэн гүйцэтгэл техникийн хувьд үнэн зөв үү?"
  ENGINEER: ["design", "decisions", "progress", "risk"],
  // "Өнөөдөр юу хийх вэ?" — one thumb, four destinations.
  SITE_SUPERVISOR: ["today", "reports", "materials", "documents"],
  // The narrowest job in the system, and the whole schedule leans on it.
  STOREKEEPER: ["materials", "progress"],
  // Reads only. No queue, no alerts, nothing to act on.
  OBSERVER: ["home", "progress", "design", "documents", "ask"],
};

const DEFAULT_ORDER: readonly EntryKey[] = [
  "home",
  "design",
  "progress",
  "reports",
  "documents",
  "alerts",
];

/** Where a role lands after choosing a project, as a route segment. */
const LANDING: Readonly<Record<string, string>> = {
  SUPER_ADMIN: "",
  COMPANY_ADMIN: "",
  PROJECT_MANAGER: "inbox",
  ENGINEER: "a0",
  SITE_SUPERVISOR: "field",
  STOREKEEPER: "materials",
  OBSERVER: "",
};

export const ROLE_TITLES: Readonly<Record<string, string>> = {
  SUPER_ADMIN: "Платформ администратор",
  COMPANY_ADMIN: "Компанийн администратор",
  PROJECT_MANAGER: "Төслийн менежер",
  ENGINEER: "Инженер · ПТО",
  SITE_SUPERVISOR: "Талбайн ахлагч",
  STOREKEEPER: "Нярав",
  OBSERVER: "Ажиглагч",
};

export function navigationForRole(
  role: string | undefined,
  hasPermission: (permission: string) => boolean,
): readonly NavEntry[] {
  const order = (role === undefined ? undefined : ORDER[role]) ?? DEFAULT_ORDER;
  const overrides = role === undefined ? undefined : LABEL_OVERRIDES[role];
  return order
    .filter((key) => hasPermission(ENTRIES[key].permission))
    .map((key) => {
      const entry = ENTRIES[key];
      const label = overrides?.[key];
      return label === undefined ? entry : { ...entry, label };
    });
}

/** The offline queue only earns a menu slot while something is waiting in it. */
export function syncEntry(hasPermission: (permission: string) => boolean): NavEntry | null {
  return hasPermission(ENTRIES.sync.permission) ? ENTRIES.sync : null;
}

/**
 * The landing segment a role should open, falling back to the first navigation
 * entry it can actually reach so nobody lands on a page they cannot read.
 */
export function landingPathForRole(
  role: string | undefined,
  hasPermission: (permission: string) => boolean,
): string {
  const preferred = role === undefined ? undefined : LANDING[role];
  if (preferred !== undefined) {
    const entry = Object.values(ENTRIES).find((candidate) => candidate.path === preferred);
    if (entry !== undefined && hasPermission(entry.permission)) return preferred;
  }
  return navigationForRole(role, hasPermission)[0]?.path ?? "";
}

export function roleTitle(role: string | undefined): string {
  if (role === undefined) return "";
  return ROLE_TITLES[role] ?? role.replaceAll("_", " ");
}
