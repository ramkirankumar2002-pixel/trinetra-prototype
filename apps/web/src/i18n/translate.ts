// t(): the screen text in English or Hindi, with {placeholders}. Both files have the same
// keys; a test makes sure of it. Numbers are shown in 0-9 digits in both languages.
import type { Language } from "@trinetra/shared";
import en from "./en.json";
import hi from "./hi.json";

export type MessageKey = keyof typeof en;
export type MessageParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

export type Dictionaries = Record<Language, Readonly<Record<string, string>>>;
export const DICTIONARIES: Dictionaries = { en, hi };

/** "Wait {seconds} seconds." A placeholder with no value stays, so the mistake is seen. */
export const fill = (text: string, params: MessageParams = {}): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );

export function translate(
  language: Language,
  key: string,
  params?: MessageParams,
  dictionaries: Dictionaries = DICTIONARIES,
): string {
  const text = dictionaries[language][key] ?? dictionaries.en[key];
  if (text === undefined) {
    // Shown as the key itself: odd to see, but the screen still works.
    if (process.env.NODE_ENV !== "production") console.warn(`No text for "${key}".`);
    return key;
  }
  return fill(text, params);
}
