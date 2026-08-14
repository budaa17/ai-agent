export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat("mn-MN", {
    style: "currency",
    currency: "MNT",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: unknown, maximumFractionDigits = 1): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("mn-MN", { maximumFractionDigits }).format(amount);
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("mn-MN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function entityString(entity: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = entity[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "—";
}

export function entityNumber(entity: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(entity[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function entityBoolean(entity: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => entity[key] === true);
}

/**
 * Catalogue rows are tenant-scoped and never reach the project workspace, so
 * plan lines only carry an id like `khud-a1-mat-mat-rbr-a3`. Until the payload
 * includes material names, show the catalogue code rather than the raw key.
 */
export function materialCode(id: string): string {
  const match = /^[a-z0-9-]+?-mat-(.+)$/u.exec(id);
  return (match?.[1] ?? id).toLocaleUpperCase("en-US");
}

export function todayIso(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}
