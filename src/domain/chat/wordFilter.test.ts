import { describe, expect, it } from "vitest";
import { DEFAULT_BLOCKED_WORDS, findBlockedWord, normalizeBlockword } from "./wordFilter";

const LIST = ["fuck", "con", "connard", "nique ta mere", "négro"];

describe("normalizeBlockword", () => {
  it("trims, lower-cases, folds accents, collapses inner whitespace", () => {
    expect(normalizeBlockword("  CôN  ")).toBe("con");
    expect(normalizeBlockword("Nique   Ta\tMère")).toBe("nique ta mere");
  });
});

describe("findBlockedWord", () => {
  it("returns null for clean text", () => {
    expect(findBlockedWord("gg wp everyone, close game", LIST)).toBeNull();
    expect(findBlockedWord("", LIST)).toBeNull();
    expect(findBlockedWord("anything", [])).toBeNull();
  });

  it("matches a whole word regardless of case or accents", () => {
    expect(findBlockedWord("you FUCK", LIST)).toBe("fuck");
    expect(findBlockedWord("quel con", LIST)).toBe("con");
    expect(findBlockedWord("t'es un négro", LIST)).toBe("négro");
    expect(findBlockedWord("t'es un negro", LIST)).toBe("négro");
    expect(findBlockedWord("nique ta mere", LIST)).toBe("nique ta mere");
  });

  it("does NOT fire a short word inside a longer word (no Scunthorpe problem)", () => {
    expect(findBlockedWord("attends une seconde", LIST)).toBeNull(); // "con" inside "seconde"
    expect(findBlockedWord("le concombre est bon", LIST)).toBeNull();
    expect(findBlockedWord("Connecticut", LIST)).toBeNull();
    expect(findBlockedWord("j'ai une belle collection", LIST)).toBeNull();
  });

  it("does NOT fire a 4+ entry mid-word either (gap match stays anchored)", () => {
    expect(findBlockedWord("j'adore ce concombre", ["combre"])).toBeNull();
    expect(findBlockedWord("grape drape scrape", ["rape"])).toBeNull();
    expect(findBlockedWord("un violon et une violette", ["viol"])).toBeNull();
  });

  it("catches spacing / punctuation / leet / repeat evasions on 4+ entries", () => {
    expect(findBlockedWord("f u c k you", LIST)).toBe("fuck");
    expect(findBlockedWord("f.u.c.k", LIST)).toBe("fuck");
    expect(findBlockedWord("fuuuuck", LIST)).toBe("fuck");
    expect(findBlockedWord("c0nn4rd", LIST)).toBe("connard");
    expect(findBlockedWord("c-o-n-n-a-r-d", LIST)).toBe("connard");
    expect(findBlockedWord("conard", LIST)).toBe("connard"); // dropped repeat
    expect(findBlockedWord("bande de connards", LIST)).toBe("connard"); // plural tail
    expect(findBlockedWord("nique   ta    mere", LIST)).toBe("nique ta mere");
  });

  it("still does not fire on a longer word that merely starts with the entry", () => {
    expect(findBlockedWord("le mot connardise n'existe pas", ["connard"])).toBeNull();
    expect(findBlockedWord("assumer ses choix", ["assum"])).toBeNull();
  });

  it("does NOT evasion-match a 3-letter entry", () => {
    expect(findBlockedWord("c o n", LIST)).toBeNull();
  });

  it("the shipped default list has no empty / duplicate entries", () => {
    const norm = DEFAULT_BLOCKED_WORDS.map(normalizeBlockword);
    expect(norm.every((w) => w.length > 0)).toBe(true);
    expect(new Set(norm).size).toBe(norm.length);
  });

  it("every default entry catches itself", () => {
    for (const w of DEFAULT_BLOCKED_WORDS) {
      expect(findBlockedWord(`hey ${w} lol`, DEFAULT_BLOCKED_WORDS)).not.toBeNull();
    }
  });

  it("a normal gameshow message with the default list stays clean", () => {
    const lines = [
      "gg wp!",
      "trop stylé ce round",
      "attends 2 secondes je réfléchis",
      "j'ai buzz trop tard aaargh",
      "Team B on lâche rien",
      "quelqu'un connaît la réponse ?",
      "c'était quel pays déjà",
    ];
    for (const line of lines) expect(findBlockedWord(line, DEFAULT_BLOCKED_WORDS)).toBeNull();
  });
});
