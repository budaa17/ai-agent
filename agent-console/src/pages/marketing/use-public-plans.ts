import { useEffect, useState } from "react";
import { fetchPublicPlans, type PublicPlanCatalog } from "../../api/public-billing";

export interface PublicPlansState {
  readonly catalog: PublicPlanCatalog | null;
  readonly error: string | null;
  readonly loading: boolean;
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

  useEffect(() => {
    let cancelled = false;
    fetchPublicPlans()
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Багцын мэдээлэл ачаалж чадсангүй");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalog, error, loading: catalog === null && error === null };
}
