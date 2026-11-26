import { LANGUAGES } from "@trinetra/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLanguageStore } from "./language-store";
import { DICTIONARIES, fill, translate } from "./translate";

const { en, hi } = DICTIONARIES;
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("t(): placeholders", () => {
  it("puts values in, numbers too, as 0-9 digits in both languages", () => {
    expect(translate("en", "error.locked", { seconds: 42 })).toBe(
      "Too many wrong PINs. Wait 42 seconds.",
    );
    expect(translate("hi", "error.locked", { seconds: 42 })).toContain("42 सेकंड");
  });

  it("fills every place, and more than one name", () => {
    expect(fill("{a} and {b}, then {a}", { a: "x", b: 0 })).toBe("x and 0, then x");
  });

  it("leaves a placeholder that has no value", () => {
    expect(fill("Hello {name}", {})).toBe("Hello {name}");
    expect(fill("Hello {name}")).toBe("Hello {name}");
    // Not an inherited property either.
    expect(fill("{toString}", {})).toBe("{toString}");
  });

  it("does not read a value as another placeholder or a pattern", () => {
    expect(fill("{a} {b}", { a: "{b}", b: "$&" })).toBe("{b} $&");
  });
});

describe("t(): missing keys", () => {
  afterEach(() => void vi.restoreAllMocks());

  it("shows the key itself and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(translate("hi", "no.such.key")).toBe("no.such.key");
    expect(warn).toHaveBeenCalledWith('No text for "no.such.key".');
  });

  it("falls back to English when only the Hindi text is missing", () => {
    const partial = { en: { greet: "Hello {name}" }, hi: {} };
    expect(translate("hi", "greet", { name: "Amit" }, partial)).toBe("Hello Amit");
  });
});

describe("the two translation files", () => {
  it("have the same keys, in the same order", () => {
    expect(Object.keys(hi)).toEqual(Object.keys(en));
  });

  it.each(Object.keys(en))("use the same placeholders for %s", (key) => {
    expect(placeholders(hi[key]!)).toEqual(placeholders(en[key]!));
  });

  it.each(LANGUAGES)("have no empty text (%s)", (language) => {
    for (const text of Object.values(DICTIONARIES[language])) expect(text.trim()).not.toBe("");
  });

  it("have Hindi text in Hindi letters, except names", () => {
    const names = ["app.name", "language.en"];
    const notHindi = Object.keys(hi).filter(
      (key) => !names.includes(key) && !/[ऀ-ॿ]/.test(hi[key]!),
    );
    expect(notHindi).toEqual([]);
  });
});

describe("the chosen language", () => {
  const state = () => useLanguageStore.getState();

  it("starts in English for drivers and staff", () => {
    expect(state()).toMatchObject({ kiosk: "en", staff: "en" });
  });

  it("is kept apart for the kiosk, and starts fresh for the next driver", () => {
    state().setLanguage("kiosk", "hi");
    expect(state()).toMatchObject({ kiosk: "hi", staff: "en" });
    state().setLanguage("staff", "hi");
    state().resetKioskLanguage();
    expect(state()).toMatchObject({ kiosk: "en", staff: "hi" });
  });

  it("saves only the staff language", () => {
    const saved = useLanguageStore.persist.getOptions().partialize!({
      ...state(),
      kiosk: "hi",
      staff: "hi",
    });
    expect(saved).toEqual({ staff: "hi" });
  });
});
