import { describe, expect, it } from "vitest";
import { formatIST, formatKg, ticketNumber, formatDate } from "./format";
import { APP_NAME, WEIGHBRIDGE_ID } from "./index";
import { SEED_SETTINGS } from "./seed/default-data";

describe("ticketNumber", () => {
  const noon = new Date("2026-11-26T06:30:00Z");

  it("is weighbridge, date and a 4 digit running number", () => {
    expect(ticketNumber(noon, 1)).toBe("WB01-20261126-0001");
    expect(ticketNumber(noon, 42)).toBe("WB01-20261126-0042");
    expect(ticketNumber(noon, 9999)).toBe("WB01-20261126-9999");
  });

  it("grows past 9999 instead of repeating", () => {
    expect(ticketNumber(noon, 10_000)).toBe("WB01-20261126-10000");
  });

  it("uses the date in India: midnight there is 18:30 UTC", () => {
    expect(ticketNumber(new Date("2026-11-26T18:29:59.999Z"), 1)).toBe("WB01-20261126-0001");
    expect(ticketNumber(new Date("2026-11-26T18:30:00Z"), 1)).toBe("WB01-20261127-0001");
    expect(ticketNumber(new Date("2026-12-31T20:00:00Z"), 7)).toBe("WB01-20270101-0007");
  });

  it("takes the weighbridge id", () => {
    expect(ticketNumber(noon, 1, "wb-02")).toBe("WB02-20261126-0001");
    expect(WEIGHBRIDGE_ID).toBe(SEED_SETTINGS.weighbridge_id);
    expect(APP_NAME).toBe("Trinetra Systems");
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses the running number %s", (number) => {
    expect(() => ticketNumber(noon, number)).toThrow(RangeError);
  });

  it("refuses an invalid date", () => {
    expect(() => ticketNumber(new Date("nonsense"), 1)).toThrow(RangeError);
  });
});

describe("formatKg", () => {
  it.each([
    [0, "0 kg"],
    [5, "5 kg"],
    [999, "999 kg"],
    [1000, "1,000 kg"],
    [32_560, "32,560 kg"],
    [100_000, "1,00,000 kg"],
    [3_256_000, "32,56,000 kg"],
    [12_345_678, "1,23,45,678 kg"],
    [-14_310, "-14,310 kg"],
    [-100, "-100 kg"],
    [32_559.6, "32,560 kg"],
    [-0.2, "0 kg"],
  ])("shows %s as %s", (kg, shown) => {
    expect(formatKg(kg)).toBe(shown);
  });

  it("agrees with the browser's Indian number format", () => {
    for (const kg of [1, 12, 123, 1234, 12_345, 123_456, 1_234_567, 987_654_321]) {
      expect(formatKg(kg)).toBe(`${new Intl.NumberFormat("en-IN").format(kg)} kg`);
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (kg) => {
    expect(() => formatKg(kg)).toThrow(RangeError);
  });
});

describe("formatIST", () => {
  it.each([
    ["2026-11-26T08:35:00Z", "26 Nov 2026, 14:05 IST"],
    ["2026-01-05T03:37:59Z", "5 Jan 2026, 09:07 IST"],
    ["2026-11-26T18:30:00Z", "27 Nov 2026, 00:00 IST"],
    ["2026-12-31T23:00:00Z", "1 Jan 2027, 04:30 IST"],
    ["2026-07-15T14:05:00+05:30", "15 Jul 2026, 14:05 IST"],
  ])("shows %s as %s", (moment, shown) => {
    expect(formatIST(new Date(moment))).toBe(shown);
  });

  it("refuses an invalid date", () => {
    expect(() => formatIST(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  it("writes a bill's date like every other date", () => {
    expect(formatDate("2026-11-26")).toBe("26 Nov 2026");
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
  });

  it("leaves what it cannot read as it is", () => {
    for (const text of ["26/11/2026", "2026-13-01", "2026-11-00", "", "soon"]) {
      expect(formatDate(text)).toBe(text);
    }
  });
});
