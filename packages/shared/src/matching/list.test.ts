import { describe, expect, it } from "vitest";
import { SEED_SUPPLIERS, SEED_TRANSPORTERS } from "../seed/default-data";
import { matchFromList } from "./list";

const supplier = (text: string) => matchFromList(text, SEED_SUPPLIERS)?.name ?? null;

describe("matchFromList", () => {
  it("matches every default supplier and transporter exactly", () => {
    for (const list of [SEED_SUPPLIERS, SEED_TRANSPORTERS]) {
      for (const name of list) {
        expect(matchFromList(name, list)).toEqual({ name, score: 1 });
      }
    }
  });

  it.each([
    ["SHREE RAM CRUSHERS", "Shree Ram Crushers"],
    ["M/s. Shree Ram Crushers Pvt. Ltd.", "Shree Ram Crushers"],
    ["Shree Ram Crushers, Raipur", "Shree Ram Crushers"],
    ["shree ram", "Shree Ram Crushers"],
    ["Shree Ram Crusher", "Shree Ram Crushers"],
    ["ganga steal traders", "Ganga Steel Traders"],
    ["Narmada Sand Supplier", "Narmada Sand Suppliers"],
  ])("reads %s as %s", (text, name) => {
    expect(supplier(text)).toBe(name);
  });

  it.each([
    "",
    "Pvt Ltd",
    "Shree Ram Traders", // another company
    "Ganga Cement Traders",
    "Traders",
    "Sample",
    "Shree",
    "Unknown Supplier",
  ])("does not match %j", (text) => {
    expect(supplier(text)).toBeNull();
  });

  it("gives a lower score to partial and misspelled names", () => {
    const score = (text: string) => matchFromList(text, SEED_SUPPLIERS)!.score;
    expect(score("Shree Ram Crushers, Raipur")).toBe(0.95);
    expect(score("shree ram")).toBe(0.9);
    expect(score("ganga steal traders")).toBeLessThan(0.9);
  });

  it("works for transporters", () => {
    expect(matchFromList("balaji", SEED_TRANSPORTERS)).toBeNull();
    expect(matchFromList("sri balaji", SEED_TRANSPORTERS)?.name).toBe("Sri Balaji Transport");
    expect(matchFromList("Kisan Roadline", SEED_TRANSPORTERS)?.name).toBe("Kisan Roadlines");
  });

  it("does not choose between two names that both fit", () => {
    const names = ["Sharma Traders North", "Sharma Traders South"];
    expect(matchFromList("Sharma Traders", names)).toBeNull();
    expect(matchFromList("Sharma Traders South", names)?.name).toBe("Sharma Traders South");
    expect(matchFromList("A B and C D", ["A B", "C D"])).toBeNull();
    expect(matchFromList("Gupta Stone", ["Gupta Stones", "Gupta Stonex"])).toBeNull();
    expect(matchFromList("Gupta", ["Gupta", "gupta"])).toBeNull();
  });

  it("prefers the longer of two names found in the text", () => {
    expect(matchFromList("Sharma Traders, Pune", ["Sharma", "Sharma Traders"])?.name).toBe(
      "Sharma Traders",
    );
  });

  it("finds nothing in an empty list", () => {
    expect(matchFromList("Shree Ram", [])).toBeNull();
  });
});
