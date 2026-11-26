// Yes/no answers and spoken digits, in English and Hindi (build plan section 9).
import { tokenize, words } from "./text";

const NO = words("no nope nahin nahi nai na galat wrong नहीं नही ना गलत");
const NEGATOR = words("not nahin nahi nai na नहीं नही ना");
const PLAIN_YES = words("yes yeah yep haan han ha हां हा");
/** These agree on their own, but "sahi nahin" and "not correct" mean no. */
const AGREEING = words("sahi theek thik correct right ok okay सही ठीक");
/** "Ji" is politeness: "ji nahin" is a no. */
const POLITE_YES = words("ji जी");
const WRONG = words("galat wrong गलत");

/** "yes", "no", or null when the answer is unclear, so the kiosk can ask again. */
export function parseYesNo(text: string): "yes" | "no" | null {
  const heard = tokenize(text);
  const has = (list: Set<string>) => heard.some((word) => list.has(word));

  const no = has(NO) || has(NEGATOR);
  if (!no) return has(PLAIN_YES) || has(AGREEING) || has(POLITE_YES) ? "yes" : null;
  // "haan nahin" says both; "galat nahin" (not wrong) is too unclear to act on.
  if (has(PLAIN_YES) || (has(WRONG) && has(NEGATOR))) return null;
  // A lone "not" with nothing it denies says nothing.
  const denies = has(NO) || has(AGREEING);
  return denies ? "no" : null;
}

const DIGIT_WORDS = new Map(
  (
    [
      ["0", "zero oh o shunya sunya शून्य ज़ीरो जीरो सिफर"],
      ["1", "one ek एक वन"],
      ["2", "two do दो टू"],
      ["3", "three teen tin तीन थ्री"],
      ["4", "four char chaar चार फोर"],
      ["5", "five paanch panch पांच पाँच फाइव"],
      ["6", "six chhe chhah chah cheh che छह छः छे सिक्स"],
      ["7", "seven saat sat सात सेवन"],
      ["8", "eight aath aat आठ एट"],
      ["9", "nine nau no9 नौ नाइन"],
    ] as const
  ).flatMap(([digit, list]) => [...words(list)].map((word) => [word, digit] as const)),
);

const REPEATS = new Map(
  (
    [
      [2, "double dabal डबल"],
      [3, "triple tripal ट्रिपल"],
    ] as const
  ).flatMap(([times, list]) => [...words(list)].map((word) => [word, times] as const)),
);

/** Words people say around a phone number. */
const DIGIT_FILLER = words(
  "my mera mere number nambar phone mobile is hai and plus मेरा मेरे नंबर फोन मोबाइल है और",
);

/**
 * The digits in a spoken or typed phone number: "nine eight double seven" -> "9877".
 * Returns null if any word is not understood, rather than dropping part of a number.
 * It does not check the length; the caller decides how many digits it needs.
 */
export function parseDigits(text: string): string | null {
  let digits = "";
  let repeat = 1;
  for (const word of tokenize(text)) {
    const times = REPEATS.get(word);
    if (times !== undefined) {
      if (repeat !== 1) return null;
      repeat = times;
      continue;
    }
    const digit = /^\d+$/.test(word) ? word : DIGIT_WORDS.get(word);
    if (digit === undefined) {
      if (DIGIT_FILLER.has(word) && repeat === 1) continue;
      return null;
    }
    // "double 98" could mean two things.
    if (repeat > 1 && digit.length > 1) return null;
    digits += digit.repeat(repeat);
    repeat = 1;
  }
  return repeat === 1 && digits !== "" ? digits : null;
}
