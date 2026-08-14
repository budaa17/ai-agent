import { useCallback, useEffect, useState } from "react";
import { fetchPublicPlans, type PublicPlanCatalog } from "../../api/public-billing";

export interface PublicPlansState {
  readonly catalog: PublicPlanCatalog | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly slow: boolean;
  readonly retry: () => void;
}

/**
 * Loads the published plan catalog once per mount.
 *
 * Shared by the landing page and the pricing page so both render the same
 * numbers from the same source. Duplicating the fetch would eventually mean
 * duplicating a formatting decision, and then the two pages would quote
 * different prices for the same plan.
 */
export function usePublicPlans(): PublicPlansState {
  const [catalog, setCatalog] = useState<PublicPlanCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, 6_000);

    fetchPublicPlans()
      .then((result) => {
        if (!cancelled) {
          setCatalog(result);
          setSlow(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Багцын мэдээлэл ачаалж чадсангүй");
          setSlow(false);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [requestVersion]);

  return { catalog, error, loading: catalog === null && error === null, slow, retry };
}
