import { isStable, type WeightReading } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { EMPTY_KG, LOADED_KG, WeightModel } from "./weight-model";

/** Reads every 200 ms from `from` to `to`. */
const readings = (model: WeightModel, from: number, to: number) =>
  Array.from({ length: (to - from) / 200 + 1 }, (_, i) => {
    const at = from + i * 200;
    return { at, ...model.read(at) };
  });

/** The first time the backend's rule would call the weight stable. */
function firstStableAt(list: (WeightReading & { pos: boolean })[]): number | undefined {
  return list.find((_, i) => isStable(list.slice(0, i + 1)))?.at;
}

describe("WeightModel", () => {
  it("starts as an empty, still bridge", () => {
    expect(new WeightModel().read(0)).toEqual({ kg: 0, stable: true, pos: true });
  });

  it.each([LOADED_KG, EMPTY_KG])("ramps up, wobbles and settles at exactly %i kg", (target) => {
    const model = new WeightModel();
    model.arrive(target, 0);

    expect(model.read(0).kg).toBe(0);
    expect(model.read(1500).kg).toBe(target / 2);
    const wobble = readings(model, 3000, 5000).map((r) => r.kg);
    expect(Math.max(...wobble) - Math.min(...wobble)).toBeGreaterThan(100);
    expect(model.read(5000)).toMatchObject({ kg: target, stable: false });
    expect(model.read(6000)).toMatchObject({ kg: target, stable: true });
  });

  it("becomes stable for the backend only after it has settled", () => {
    const model = new WeightModel();
    model.arrive(LOADED_KG, 0);
    const at = firstStableAt(readings(model, 0, 12_000))!;

    // Not before the flag is on for a whole 3 second window.
    expect(at).toBeGreaterThanOrEqual(9000);
    expect(at).toBeLessThanOrEqual(9400);
  });

  it("goes back to zero when the truck leaves", () => {
    const model = new WeightModel();
    model.arrive(LOADED_KG, 0);
    model.leave(10_000);
    expect(model.read(10_000).kg).toBe(LOADED_KG);
    expect(model.read(11_000).kg).toBeLessThan(LOADED_KG);
    expect(model.read(13_000)).toMatchObject({ kg: 0, stable: true });
  });

  it("wobbles and drops the stable flag while unstable is on", () => {
    const model = new WeightModel();
    model.arrive(LOADED_KG, 0);
    expect(model.toggleUnstable(10_000)).toBe(true);
    const list = readings(model, 10_000, 16_000);

    expect(list.every((r) => !r.stable)).toBe(true);
    expect(firstStableAt(list)).toBeUndefined();
    expect(model.toggleUnstable(16_000)).toBe(false);
    expect(model.read(16_500).stable).toBe(false);
    expect(model.read(17_000)).toMatchObject({ kg: LOADED_KG, stable: true });
  });

  it("reports the position switch", () => {
    const model = new WeightModel();
    expect(model.togglePosition()).toBe(false);
    expect(model.read(0).pos).toBe(false);
    expect(model.togglePosition()).toBe(true);
  });
});
