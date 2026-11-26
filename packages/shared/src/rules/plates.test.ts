import { describe, expect, it } from "vitest";
import { SEED_VEHICLES } from "../seed/default-data";
import { formatPlate, isValidIndianPlate, normalizePlate, platesMatch } from "./plates";

describe("normalizePlate", () => {
  it.each([
    "mh 12-ab 1234",
    "MH 12 AB 1234",
    "MH-12-AB-1234",
    "  mh12ab1234  ",
    "MH.12.AB.1234",
    "MH–12—AB 1234",
    "MH\t12\nAB·1234",
  ])("turns %j into MH12AB1234", (plate) => {
    expect(normalizePlate(plate)).toBe("MH12AB1234");
  });

  it("keeps other characters, so a bad read stays visibly bad", () => {
    expect(normalizePlate("MH12/AB?1234")).toBe("MH12/AB?1234");
    expect(normalizePlate("")).toBe("");
  });
});

describe("isValidIndianPlate", () => {
  it.each([
    "MH12AB1234",
    "mh 12-ab 1234",
    "DL1CAB1234",
    "UP32A0001",
    "RJ141234",
    "22BH1234AA",
    "22 BH 1234 A",
  ])("accepts %s", (plate) => {
    expect(isValidIndianPlate(plate)).toBe(true);
  });

  it.each([
    "",
    "MH12AB123",
    "MH12AB12345",
    "M12AB1234",
    "MHAB1234",
    "123456",
    "MH12ABCD1234",
    "22BH1234IO",
    "MH12/AB1234",
    "HELLO",
  ])("refuses %j", (plate) => {
    expect(isValidIndianPlate(plate)).toBe(false);
  });

  it("accepts every vehicle in the default data", () => {
    for (const { plate } of SEED_VEHICLES) expect(isValidIndianPlate(plate)).toBe(true);
  });
});

describe("formatPlate", () => {
  it.each([
    ["MH12AB1234", "MH 12 AB 1234"],
    ["mh-12-ab-1234", "MH 12 AB 1234"],
    ["DL1CAB1234", "DL 1 CAB 1234"],
    ["RJ141234", "RJ 14 1234"],
    ["22BH1234AA", "22 BH 1234 AA"],
    ["abc 123", "ABC123"],
  ])("shows %s as %s", (plate, shown) => {
    expect(formatPlate(plate)).toBe(shown);
  });
});

describe("platesMatch", () => {
  it("matches the same plate written differently", () => {
    expect(platesMatch("MH 12 AB 1234", "mh12-ab-1234")).toBe(true);
  });

  it.each([
    ["MH12AB1234", "MH12AB1235"],
    ["MH12AB1234", "MH12AB123"],
    ["MH12AB1234", ""],
    ["", ""],
    [" - ", " "],
  ])("front %j does not match back %j", (front, back) => {
    expect(platesMatch(front, back)).toBe(false);
  });
});
