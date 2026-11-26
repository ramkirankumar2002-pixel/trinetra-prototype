import { describe, expect, it } from "vitest";
import { SEED_MATERIALS } from "../seed/default-data";
import { matchMaterial } from "./material";

const match = (text: string) => matchMaterial(text, SEED_MATERIALS)?.material.name ?? null;

describe("matchMaterial", () => {
  it.each(SEED_MATERIALS)("matches the name and every alias of $name", (material) => {
    for (const text of [material.name, ...material.aliasesEn, ...material.aliasesHi]) {
      expect({ text, found: match(text) }).toEqual({ text, found: material.name });
    }
  });

  it.each([
    ["20mm agg", "Aggregate 20 mm"],
    ["bees mm", "Aggregate 20 mm"],
    ["बीस एम एम गिट्टी", "Aggregate 20 mm"],
    ["२० मिमी गिट्टी", "Aggregate 20 mm"],
    ["20 M.M. Aggregate", "Aggregate 20 mm"],
    ["Coarse Aggregate - 20MM (crushed)", "Aggregate 20 mm"],
    ["gitti 20", "Aggregate 20 mm"],
    ["das mm", "Aggregate 10 mm"],
    ["bees mm wali", "Aggregate 20 mm"],
    ["ten mm aggregate", "Aggregate 10 mm"],
    ["AGGR 10mm", "Aggregate 10 mm"],
    ["OPC 53 Grade Cement", "Cement Bags"],
    ["CEMENT BAGS (50 kg)", "Cement Bags"],
    ["TMT Steel Bars Fe500", "Steel Bars"],
    ["TMT steel bar 10 mm", "Steel Bars"],
    ["steel bars 20mm", "Steel Bars"],
    ["MS Steel Scrap", "Steel Scrap"],
    ["River Sand", "Sand"],
    ["Bitumen VG-30", "Bitumen"],
    ["red bricks", "Bricks"],
    ["सीमेंट की बोरियां", "Cement Bags"],
  ])("reads %s as %s", (text, name) => {
    expect(match(text)).toBe(name);
  });

  it.each([
    ["cemnt", "Cement Bags"],
    ["bitumin", "Bitumen"],
    ["agregate 20 mm", "Aggregate 20 mm"],
    ["stel skrap", "Steel Scrap"],
    ["stel bar 20 mm", "Steel Bars"],
    ["additiv", "Additive"],
  ])("forgives the spelling %s", (text, name) => {
    const found = matchMaterial(text, SEED_MATERIALS);
    expect(found?.material.name).toBe(name);
    expect(found!.score).toBeLessThan(1);
    expect(found!.score).toBeGreaterThan(0.7);
  });

  it.each([
    "",
    "   ",
    "???",
    "gravel",
    "cotton bales",
    "aggregate", // which size?
    "gitti",
    "40 mm aggregate", // a size we do not have
    "iron rod 20 mm", // not stone just because of the size
    "pipe 10mm",
    "20 mm material",
    "6mm agg",
    "200 mm aggregate",
    "10 mm and 20 mm aggregate", // two materials
    "cement and sand",
    "cement bricks",
    "steel", // bars or scrap?
    "20", // a number alone
    "aggregate 20 MT", // an amount, not a size
    "stone",
    "and",
    "car",
  ])("does not guess for %j", (text) => {
    expect(match(text)).toBeNull();
  });

  it("returns the material object it was given", () => {
    expect(matchMaterial("sand", SEED_MATERIALS)).toEqual({
      material: SEED_MATERIALS.find((m) => m.name === "Sand"),
      score: 1,
    });
  });

  it("finds nothing in an empty list, and ignores empty aliases", () => {
    expect(matchMaterial("sand", [])).toBeNull();
    expect(
      matchMaterial("sand", [{ name: "Sand", aliasesEn: [""], aliasesHi: [] }]),
    ).not.toBeNull();
  });
});
