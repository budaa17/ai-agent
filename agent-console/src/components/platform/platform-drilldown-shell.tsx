import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlatformListPage } from "../../api/platform-schemas";
import { Button, Card, ErrorState, Field, LoadingState, Select } from "../ui";
import { EnvelopeProblems, type PlatformProblem } from "./platform-presentation";

/**
 * URL-backed filter state. Keeping the filters in the query string is what lets
 * an operator share a drill-down view, and what makes the browser back button
 * behave like an undo for filtering.
 */
export function usePlatformSearchState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const values = useMemo(() => new URLSearchParams(searchKey), [searchKey]);

  const setValues = useCallback(
    (next: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchKey);
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value.length === 0) params.delete(key);
        else params.set(key, value);
      }
      setSearchParams(params, { replace: true });
    },
    [searchKey, setSearchParams],
  );

  return { searchKey, values, setValues };
}

export type RangeMode = "24h" | "7d" | "30d";

export function readRange(values: URLSearchParams): RangeMode {
  const value = values.get("window");
  return value === "7d" || value === "30d" ? value : "24h";
}

export function readOptional(
  values: URLSearchParams,
  key: string,
  maxLength: number,
): string | undefined {
  const value = values.get(key)?.trim();
  return value !== undefined && value.length > 0 && value.length <= maxLength ? value : undefined;
}

export function readEnum<T extends string>(
  values: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = values.get(key);
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export function RangeField({
  value,
  onChange,
}: {
  value: RangeMode;
  onChange: (value: RangeMode) => void;
}) {
  return (
    <Field label="Хугацаа">
      <Select value={value} onChange={(event) => onChange(event.target.value as RangeMode)}>
        <option value="24h">Сүүлийн 24 цаг</option>
        <option value="7d">Сүүлийн 7 хоног</option>
        <option value="30d">Сүүлийн 30 хоног</option>
      </Select>
    </Field>
  );
}

export function PlatformFilterForm({
  label,
  fetching,
  onApply,
  onReset,
  onRefresh,
  children,
}: {
  label: string;
  fetching: boolean;
  onApply: () => void;
  onReset: () => void;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply();
  };
  return (
    <form className="platform-filter-bar" aria-label={label} onSubmit={submit}>
      <div className="platform-filter-fields">{children}</div>
      <div className="platform-filter-actions">
        <Button type="submit">Filter хэрэглэх</Button>
        <Button type="button" variant="secondary" onClick={onReset}>
          <RotateCcw /> Цэвэрлэх
        </Button>
        <Button type="button" variant="ghost" disabled={fetching} onClick={onRefresh}>
          <RefreshCw className={fetching ? "animate-spin" : ""} />
          {fetching ? "Шинэчилж байна…" : "Шинэчлэх"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Keyset pages only move forward, so "back" replays the cursors this session
 * already visited rather than guessing a reverse cursor the server never issued.
 */
export function useCursorPager(resetKey: string) {
  const [state, setState] = useState<{ key: string; stack: string[] }>({
    key: resetKey,
    stack: [],
  });
  const stack = state.key === resetKey ? state.stack : [];
  const cursor = stack.at(-1);

  return {
    cursor,
    canGoBack: stack.length > 0,
    next: (nextCursor: string) =>
      setState({ key: resetKey, stack: [...stack, nextCursor] }),
    back: () => setState({ key: resetKey, stack: stack.slice(0, -1) }),
    reset: () => setState({ key: resetKey, stack: [] }),
  };
}

export function CursorPager({
  page,
  pager,
  itemCount,
}: {
  page: PlatformListPage;
  pager: ReturnType<typeof useCursorPager>;
  itemCount: number;
}) {
  return (
    <div className="platform-pager" role="navigation" aria-label="Хуудаслалт">
      <span className="muted">
        {itemCount} мөр · хуудсанд {page.limit} · эрэмбэ {page.sort} {page.order}
      </span>
      <div className="platform-pager-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={!pager.canGoBack}
          onClick={pager.back}
        >
          <ChevronLeft /> Өмнөх
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!page.hasMore || page.nextCursor === null}
          onClick={() => {
            if (page.nextCursor !== null) pager.next(page.nextCursor);
          }}
        >
          Дараах <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * One place that decides between loading, error and partial-but-usable, so no
 * drill-down page can accidentally render a blank panel as if it were empty.
 */
export function DrilldownStates({
  isPending,
  isError,
  error,
  retry,
  problems,
  loadingLabel,
  errorTitle,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  retry: () => void;
  problems: readonly PlatformProblem[] | undefined;
  loadingLabel: string;
  errorTitle: string;
}) {
  if (isPending) {
    return (
      <Card>
        <LoadingState label={loadingLabel} />
      </Card>
    );
  }
  if (isError) return <ErrorState title={errorTitle} error={error} retry={retry} />;
  return <EnvelopeProblems problems={problems ?? []} retry={retry} />;
}
