import { describe, expect, it } from "vitest";
import { SEED_SETTINGS } from "../seed/default-data";
import { checkTolerance, computeNet, DEFAULT_TOLERANCE_PCT } from "./weight";

describe("computeNet", () => {
  it("subtracts the second weight from the first", () => {
    expect(computeNet(32_560, 18_250)).toEqual({ valid: true, netKg: 14_310 });
    expect(computeNet(2, 1)).toEqual({ valid: true, netKg: 1 });
  });

  it.each([
    [18_000, 18_000, 0],
    [18_250, 32_560, -14_310],
  ])("is invalid when %i minus %i is %i", (first, second, netKg) => {
    expect(computeNet(first, second)).toEqual({
      valid: false,
      netKg,
      reason: "weights not valid",
    });
  });

  it.each([
    [0, 0],
    [32_560, 0],
    [0, 18_250],
    [-1, 5],
    [5, -1],
    [100.5, 50],
    [Number.NaN, 50],
    [50, Number.POSITIVE_INFINITY],
  ])("refuses the weights %s and %s", (first, second) => {
    expect(computeNet(first, second)).toMatchObject({ valid: false, netKg: null });
  });
});

describe("checkTolerance", () => {
  it("uses the 0.5 % in the default data", () => {
    expect(DEFAULT_TOLERANCE_PCT).toBe(SEED_SETTINGS.tolerance_pct);
  });

  it.each([
    [20_000, 0, true],
    [20_100, 0.5, true], // exactly at the limit, above
    [19_900, 0.5, true], // exactly at the limit, below
    [20_102, 0.51, false],
    [19_898, 0.51, false],
    [15_000, 25, false],
    [40_000, 100, false],
  ])("net %i against invoice 20,000 is %s %%", (net, variancePct, pass) => {
    expect(checkTolerance(net, 20_000)).toEqual({
      valid: true,
      pass,
      variancePct,
      differenceKg: net - 20_000,
    });
  });

  it("rounds to 2 decimals before comparing", () => {
    // 0.504 % rounds to 0.50 and passes; 0.505 % rounds to 0.51 and fails.
    expect(checkTolerance(100_504, 100_000)).toMatchObject({ variancePct: 0.5, pass: true });
    expect(checkTolerance(100_505, 100_000)).toMatchObject({ variancePct: 0.51, pass: false });
    expect(checkTolerance(30_000, 29_999)).toMatchObject({ variancePct: 0 });
  });

  it("accepts another tolerance", () => {
    expect(checkTolerance(20_200, 20_000, 1)).toMatchObject({ pass: true, variancePct: 1 });
    expect(checkTolerance(20_001, 20_000, 0)).toMatchObject({ pass: false });
    expect(checkTolerance(20_000, 20_000, 0)).toMatchObject({ pass: true });
  });

  it.each([0, -500, 10.5, Number.NaN])("a net of %s is an invalid result", (net) => {
    expect(checkTolerance(net, 20_000)).toEqual({
      valid: false,
      pass: false,
      reason: "weights not valid",
    });
  });

  it.each([0, -1, Number.NaN, null as unknown as number])(
    "an invoice weight of %s is an invalid result",
    (invoice) => {
      expect(checkTolerance(20_000, invoice)).toEqual({
        valid: false,
        pass: false,
        reason: "invoice weight not valid",
      });
    },
  );

  it.each([-0.5, Number.NaN])("refuses the tolerance %s", (pct) => {
    expect(() => checkTolerance(1, 1, pct)).toThrow(RangeError);
  });
});
