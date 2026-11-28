import { describe, expect, it } from "vitest";
import { SEED_MATERIALS, type SeedMaterialName } from "../seed/default-data";
import { classifyType, classifyWithoutInvoice } from "./classify";

const material = (name: SeedMaterialName) => SEED_MATERIALS.find((item) => item.name === name)!;

const typeOf = (name: SeedMaterialName, kg: number | null) => {
  const result = classifyType(material(name), kg);
  return result.ok ? result.type : result.error;
};

describe("classifyType", () => {
  it.each(["Sand", "Aggregate 20 mm", "Aggregate 10 mm"] as const)(
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

  it.each(["Cement Bags", "Steel Bars", "Bitumen", "Additive", "Steel Scrap"] as const)(
    "%s splits at 1000 kg: above is Type 2, at or below Type 3",
    (name) => {
      expect(typeOf(name, 999)).toBe("TYPE_3");
      expect(typeOf(name, 1000)).toBe("TYPE_3");
      expect(typeOf(name, 1001)).toBe("TYPE_2");
    },
  );

  it("splits at the number kept on each material, so one can be changed alone", () => {
    const changed = { ...material("Bitumen"), type2AboveKg: 5000 };
    expect(classifyType(changed, 5000)).toMatchObject({ type: "TYPE_3" });
    expect(classifyType(changed, 5001)).toMatchObject({ type: "TYPE_2" });
  });

  it.each([null, undefined])("never guesses when the invoice weight is %s", (kg) => {
    expect(classifyType(material("Cement Bags"), kg)).toMatchObject({
      ok: false,
      error: "INVOICE_WEIGHT_REQUIRED",
    });
  });

  it.each([0, -1000, 999.5, Number.NaN, Number.POSITIVE_INFINITY, "2000" as unknown as number])(
    "refuses the invoice weight %s",
    (kg) => {
      expect(typeOf("Cement Bags", kg)).toBe("INVOICE_WEIGHT_INVALID");
    },
  );

  it("gives a short reason", () => {
    expect(classifyType(material("Cement Bags"), 1500)).toMatchObject({
      reason: "Cement Bags: the invoice weight is above 1000 kg.",
    });
    expect(classifyType(material("Cement Bags"), 1000)).toMatchObject({
      reason: "Cement Bags: the invoice weight is 1000 kg or less.",
    });
    expect(classifyType(material("Sand"), 1)).toMatchObject({
      reason: "Sand is always this type.",
    });
  });
});

describe("classifyWithoutInvoice", () => {
  it.each([
    ["Sand", "TYPE_1"],
    ["Aggregate 20 mm", "TYPE_1"],
    ["Aggregate 10 mm", "TYPE_1"],
    ["Cement Bags", "TYPE_2"],
    ["Steel Bars", "TYPE_2"],
    ["Bitumen", "TYPE_2"],
    ["Additive", "TYPE_2"],
    ["Steel Scrap", "TYPE_2"],
    ["Bricks", "TYPE_3"],
  ] as const)("%s without an invoice is %s", (name, type) => {
    expect(classifyWithoutInvoice(material(name))).toBe(type);
  });
});
