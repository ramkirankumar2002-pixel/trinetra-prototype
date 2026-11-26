// Which supplier or transporter does this text mean?
import { fuzzyWords, indexOfWords, tokenize, words } from "./text";

export interface ListMatch {
  /** The name exactly as it appears in the list. */
  name: string;
  /** 1 for an exact match, lower for a partial or misspelled one. */
  score: number;
}

/** Legal wording that invoices add around a company name ("M/s ... Pvt. Ltd."). */
const COMPANY_FILLER = words("m s ms pvt private ltd limited llp and co");

const nameTokens = (text: string) => tokenize(text).filter((word) => !COMPANY_FILLER.has(word));

/**
 * Finds the one name the text means, or null when none or several fit. A name that only
 * partly agrees ("Shree Ram Traders" for "Shree Ram Crushers") does not match.
 */
export function matchFromList(text: string, names: readonly string[]): ListMatch | null {
  const heard = nameTokens(text);
  if (heard.length === 0) return null;
  const entries = names.map((name) => ({ name, tokens: nameTokens(name) }));

  /** The result of one way of matching: undefined means "try the next way". */
  const decide = (found: { name: string; score: number }[]): ListMatch | null | undefined => {
    if (found.length === 0) return undefined;
    return found.length === 1 ? found[0]! : null;
  };

  const same = entries.filter(({ tokens }) => tokens.join(" ") === heard.join(" "));
  const equal = decide(same.map(({ name }) => ({ name, score: 1 })));
  if (equal !== undefined) return equal;

  // The whole name inside longer text, such as a name followed by a town.
  const inside = entries.filter(({ tokens }) => indexOfWords(heard, tokens) >= 0);
  // "Sharma Traders" also contains "Sharma": keep the longest names.
  const longest = Math.max(0, ...inside.map(({ tokens }) => tokens.length));
  const contained = decide(
    inside
      .filter(({ tokens }) => tokens.length === longest)
      .map(({ name }) => ({ name, score: 0.95 })),
  );
  if (contained !== undefined) return contained;

  // The first two or more words of a name, as someone would say it for short.
  const starting = decide(
    entries
      .filter(({ tokens }) => heard.length >= 2 && indexOfWords(tokens, heard) === 0)
      .map(({ name }) => ({ name, score: 0.9 })),
  );
  if (starting !== undefined) return starting;

  const misspelled = entries.flatMap(({ name, tokens }) => {
    const score = fuzzyWords(heard, tokens);
    return score === null ? [] : [{ name, score: 0.9 - score }];
  });
  return decide(misspelled) ?? null;
}
