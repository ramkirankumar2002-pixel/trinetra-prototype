import { describe, expect, it } from "vitest";
import { SEED_SETTINGS } from "../seed/default-data";
import { gramsToKg } from "../hardware";
import { isStable, stableKg, type WeightReading } from "./stability";

const windowMs = SEED_SETTINGS.stable_window_seconds * 1000;
const spreadKg = 10;

/** Readings every 200 ms from 0 to `durationMs`, all stable unless changed. */
function readings(
  durationMs = 3000,
  change: (reading: WeightReading) => Partial<WeightReading> = () => ({}),
): WeightReading[] {
  return Array.from({ length: Math.floor(durationMs / 200) + 1 }, (_, index) => {
    const reading = { kg: 32_560, stable: true, at: index * 200 };
    return { ...reading, ...change(reading) };
  });
}

const stable = (list: WeightReading[]) => isStable(list, windowMs, spreadKg);

describe("gramsToKg: the model weighbridge", () => {
  it.each([
    [200, 100, 20_000],
    [180, 100, 18_000],
    [325.6, 100, 32_560],
    [143.1, 100, 14_310],
    [500, 40, 20_000],
    [0.004, 100, 0],
    [-0.2, 100, -20],
    [1, 2.5, 3],
  ])("%s g at %s kg to a gram is %s kg", (grams, scale, kg) => {
    expect(gramsToKg(grams, scale)).toBe(kg);
  });

  it("never gives minus zero", () => {
    expect(Object.is(gramsToKg(-0.001, 100), 0)).toBe(true);
  });
});

describe("stableKg", () => {
  it("is the average of the still readings, in whole kilograms", () => {
    const noisy = readings(3000, ({ at }) => ({ kg: at % 400 === 0 ? 32_556 : 32_565 }));
    const kg = stableKg(noisy, windowMs, spreadKg)!;
    expect(Number.isInteger(kg)).toBe(true);
    expect(kg).toBeGreaterThan(32_556);
    expect(kg).toBeLessThan(32_565);
  });

  it("is null whenever the weight is not stable", () => {
    expect(stableKg(readings(2800), windowMs, spreadKg)).toBeNull();
    expect(
      stableKg(
        readings(3000, () => ({ stable: false })),
        windowMs,
        spreadKg,
      ),
    ).toBeNull();
    expect(stableKg([], windowMs, spreadKg)).toBeNull();
  });

  it("leaves out readings from before the window", () => {
    const settled = readings(6000, ({ at }) => (at < 2000 ? { kg: 5 } : {}));
    expect(stableKg(settled, windowMs, spreadKg)).toBe(32_560);
  });
});

describe("isStable", () => {
  it("is true after 3 seconds of a steady, flagged weight", () => {
    expect(stable(readings(3000))).toBe(true);
    expect(isStable(readings(5000))).toBe(true);
  });

  it("is false before a full 3 seconds of readings", () => {
    expect(stable(readings(2800))).toBe(false);
    expect(stable([])).toBe(false);
    expect(stable([{ kg: 32_560, stable: true, at: 0 }])).toBe(false);
  });

  it.each([10, -10])("allows a reading %i kg from the newest one", (offset) => {
    expect(stable(readings(3000, ({ at }) => (at === 1000 ? { kg: 32_560 + offset } : {})))).toBe(
      true,
    );
  });

  it.each([11, -11, 500])("is false with a reading %i kg from the newest one", (offset) => {
    expect(stable(readings(3000, ({ at }) => (at === 1000 ? { kg: 32_560 + offset } : {})))).toBe(
      false,
    );
  });

  it("is false while the weight is still climbing", () => {
    expect(stable(readings(3000, ({ at }) => ({ kg: 30_000 + at })))).toBe(false);
  });

  it.each([0, 1600, 3000])("is false if the ESP32 flag was off at %i ms", (time) => {
    expect(stable(readings(3000, ({ at }) => (at === time ? { stable: false } : {})))).toBe(false);
  });

  it("ignores what happened before the window", () => {
    const list = readings(8000, ({ at }) => (at < 4800 ? { kg: 100, stable: false } : {}));
    expect(stable(list)).toBe(true);
  });

  it("looks at the reading that was current when the window began", () => {
    // Readings at -100 and +100 ms around the start: the earlier one still counts.
    const list: WeightReading[] = [
      { kg: 20_000, stable: false, at: -100 },
      ...readings(2800, () => ({})).map((r) => ({ ...r, at: r.at + 100 })),
      { kg: 32_560, stable: true, at: 3000 },
    ];
    expect(stable(list)).toBe(false);
    list[0] = { kg: 32_560, stable: true, at: -100 };
    expect(stable(list)).toBe(true);
  });

  it("is false after a gap with no readings", () => {
    const withGap = readings(3000).filter(({ at }) => at <= 800 || at >= 2000);
    expect(stable(withGap)).toBe(false);
    // Two readings 3 seconds apart prove nothing about the time between.
    expect(stable([readings()[0]!, readings().at(-1)!])).toBe(false);
  });

  it("allows a gap of up to 1 second", () => {
    expect(stable(readings(3000).filter(({ at }) => at <= 1000 || at >= 2000))).toBe(true);
  });

  it("does not depend on the order, and leaves the list unchanged", () => {
    const reversed = readings().reverse();
    const copy = [...reversed];
    expect(stable(reversed)).toBe(true);
    expect(reversed).toEqual(copy);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("is false with a reading of %s", (kg) => {
    expect(stable(readings(3000, ({ at }) => (at === 1000 ? { kg } : {})))).toBe(false);
  });

  it("calls a steady empty bridge stable: the caller checks that a truck is there", () => {
    expect(stable(readings(3000, () => ({ kg: 0 })))).toBe(true);
  });

  it("uses the window and spread it is given", () => {
    expect(isStable(readings(1000), 1000)).toBe(true);
    expect(
      isStable(
        readings(3000, ({ at }) => ({ kg: at === 1000 ? 32_580 : 32_560 })),
        3000,
        20,
      ),
    ).toBe(true);
  });
});
