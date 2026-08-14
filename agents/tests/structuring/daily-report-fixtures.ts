import type { DailyReportModelOutput } from "../../src/structuring/index.js";

export const validDailyReportSource =
  "Өнөөдөр BW-017 Шатны марш ажил 70 хувь, өнөөдөр 10 м3 нэмэгдэж гүйцэтгэсэн. Манай Өрлөгийн баг 6 хүн 8 цаг ажиллав. 100 ш тоосго зарцуулсан.";

export function buildValidDailyReportModelOutput(): DailyReportModelOutput {
  return {
    schemaVersion: 1,
    language: "mn",
    reportDate: null,
    location: {
      block: null,
      stage: null,
      floor: null,
      zone: null,
    },
    progressEntries: [
      {
        workItemCode: "BW-017",
        workItemName: "Шатны марш",
        candidateCodes: [],
        progressMode: "INCREMENTAL",
        progressPercent: 70,
        quantityDone: "10",
        unit: "м3",
        status: "IN_PROGRESS",
        blocker: null,
        note: null,
        confidence: [
          {
            fieldPath: "workItem.code",
            score: 0.99,
            evidenceQuote: "BW-017",
            sourceImageIndex: null,
            imageRegion: null,
          },
          {
            fieldPath: "progressPercent",
            score: 0.98,
            evidenceQuote: "70 хувь",
            sourceImageIndex: null,
            imageRegion: null,
          },
          {
            fieldPath: "quantityDone",
            score: 0.98,
            evidenceQuote: "10 м3 нэмэгдэж",
            sourceImageIndex: null,
            imageRegion: null,
          },
          {
            fieldPath: "status",
            score: 0.9,
            evidenceQuote: "70 хувь",
            sourceImageIndex: null,
            imageRegion: null,
          },
        ],
      },
    ],
    attendanceEntries: [
      {
        teamType: "OWN",
        teamRef: "team-structure",
        teamName: "Өрлөгийн баг",
        workItemCodes: ["BW-017"],
        headcount: 6,
        hoursPerPerson: 8,
        totalHours: 48,
        confidence: [
          {
            fieldPath: "teamType",
            score: 0.99,
            evidenceQuote: "Манай",
            sourceImageIndex: null,
            imageRegion: null,
          },
          {
            fieldPath: "headcount",
            score: 0.98,
            evidenceQuote: "6 хүн",
            sourceImageIndex: null,
            imageRegion: null,
          },
          {
            fieldPath: "hoursPerPerson",
            score: 0.98,
            evidenceQuote: "8 цаг",
            sourceImageIndex: null,
            imageRegion: null,
          },
        ],
      },
    ],
    materialSignals: [
      {
        signalType: "CONSUMED",
        rawName: "тоосго",
        normalizedName: null,
        materialRef: null,
        quantity: "100",
        unit: "ш",
        supplierName: null,
        workItemCodes: ["BW-017"],
        note: null,
        confidence: [
          {
            fieldPath: "rawName",
            score: 0.98,
            evidenceQuote: "тоосго",
            sourceImageIndex: null,
            imageRegion: null,
          },
          {
            fieldPath: "quantity",
            score: 0.98,
            evidenceQuote: "100 ш",
            sourceImageIndex: null,
            imageRegion: null,
          },
        ],
      },
    ],
    photoObservations: [],
    topLevelConfidence: [
      {
        fieldPath: "reportDate",
        score: 0.95,
        evidenceQuote: "Өнөөдөр",
        sourceImageIndex: null,
        imageRegion: null,
      },
    ],
  };
}
