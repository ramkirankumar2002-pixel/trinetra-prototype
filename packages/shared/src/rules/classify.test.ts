import { describe, expect, it } from "vitest";
import { SEED_MATERIALS, type SeedMaterialName } from "../seed/default-data";
import { classifyType } from "./classify";

const material = (name: SeedMaterialName) => SEED_MATERIALS.find((item) => item.name === name)!;

const typeOf = (name: SeedMaterialName, kg: number | null) => {
  const result = classifyType(material(name), kg);
  return result.ok ? result.type : result.error;
};

describe("classifyType", () => {
  it.each(["Cement Bags", "Additive", "Bitumen", "Steel Bars"] as const)(
    "%s is always Type 1, whatever the invoice weight",
    (name) => {
      for (const kg of [null, 0, -5, 1, 100_000, Number.NaN]) {
        expect(typeOf(name, kg)).toBe("TYPE_1");
      }
    },
  );

  it("Bricks are always Type 3", () => {
    for (const kg of [null, 1, 500, 501, 100_000]) expect(typeOf("Bricks", kg)).toBe("TYPE_3");
  });

  it.each([
    ["Aggregate 20 mm", 500],
    ["Aggregate 10 mm", 500],
    ["Steel Scrap", 1000],
    ["Sand", 1000],
  ] as const)("%s splits at %i kg: exactly at the limit is Type 3", (name, limit) => {
    expect(typeOf(name, limit - 1)).toBe("TYPE_3");
    expect(typeOf(name, limit)).toBe("TYPE_3");
    expect(typeOf(name, limit + 1)).toBe("TYPE_2");
  });

  it.each([null, undefined])("never guesses when the invoice weight is %s", (kg) => {
    expect(classifyType(material("Sand"), kg)).toMatchObject({
      ok: false,
      error: "INVOICE_WEIGHT_REQUIRED",
    });
  });

  it.each([0, -1000, 999.5, Number.NaN, Number.POSITIVE_INFINITY, "2000" as unknown as number])(
    "refuses the invoice weight %s",
    (kg) => {
      expect(typeOf("Sand", kg)).toBe("INVOICE_WEIGHT_INVALID");
    },
  );

  it("gives a short reason", () => {
    expect(classifyType(material("Sand"), 1500)).toMatchObject({
      reason: "Sand: the invoice weight is above 1000 kg.",
    });
    expect(classifyType(material("Sand"), 1000)).toMatchObject({
      reason: "Sand: the invoice weight is 1000 kg or less.",
    });
    expect(classifyType(material("Bitumen"), 1)).toMatchObject({
      reason: "Bitumen is always this type.",
    });
  });
});
