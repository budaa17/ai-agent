# BuildWatch v2.2 Phase 5 Forecast Evaluation

- Gate: **PASS**
- Cases: **32**
- Finish MAE: **0.00 working days**
- Critical-delay recall: **100.00%**
- Average early warning: **14.52 working days**
- False-alert rate: **0.00%**
- Source coverage: **100.00%**
- Deterministic replay: **100.00%**
- Recovery coverage: **100.00%**
- Baseline mutations: **0**

| Case | Scenario | Expected | Predicted | Finish error | Warning lead | Result |
|---|---|---:|---:|---:|---:|---:|
| phase5-forecast-01 | DELAY_-3 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-02 | DELAY_-2 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-03 | DELAY_-1 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-04 | DELAY_0 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-05 | DELAY_0 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-06 | DELAY_0 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-07 | DELAY_1 | AT_RISK | AT_RISK | 0 | 22 | PASS |
| phase5-forecast-08 | DELAY_2 | AT_RISK | AT_RISK | 0 | 21 | PASS |
| phase5-forecast-09 | DELAY_3 | AT_RISK | AT_RISK | 0 | 20 | PASS |
| phase5-forecast-10 | DELAY_4 | AT_RISK | AT_RISK | 0 | 19 | PASS |
| phase5-forecast-11 | DELAY_5 | AT_RISK | AT_RISK | 0 | 18 | PASS |
| phase5-forecast-12 | DELAY_5 | AT_RISK | AT_RISK | 0 | 18 | PASS |
| phase5-forecast-13 | DELAY_6 | LIKELY_LATE | LIKELY_LATE | 0 | 17 | PASS |
| phase5-forecast-14 | DELAY_7 | LIKELY_LATE | LIKELY_LATE | 0 | 16 | PASS |
| phase5-forecast-15 | DELAY_8 | LIKELY_LATE | LIKELY_LATE | 0 | 15 | PASS |
| phase5-forecast-16 | DELAY_9 | LIKELY_LATE | LIKELY_LATE | 0 | 14 | PASS |
| phase5-forecast-17 | DELAY_10 | LIKELY_LATE | LIKELY_LATE | 0 | 13 | PASS |
| phase5-forecast-18 | DELAY_10 | LIKELY_LATE | LIKELY_LATE | 0 | 13 | PASS |
| phase5-forecast-19 | DELAY_11 | CRITICAL_LATE | CRITICAL_LATE | 0 | 12 | PASS |
| phase5-forecast-20 | DELAY_12 | CRITICAL_LATE | CRITICAL_LATE | 0 | 11 | PASS |
| phase5-forecast-21 | DELAY_13 | CRITICAL_LATE | CRITICAL_LATE | 0 | 10 | PASS |
| phase5-forecast-22 | DELAY_14 | CRITICAL_LATE | CRITICAL_LATE | 0 | 9 | PASS |
| phase5-forecast-23 | DELAY_16 | CRITICAL_LATE | CRITICAL_LATE | 0 | 7 | PASS |
| phase5-forecast-24 | DELAY_18 | CRITICAL_LATE | CRITICAL_LATE | 0 | 5 | PASS |
| phase5-forecast-25 | DELAY_4 | AT_RISK | AT_RISK | 0 | 19 | PASS |
| phase5-forecast-26 | DELAY_8 | LIKELY_LATE | LIKELY_LATE | 0 | 15 | PASS |
| phase5-forecast-27 | DELAY_12 | CRITICAL_LATE | CRITICAL_LATE | 0 | 11 | PASS |
| phase5-forecast-28 | DELAY_0 | ON_TRACK | ON_TRACK | 0 | n/a | PASS |
| phase5-forecast-29 | DELAY_15 | CRITICAL_LATE | CRITICAL_LATE | 0 | 8 | PASS |
| phase5-forecast-30 | DELAY_2 | AT_RISK | AT_RISK | 0 | 21 | PASS |
| phase5-forecast-31 | INSUFFICIENT_NO_NORM | INSUFFICIENT_DATA | INSUFFICIENT_DATA | n/a | n/a | PASS |
| phase5-forecast-32 | INSUFFICIENT_NO_HISTORY | INSUFFICIENT_DATA | INSUFFICIENT_DATA | n/a | n/a | PASS |
