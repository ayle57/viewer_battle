/**
 * Chat word filter — a Host-managed blocklist applied to PLAYER chat
 * messages only (TEAM_A / TEAM_B). The Host is the moderator, not a
 * target, and Display can't post at all, so this only ever runs on a
 * `TEAM_A`/`TEAM_B` `chat:send` (see src/server/sockets/chat.ts).
 *
 * The blocklist lives in Postgres (`BlockedWord` — one row per entry,
 * edited from the Admin panel) so the operator curates it live
 * without a deploy. `DEFAULT_BLOCKED_WORDS` below is the starter set the
 * server seeds that table with the first time it's empty
 * (src/server/db/blockedWords.ts) — a floor, not a ceiling.
 *
 * Matching is deliberately a little fuzzy so the obvious evasions don't
 * walk straight through, WITHOUT the Scunthorpe problem (a short entry
 * like "con" must never fire inside "seconde" / "concombre"):
 *   1. accent-folded, case-insensitive WHOLE-WORD match — the entry as
 *      its own token, never a substring of a longer word;
 *   2. a "gap" pass for entries of 4+ letters: the entry's letters, in
 *      order, each allowed to repeat and to be separated by non-letters,
 *      with leetspeak folded first — catches "f u c k", "f.u.c.k",
 *      "fuuuck", "c0nn4rd" — but still anchored on both sides so it
 *      can't fire mid-word ("grape" never trips "rape").
 * A hit blocks the whole message; nothing is censored-and-forwarded.
 */

/** Fold accents/diacritics: "câliss" -> "caliss", "négro" -> "negro". */
function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Common letter-for-symbol swaps people use to slip a word past a filter. */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "€": "e",
  "!": "i",
  "|": "i",
  "+": "t",
};

function foldLeet(input: string): string {
  return input.replace(/[0134578|+@$€!]/g, (ch) => LEET[ch] ?? ch);
}

/** The canonical form an entry is stored and compared as: trimmed, lower-case, accent-folded, inner whitespace collapsed. */
export function normalizeBlockword(raw: string): string {
  return stripDiacritics(raw.trim().toLowerCase()).replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the "gap" regex source for one entry: each letter (consecutive
 * dupes merged) may repeat and be separated from the next by a little
 * junk, an optional plural tail is allowed, and it's anchored on both
 * sides so it still can't fire mid-word. Junk runs are length-capped so
 * the pattern can't backtrack pathologically on a long message.
 */
function gapPattern(word: string): string {
  const letters = word.replace(/[^a-z0-9]/g, "");
  if (letters.length < 4) return "";
  const merged = letters.replace(/(.)\1+/g, "$1"); // "connard" -> "conard"
  const gap = "[^a-z0-9]{0,4}";
  const body = [...merged].map((ch) => `(?:${escapeRegExp(ch)}${gap})+`).join("");
  return `(?<![a-z0-9])${body}(?:e?s)?(?![a-z0-9])`;
}

/**
 * Returns the FIRST blocklist entry `text` trips, or `null` if it's
 * clean. The returned string is the entry as it was passed in.
 */
export function findBlockedWord(text: string, blocklist: readonly string[]): string | null {
  if (!text || blocklist.length === 0) return null;

  const plain = stripDiacritics(text.toLowerCase());
  const folded = foldLeet(plain);

  for (const entry of blocklist) {
    const word = normalizeBlockword(entry);
    if (!word) continue;

    // 1. Whole-word (token) match — never fires inside a longer word.
    const wholeWord = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "u");
    if (wholeWord.test(plain)) return entry;

    // 2. Evasion / gap match — anchored, so still no mid-word hits.
    const pattern = gapPattern(foldLeet(word));
    if (pattern && new RegExp(pattern).test(folded)) return entry;
  }

  return null;
}

/**
 * Starter blocklist seeded into the `BlockedWord` table on first run.
 * Kept to genuinely hostile language — slurs (racist / homophobic /
 * transphobic / ableist) and the hardest profanity, EN + FR, since this
 * is a French-facing stream — NOT mild words ("damn", "merde", "crap"),
 * and NOT the most false-positive-prone terms ("rape"/"viol" trip
 * "grape"/"violet"/"râpé" — the operator can add those with judgement). Base
 * forms only; the folding above covers spacing / leet / repeat variants.
 * The operator trims or extends this from the Admin panel — a reasonable
 * default, not a definitive list.
 */
export const DEFAULT_BLOCKED_WORDS: readonly string[] = [
  // --- English slurs ---
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "retarded",
  "tranny",
  "coon",
  "chink",
  "kike",
  "wetback",
  "gook",
  "dyke",

  // --- English hard profanity ---
  "cunt",
  "motherfucker",
  "cocksucker",
  "whore",

  // --- French slurs ---
  "negre",
  "negro",
  "bougnoule",
  "bougnoul",
  "bicot",
  "pede",
  "tapette",
  "tarlouze",
  "gouine",
  "mongolien",
  "trisomique",
  "youpin",
  "chinetoque",
  "niakoue",
  "sale juif",
  "sale arabe",
  "sale negre",

  // --- French hard profanity ---
  "enculer",
  "encule",
  "enfoire",
  "connard",
  "connasse",
  "salope",
  "nique ta mere",
  "nique ta race",
  "fils de pute",
  "pute",
  "ntm",
];
