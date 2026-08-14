# BuildWatch v2.2 Phase 8 evaluation

- Status: **PASS**
- Tool definitions: 26
- Tool coverage: 100.00%
- A0 tool coverage: 100.00%
- A5 tool coverage: 100.00%
- Numeric hallucinations: 0
- Unauthorized sources: 0
- Unauthorized object disclosures: 0
- Tenant-isolation violations: 0
- Unsigned artifact leaks: 0
- Catalog-scope leaks: 0
- Baseline mutations: 0
- Golden cases: 10/10
- Adversarial cases: 10/10
- Deterministic replay: PASS
- LLM-off core: PASS
- Run version persistence: PASS

## Cases

- [x] a0-document-classification (GOLDEN) — A0 classified authorized design documents through signed-read bounded tools.
- [x] a0-element-candidate (GOLDEN) — A0 matched reviewed element candidates to the authorized extraction set.
- [x] a0-scale-safety (GOLDEN) — Only engineer-verified scale reached deterministic metric quantity.
- [x] a0-quantity-source-grounding (GOLDEN) — Quantity replay remained source-backed with zero unauthorized sources.
- [x] a5-planning (GOLDEN) — A5 eligibility, priority, target, and conflict logic ran deterministically.
- [x] a5-photo-verification (GOLDEN) — Signed photo metadata and deterministic verification were joined.
- [x] a5-forecast (GOLDEN) — Rolling productivity and projected finish were available from deterministic services.
- [x] a5-recovery (GOLDEN) — Recovery impacts remained advisory and did not mutate the baseline.
- [x] tenant-isolation (GOLDEN) — No private-tenant marker appeared in either orchestration result.
- [x] llm-off-fallback (GOLDEN) — A0/A5 core completed without an LLM or API quota.
- [x] unverified-scale-block (ADVERSARIAL) — Removing verified scale blocked every metric quantity and downstream draft.
- [x] cross-tenant-nondisclosure (ADVERSARIAL) — An assigned project ID in another tenant returned no object or existence marker.
- [x] project-assignment-denial (ADVERSARIAL) — Unassigned project access failed with the same non-disclosing error.
- [x] role-permission-denial (ADVERSARIAL) — Role policy denied estimator cost tooling to a site-engineer-only context.
- [x] cost-permission-denial (ADVERSARIAL) — Missing cost permission denied price data.
- [x] report-text-permission-denial (ADVERSARIAL) — Missing report-text permission denied daily actual data.
- [x] unsigned-artifact-denial (ADVERSARIAL) — Design artifact records disappeared when no valid signed-read grant was present.
- [x] catalog-scope-denial (ADVERSARIAL) — Catalog records outside the explicit source catalog scope were hidden.
- [x] version-asof-source-limit (ADVERSARIAL) — Version/as-of/item/source bounds were enforced before tool output.
- [x] read-only-repository (ADVERSARIAL) — Mutating one returned object did not mutate repository state.
