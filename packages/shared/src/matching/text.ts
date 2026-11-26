// Turns invoice text and spoken answers into comparable words, in English and Hindi.
import Fuse from "fuse.js";

const DEVANAGARI_ZERO = 0x0966;

/**
 * Lower case, with Hindi spelling variants made equal: nukta dots are dropped (ज़ = ज),
 * chandrabindu becomes anusvara (हाँ = हां) and Hindi digits become 0-9.
 */
export function cleanText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/़/g, "")
    .replace(/ँ/g, "ं")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO));
}

/** Words and numbers, with "20mm" split into "20" and "mm". */
export function tokenize(text: string): string[] {
  return (
    cleanText(text)
      .replace(/(\d)(?=[^\d\s])/g, "$1 ")
      .replace(/([^\d\s])(?=\d)/g, "$1 ")
      // \p{M} keeps Hindi vowel signs inside their word.
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

/** A word list written naturally, stored in the same cleaned form as the text it is compared with. */
export const words = (list: string): Set<string> => new Set(tokenize(list));

/** Two words that differ by about one typing or hearing mistake. */
export function similarWord(heard: string, expected: string): number | null {
  if (heard === expected) return 0;
  // Short words and numbers must be exact: "ten" is not "tan", "20" is not "200".
  if (/\d/.test(heard + expected) || heard.length < 4 || expected.length < 4) return null;
  if (heard[0] !== expected[0] || Math.abs(heard.length - expected.length) > 2) return null;
  const [found] = new Fuse([expected], {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.3,
  }).search(heard);
  return found?.score ?? null;
}

/** Where `part` appears in `tokens` as consecutive words, or -1. */
export function indexOfWords(tokens: readonly string[], part: readonly string[]): number {
  if (part.length === 0) return -1;
  return tokens.findIndex((_, start) => part.every((word, i) => tokens[start + i] === word));
}

/**
 * Like indexOfWords but allowing one small mistake per word. Returns the average score of
 * the best place (0 is exact), or null if there is none.
 */
export function fuzzyWords(tokens: readonly string[], part: readonly string[]): number | null {
  let best: number | null = null;
  for (let start = 0; start + part.length <= tokens.length && part.length > 0; start++) {
    const scores = part.map((word, i) => similarWord(tokens[start + i]!, word));
    if (scores.some((score) => score === null)) continue;
    const average = (scores as number[]).reduce((sum, score) => sum + score, 0) / part.length;
    if (best === null || average < best) best = average;
  }
  return best;
}
