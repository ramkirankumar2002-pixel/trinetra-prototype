import { describe, expect, it } from "vitest";
import { parseDigits, parseYesNo } from "./speech";
import { cleanText, similarWord, tokenize } from "./text";

describe("parseYesNo", () => {
  it.each([
    "yes",
    "Yes!",
    "yeah",
    "haan",
    "हाँ",
    "हां",
    "ji",
    "जी",
    "sahi",
    "सही",
    "theek",
    "ठीक है",
    "haan ji",
    "sahi hai",
    "yes that is correct",
  ])("hears %s as yes", (text) => {
    expect(parseYesNo(text)).toBe("yes");
  });

  it.each([
    "no",
    "No.",
    "nahin",
    "nahi",
    "नहीं",
    "नही",
    "galat",
    "गलत",
    "ji nahin",
    "जी नहीं",
    "sahi nahin hai",
    "सही नहीं",
    "theek nahi",
    "not correct",
    "no it is wrong",
    "galat hai",
  ])("hears %s as no", (text) => {
    expect(parseYesNo(text)).toBe("no");
  });

  it.each(["", "maybe", "cement", "haan nahin", "yes no", "galat nahin", "not", "yesterday"])(
    "asks again for %j",
    (text) => {
      expect(parseYesNo(text)).toBeNull();
    },
  );
});

describe("parseDigits", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["98765-43210", "9876543210"],
    ["nine eight seven six five four three two one zero", "9876543210"],
    ["नौ आठ सात छह पांच चार तीन दो एक शून्य", "9876543210"],
    ["nau aath saat chhe paanch char teen do ek shunya", "9876543210"],
    ["९८७६५४३२१०", "9876543210"],
    ["पाँच छः ज़ीरो", "560"],
    ["nine double eight", "988"],
    ["triple five oh one", "55501"],
    ["डबल नौ ट्रिपल दो", "99222"],
    ["double 9 triple 0", "99000"],
    ["my phone number is 98 double 7 65", "987765"],
    ["मेरा नंबर नौ आठ है", "98"],
    ["+91 98765 43210", "919876543210"],
  ])("reads %s as %s", (text, digits) => {
    expect(parseDigits(text)).toBe(digits);
  });

  it.each([
    "",
    "my number is",
    "ninety eight", // compound numbers are not supported, so ask again
    "nine eight hundred",
    "nine maybe eight",
    "double",
    "nine double",
    "double triple five",
    "double 98",
    "double number five",
  ])("does not guess for %j", (text) => {
    expect(parseDigits(text)).toBeNull();
  });
});

describe("text helpers", () => {
  it("makes Hindi spelling variants equal", () => {
    expect(cleanText("हाँ ज़ीरो ५")).toBe(cleanText("हां जीरो 5"));
  });

  it("splits numbers from units and drops punctuation", () => {
    expect(tokenize("Agg-20mm, (बीस)")).toEqual(["agg", "20", "mm", "बीस"]);
  });

  it("only forgives mistakes in longer words with the same first letter", () => {
    expect(similarWord("cement", "cement")).toBe(0);
    expect(similarWord("cemnt", "cement")).toBeGreaterThan(0);
    expect(similarWord("band", "sand")).toBeNull();
    expect(similarWord("tan", "ten")).toBeNull();
    expect(similarWord("200", "2000")).toBeNull();
    expect(similarWord("cat", "catalogue")).toBeNull();
    expect(similarWord("stone", "steel")).toBeNull();
  });
});
