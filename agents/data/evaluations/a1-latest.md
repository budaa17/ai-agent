# A1 Structured Extraction Evaluation

- Suite: `a1-project-update-v1`
- Generated: 2026-07-28T11:40:05.729Z
- Provider: `openai`
- Model: `gpt-5.6-luna`
- Cases: 25
- Schema success: 25/25 (100.00%)
- Exact cases: 21/25 (84.00%)
- Field accuracy: 134/138 (97.10%)

## Field Accuracy

| Field | Matched | Total | Accuracy |
| --- | ---: | ---: | ---: |
| actualCostMnt | 7 | 7 | 100.00% |
| actualEndDate | 2 | 2 | 100.00% |
| actualStartDate | 3 | 3 | 100.00% |
| budgetMnt | 5 | 5 | 100.00% |
| daysWithoutProgress | 2 | 2 | 100.00% |
| forecastEndDate | 2 | 2 | 100.00% |
| issueTypes | 16 | 16 | 100.00% |
| language | 4 | 4 | 100.00% |
| ledgerTotalMnt | 2 | 2 | 100.00% |
| plannedEndDate | 3 | 3 | 100.00% |
| plannedStartDate | 1 | 1 | 100.00% |
| predecessorStatus | 2 | 2 | 100.00% |
| predecessorWorkItemCode | 2 | 2 | 100.00% |
| previousProgressPercent | 2 | 2 | 100.00% |
| priority | 2 | 2 | 100.00% |
| progressPercent | 14 | 14 | 100.00% |
| projectCode | 6 | 6 | 100.00% |
| reportDate | 3 | 3 | 100.00% |
| status | 14 | 15 | 93.33% |
| workItemCode | 24 | 24 | 100.00% |
| workItemName | 18 | 21 | 85.71% |

## Failed Fields

- `a1-currency-symbol.workItemName`: expected `"Сүлжээний төхөөрөмж"`, actual `"Сүлжээний төхөөрөмжийн төсөв"`
- `a1-decimal-million.workItemName`: expected `"Талбайн хэмжилт"`, actual `"Талбайн хэмжилтийн"`
- `a1-not-started-synonym.workItemName`: expected `"Нөөц сервер тохируулах"`, actual `null`
- `a1-progress-improved.status`: expected `"IN_PROGRESS"`, actual `null`
