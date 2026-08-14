import { describe, expect, it } from "vitest";
import {
  InMemoryProductionReadRepository,
  type AuthorizationContext,
} from "../../src/production-tools/index.js";
import { askProductionA4, routeA4Question } from "../../src/phase2/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";

const simulation = buildBuildWatchSimulation();
const repository = new InMemoryProductionReadRepository([
  simulation.snapshot,
  simulation.privateSnapshot,
]);
const context: AuthorizationContext = {
  principalId: "phase2-a4-manager",
  tenantId: simulation.snapshot.tenantId,
  allowedProjectIds: [simulation.snapshot.projectId],
  permissions: ["AGENT_READ", "COST_READ", "REPORT_TEXT_READ"],
};
const base = {
  repository,
  context,
  projectId: simulation.snapshot.projectId,
  generatedAt: "2026-03-28T23:59:59.999Z",
};

describe("Phase 2 A4 production reference assistant", () => {
  it("routes all 11 authorized read-only tool intents", () => {
    const cases = [
      ["Төслийн ерөнхий хураангуйг хэл", "getProjectSummary"],
      ["Ажлын жагсаалт харуул", "getWorkItems"],
      ["BW-017 явцын түүхийг хэл", "getProgressHistory"],
      ["Материалын агуулахын үлдэгдэл ямар вэ?", "getStockStatus"],
      ["Материалын нормын зарцуулалтын зөрүү?", "getConsumptionVsNorm"],
      ["Ирц болон хүн-цаг хэд вэ?", "getAttendanceStats"],
      ["Нээлттэй саад, blocker-ийн түүх?", "getBlockerHistory"],
      ["Эрсдэлийн дохио, alert хэд байна?", "getAlerts"],
      ["Тооцоолсон дуусах огнооны forecast?", "getScheduleForecast"],
      ["Туслан гүйцэтгэгчийн гүйцэтгэл?", "getSubcontractorPerformance"],
      ['Өдрийн тайлангаас "BW-017" гэж хай', "searchDailyReports"],
    ] as const;

    for (const [question, expectedTool] of cases) {
      expect(routeA4Question(question).tools).toContain(expectedTool);
    }
  });

  it("recognizes natural Mongolian and Latin-script project summary questions", () => {
    const questions = [
      "төсөв хэдэн төгрөг байна",
      "tosow heden tugrug baina",
      "atlas projectiin medeelliig yawuul",
    ];

    for (const question of questions) {
      expect(routeA4Question(question)).toMatchObject({
        policyAction: "ANSWER_READ_ONLY",
        tools: ["getProjectSummary"],
      });
    }
  });

  it("returns project budget as a source-backed claim", async () => {
    const result = await askProductionA4({
      repository,
      context,
      projectId: simulation.snapshot.projectId,
      question: "төсөв хэдэн төгрөг байна",
      asOf: simulation.snapshot.asOf,
    });

    expect(result.status).toBe("ANSWERED");
    expect(result.inspectedTools).toContain("getProjectSummary");
    expect(result.answer).toMatch(/Нийт төлөвлөсөн төсөв \d+\.\d{2} ₮/u);
    expect(
      result.claims.find((claim) => claim.text.startsWith("Нийт төлөвлөсөн төсөв"))?.sourceRefs
        .length,
    ).toBeGreaterThan(0);
  });

  it("answers every production tool with authorized source claims", async () => {
    const rawText =
      simulation.snapshot.dailyReports.find((report) => report.rawText !== null)?.rawText ?? "BW";
    const searchTerm = rawText.split(/\s+/u).find((term) => term.length >= 3) ?? "BW";
    const cases = [
      ["Төслийн ерөнхий хураангуйг хэл", "getProjectSummary"],
      ["Ажлын жагсаалт харуул", "getWorkItems"],
      ["BW-017 явцын түүхийг хэл", "getProgressHistory"],
      ["Материалын агуулахын үлдэгдэл ямар вэ?", "getStockStatus"],
      ["Материалын нормын зарцуулалтын зөрүү?", "getConsumptionVsNorm"],
      ["Ирц болон хүн-цаг хэд вэ?", "getAttendanceStats"],
      ["Нээлттэй саад, blocker-ийн түүх?", "getBlockerHistory"],
      ["Эрсдэлийн дохио, alert хэд байна?", "getAlerts"],
      ["Тооцоолсон дуусах огнооны forecast?", "getScheduleForecast"],
      ["Туслан гүйцэтгэгчийн гүйцэтгэл?", "getSubcontractorPerformance"],
      [`Өдрийн тайлангаас "${searchTerm}" гэж хай`, "searchDailyReports"],
    ] as const;

    for (const [question, expectedTool] of cases) {
      const answer = await askProductionA4({
        ...base,
        question,
      });

      expect(answer.status, question).toBe("ANSWERED");
      expect(answer.inspectedTools, question).toContain(expectedTool);
      expect(answer.claims.length, question).toBeGreaterThan(0);
      expect(
        answer.claims.every((item) =>
          item.sourceRefs.every(
            (source) => source.tenantId === context.tenantId && source.projectId === base.projectId,
          ),
        ),
        question,
      ).toBe(true);
    }
  });

  it("refuses writes without inspecting project data", async () => {
    const answer = await askProductionA4({
      ...base,
      question: "BW-017 ажлын төлөвийг COMPLETED болгож update хий",
    });

    expect(answer.status).toBe("REFUSED_WRITE_ACTION");
    expect(answer.claims).toEqual([]);
    expect(answer.inspectedTools).toEqual([]);
    expect(answer.suggestedRouteCode).toBe("AUTHORIZED_WRITE_WORKFLOW");
  });

  it("redirects document creation to A3", async () => {
    const answer = await askProductionA4({
      ...base,
      question: "Энэ төслийн сарын тайлан PDF болгон гарга",
    });

    expect(answer.status).toBe("REDIRECT_REPORT_WORKFLOW");
    expect(answer.claims).toEqual([]);
    expect(answer.inspectedTools).toEqual([]);
    expect(answer.suggestedRouteCode).toBe("A3_DOCUMENT_DRAFT");
  });

  it("does not leak another tenant through errors or claims", async () => {
    const answer = await askProductionA4({
      ...base,
      projectId: simulation.privateSnapshot.projectId,
      question: "Төслийн ерөнхий хураангуйг хэл",
    });

    expect(answer.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(answer.claims).toEqual([]);
    expect(answer.answer).not.toContain(simulation.privateSnapshot.projectName);
  });

  it("returns insufficient evidence for an out-of-scope question", async () => {
    const answer = await askProductionA4({
      ...base,
      question: "Маргааш Улаанбаатарт цаг агаар ямар байх вэ?",
    });

    expect(answer.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(answer.inspectedTools).toEqual([]);
    expect(answer.suggestedRouteCode).toBe("CLARIFY_PROJECT_QUESTION");
  });
});
