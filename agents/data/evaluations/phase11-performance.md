# BuildWatch v2.2 Phase 11 Performance

- Result: **PASS**
- Generated: 2026-08-06T17:27:05.507Z
- Runtime: v22.23.2 / win32 x64

| Case | p95 ms | Target ms | Samples | Result |
|---|---:|---:|---:|---|
| api-p95 | 16.11 | 250 | 40 | PASS |
| planning-50 | 12.742 | 500 | 10 | PASS |
| pdf-20-pages | 20.748 | 5000 | 3 | PASS |
| quantity-baseline | 42.461 | 1000 | 10 | PASS |
| dashboard-payload | 4.277 | 500 | 25 | PASS |
| nightly-batch | 882.614 | 30000 | 3 | PASS |
| artifact-25mb-scan | 33.97 | 3000 | 5 | PASS |

Machine-local results are a technical regression gate. The full release also requires a deployed load test under the production topology.
