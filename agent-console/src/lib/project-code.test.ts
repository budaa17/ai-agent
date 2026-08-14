import { describe, expect, it } from "vitest";
import { projectCodeSchema } from "./project-code";

describe("projectCodeSchema", () => {
  it.each(["SKY-TOWER-01", "ТЭСТ-2", "BUILD-ТӨСӨЛ_01", "ӨРГӨӨ.2026"])(
    "Монгол, англи болон холимог кодыг зөвшөөрнө: %s",
    (code) => {
      expect(projectCodeSchema.parse(code)).toBe(code);
    },
  );

  it.each(["-ТӨСӨЛ", "ТӨСӨЛ 2", "ТӨСӨЛ/2", "ТӨСӨЛ#2"])(
    "аюулгүй бус кодыг хориглоно: %s",
    (code) => {
      expect(projectCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});
