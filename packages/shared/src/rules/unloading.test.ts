import { describe, expect, it } from "vitest";
import { seedDefaultPoint, seedRules } from "../test/seed-points";
import { resolveUnloadingPoint } from "./unloading";

const resolve = (material: string, tripNo: number) =>
  resolveUnloadingPoint(material, tripNo, seedRules, seedDefaultPoint);

describe("resolveUnloadingPoint", () => {
  it.each([
    ["Cement Bags", 1, "Plant", "Amit Kumar"],
    ["Steel Scrap", 500, "Plant", "Dinesh Verma"],
    ["Sand", 999, "CH-012+300", "Pankaj Gupta"],
    ["Aggregate 10 mm", 1, "CH-005+250", "Ravi Singh"],
    ["Aggregate 10 mm", 3, "CH-005+250", "Ravi Singh"],
    ["Aggregate 10 mm", 4, "CH-009+800", "Mahesh Patel"],
    ["Aggregate 20 mm", 4, "CH-003+750", "Suresh Yadav"],
    ["Aggregate 20 mm", 5, "CH-010+500", "Vikram Sharma"],
  ])("%s trip %i goes to %s (%s)", (material, trip, code, supervisor) => {
    const choice = resolve(material, trip);
    expect(choice.point.code).toBe(code);
    expect(choice.supervisor.name).toBe(supervisor);
    expect(choice.isDefault).toBe(false);
  });

  it.each(["Cement Bags", "Sand", "Aggregate 10 mm", "Aggregate 20 mm", "Steel Scrap"])(
    "%s trip past every range goes to the default",
    (material) => {
      expect(resolve(material, 1000)).toMatchObject({
        point: { code: "Plant" },
        supervisor: { name: "Amit Kumar", phone: "9876543210" },
        isDefault: true,
      });
    },
  );

  it.each(["Additive", "Bitumen", "Steel Bars", "Bricks", "Unknown material"])(
    "%s has no rule and goes to Plant, Amit Kumar",
    (material) => {
      const choice = resolve(material, 1);
      expect(choice.isDefault).toBe(true);
      expect(choice.supervisor.name).toBe("Amit Kumar");
    },
  );

  it("works with numeric material ids", () => {
    const rules = [{ materialId: 7, tripFrom: 2, tripTo: 2, point: seedRules[2]!.point }];
    expect(resolveUnloadingPoint(7, 2, rules, seedDefaultPoint).isDefault).toBe(false);
    expect(resolveUnloadingPoint(7, 1, rules, seedDefaultPoint).isDefault).toBe(true);
    expect(resolveUnloadingPoint(8, 2, rules, seedDefaultPoint).isDefault).toBe(true);
    expect(resolveUnloadingPoint("7", 2, rules, seedDefaultPoint).isDefault).toBe(true);
  });

  it("uses the default when there are no rules at all", () => {
    expect(resolveUnloadingPoint(1, 1, [], seedDefaultPoint).point).toBe(seedDefaultPoint);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses the trip number %s", (trip) => {
    expect(() => resolve("Sand", trip)).toThrow(RangeError);
  });
});
