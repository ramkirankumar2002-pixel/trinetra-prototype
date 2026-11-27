import { describe, expect, it } from "vitest";
import { supervisorDayStats, type SupervisorTicketView } from "../tickets";
import { comparePlates } from "./plates";

describe("comparePlates", () => {
  it.each([
    ["MH12AB1234", "MATCH"],
    ["mh 12-ab 1234", "MATCH"],
    ["MH12AB1235", "CLOSE"],
    ["NH12AB1234", "CLOSE"],
    ["MH12AB123", "CLOSE"],
    ["MH2AB1234", "CLOSE"],
    ["MH12AB12345", "CLOSE"],
    ["MH12AB1245", "NO_MATCH"],
    ["MH12AB2134", "NO_MATCH"],
    ["MH12AB12", "NO_MATCH"],
    ["MH14CD5678", "NO_MATCH"],
    ["", "NOT_READ"],
    [" - ", "NOT_READ"],
    [null, "NOT_READ"],
  ])("%s against MH12AB1234 is %s", (read, result) => {
    expect(comparePlates(read, "MH12AB1234")).toBe(result);
  });
});

describe("supervisorDayStats", () => {
  const truck = (values: Partial<SupervisorTicketView>) => values as SupervisorTicketView;
  const decided = (approvalStatus: "APPROVED" | "REJECTED", minutes: number) =>
    truck({
      approvalStatus,
      firstWeightAt: "2026-11-27T04:00:00.000Z",
      decidedAt: new Date(Date.parse("2026-11-27T04:00:00.000Z") + minutes * 60_000).toISOString(),
    });

  it("counts today's trucks and the average wait to a decision", () => {
    const done = [decided("APPROVED", 4), decided("APPROVED", 8), decided("REJECTED", 12)];
    expect(supervisorDayStats([truck({})], done)).toEqual({
      coming: 4,
      waiting: 1,
      verified: 2,
      rejected: 1,
      averageWaitMin: 8,
    });
  });

  it("has no average before the first decision", () => {
    expect(supervisorDayStats([], [])).toEqual({
      coming: 0,
      waiting: 0,
      verified: 0,
      rejected: 0,
      averageWaitMin: null,
    });
  });
});
