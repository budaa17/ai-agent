export type ProductionCalendar = {
  workingWeekdays: readonly number[];
  holidays: readonly string[];
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(date: string): Date {
  if (!isoDatePattern.test(date)) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  return parsed;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  const parsed = parseIsoDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatIsoDate(parsed);
}

export function compareIsoDates(left: string, right: string): number {
  return parseIsoDate(left).getTime() - parseIsoDate(right).getTime();
}

export function isoWeekday(date: string): number {
  const weekday = parseIsoDate(date).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function isWorkingDay(date: string, calendar: ProductionCalendar): boolean {
  return calendar.workingWeekdays.includes(isoWeekday(date)) && !calendar.holidays.includes(date);
}

export function nextWorkingDay(
  date: string,
  calendar: ProductionCalendar,
  includeCurrent = false,
): string {
  let current = includeCurrent ? date : addCalendarDays(date, 1);

  while (!isWorkingDay(current, calendar)) {
    current = addCalendarDays(current, 1);
  }

  return current;
}

export function previousWorkingDay(
  date: string,
  calendar: ProductionCalendar,
  includeCurrent = false,
): string {
  let current = includeCurrent ? date : addCalendarDays(date, -1);

  while (!isWorkingDay(current, calendar)) {
    current = addCalendarDays(current, -1);
  }

  return current;
}

export function addWorkingDays(date: string, days: number, calendar: ProductionCalendar): string {
  if (!Number.isInteger(days)) {
    throw new Error("Working-day offset must be an integer");
  }

  if (days === 0) {
    return isWorkingDay(date, calendar) ? date : nextWorkingDay(date, calendar, true);
  }

  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let current = date;

  while (remaining > 0) {
    current = addCalendarDays(current, direction);

    if (isWorkingDay(current, calendar)) {
      remaining -= 1;
    }
  }

  return current;
}

export function enumerateDates(start: string, end: string): string[] {
  if (compareIsoDates(start, end) > 0) {
    throw new Error("Date range start must not be after end");
  }

  const dates: string[] = [];
  let current = start;

  while (compareIsoDates(current, end) <= 0) {
    dates.push(current);
    current = addCalendarDays(current, 1);
  }

  return dates;
}

export function enumerateWorkingDates(
  start: string,
  end: string,
  calendar: ProductionCalendar,
): string[] {
  return enumerateDates(start, end).filter((date) => isWorkingDay(date, calendar));
}

export function workingDaysBetween(
  start: string,
  end: string,
  calendar: ProductionCalendar,
  inclusive = true,
): number {
  if (compareIsoDates(start, end) > 0) {
    return -workingDaysBetween(end, start, calendar, inclusive);
  }

  const count = enumerateWorkingDates(start, end, calendar).length;

  if (inclusive) {
    return count;
  }

  return count - (isWorkingDay(start, calendar) ? 1 : 0);
}
