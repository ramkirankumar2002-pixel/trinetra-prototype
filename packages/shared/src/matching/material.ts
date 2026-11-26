// Which material does this text mean? Used for invoice text now, and for voice later.
// When two materials fit, or a size we do not have is named, the answer is "no match".
import { fuzzyWords, indexOfWords, tokenize, words } from "./text";

export interface MatchableMaterial {
  name: string;
  aliasesEn: readonly string[];
  aliasesHi: readonly string[];
}

export interface MaterialMatch<M> {
  material: M;
  /** 1 for an exact match, lower when spelling mistakes were forgiven. */
  score: number;
}

const MILLIMETRE = words("mm mms millimeter millimeters millimetre millimetres एमएम मिमी");
const AGGREGATE = words("aggregate aggregates agg aggr gitti गिट्टी");
/** A number before one of these is an amount, not a stone size. */
const AMOUNT_UNIT = words("kg kgs mt ton tons tonne tonnes t bag bags nos किलो टन");

const NUMBER_WORDS = new Map(
  (
    [
      ["10", "ten das दस"],
      ["12", "twelve barah बारह"],
      ["20", "twenty bees bis बीस"],
      ["40", "forty chalis chaalis चालीस"],
    ] as const
  ).flatMap(([value, list]) => [...words(list)].map((word) => [word, value] as const)),
);

const isNumber = (token: string) => /^\d+$/.test(token);

/** Material words in one standard spelling: "bees एम एम गिट्टी" -> 20 mm aggregate. */
export function materialTokens(text: string): string[] {
  const tokens = tokenize(text);
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    // "m m" (from "M.M.") and "एम एम" are one unit.
    if ((token === "m" && next === "m") || (token === "एम" && next === "एम")) {
      result.push("mm");
      i++;
    } else if (MILLIMETRE.has(token)) result.push("mm");
    else if (AGGREGATE.has(token)) result.push("aggregate");
    else result.push(NUMBER_WORDS.get(token) ?? token);
  }
  return result;
}

/** Words that may surround a size without naming a material: "bees mm wali". */
const SIZE_FILLER = words("size wala wali वाला वाली साइज");

/** "20 mm" alone names a size, not a material: steel bars come in millimetres too. */
const isSizeOnly = (alias: readonly string[]) =>
  alias.every((token) => token === "mm" || isNumber(token));

interface Prepared<M> {
  material: M;
  /** The number in the name, e.g. "20" for "Aggregate 20 mm". */
  size: string | undefined;
  nameTokens: string[];
  aliases: string[][];
}

function prepare<M extends MatchableMaterial>(material: M): Prepared<M> {
  const nameTokens = materialTokens(material.name);
  return {
    material,
    size: nameTokens.find(isNumber),
    nameTokens,
    aliases: [material.name, ...material.aliasesEn, ...material.aliasesHi]
      .map(materialTokens)
      .filter((alias) => alias.length > 0),
  };
}

/** A sized material needs its size in the text, and no other millimetre size. */
function sizeFits<M>({ size }: Prepared<M>, text: readonly string[]): boolean {
  if (size === undefined) return true;
  const millimetreSizes = text.filter((token, i) => isNumber(token) && text[i + 1] === "mm");
  if (millimetreSizes.some((other) => other !== size)) return false;
  return text.some((token, i) => token === size && !AMOUNT_UNIT.has(text[i + 1] ?? ""));
}

function only<T>(items: T[]): T | null {
  return items.length === 1 ? items[0]! : null;
}

export function matchMaterial<M extends MatchableMaterial>(
  text: string,
  materials: readonly M[],
): MaterialMatch<M> | null {
  const tokens = materialTokens(text);
  if (tokens.length === 0) return null;
  const candidates = materials.map(prepare).filter((candidate) => sizeFits(candidate, tokens));

  // 1. Exact words. A material named in words beats one that only shares a size.
  const named = candidates.filter(
    ({ aliases, size, nameTokens }) =>
      aliases.some((alias) => !isSizeOnly(alias) && indexOfWords(tokens, alias) >= 0) ||
      // "coarse aggregate of 20": every word of a sized name, in any order.
      (size !== undefined && nameTokens.every((word) => word === "mm" || tokens.includes(word))),
  );
  // A bare size counts only when the text says nothing else: "iron rod 20 mm" is not stone.
  const onlyASize = tokens.every(
    (token) => token === "mm" || isNumber(token) || SIZE_FILLER.has(token),
  );
  const sizeOnly = candidates.filter(({ aliases }) =>
    aliases.some((alias) => isSizeOnly(alias) && indexOfWords(tokens, alias) >= 0),
  );
  const exact = named.length > 0 || !onlyASize ? named : sizeOnly;
  if (exact.length > 0) {
    const match = only(exact);
    return match && { material: match.material, score: 1 };
  }

  // 2. Spelling mistakes, only when nothing matched exactly.
  const close = candidates.flatMap((candidate) => {
    const scores = candidate.aliases
      .filter((alias) => !isSizeOnly(alias))
      .map((alias) => fuzzyWords(tokens, alias))
      .filter((score) => score !== null);
    return scores.length > 0 ? [{ candidate, score: Math.min(...scores) }] : [];
  });
  const match = only(close);
  return match && { material: match.candidate.material, score: 1 - match.score };
}
