// Finding a string in the text of a page.
//
// The page reaches the finder as chunks — one per text node, with an
// artificial "\n" wherever a block ends — and a match comes back in the same
// coordinates. Both halves of that matter: a match has to run through the
// nodes of “sen**tence**”, and it must never run from the end of one paragraph
// into the beginning of the next.

import { describe, expect, it } from "vitest";
import {
  findMatches,
  firstMatchFrom,
  foldCase,
  stepMatch,
  type FindMatch,
} from "../../webviews/shared/findModel";

/** The matched text, read back out of the chunks it points into. */
function texts(chunks: string[], matches: FindMatch[]): string[] {
  return matches.map((m) => m.parts.map((p) => chunks[p.chunk].slice(p.start, p.end)).join(""));
}

describe("finding a string", () => {
  it("finds every occurrence, in reading order", () => {
    const chunks = ["Install the theme", "\n", "Install it again"];
    const matches = findMatches(chunks, "install");
    expect(matches).toHaveLength(2);
    expect(matches[0].start).toBe(0);
    expect(matches[1].start).toBe(18);
  });

  it("ignores case unless asked not to", () => {
    const chunks = ["Material and material"];
    expect(findMatches(chunks, "material")).toHaveLength(2);
    expect(findMatches(chunks, "material", { caseSensitive: true })).toHaveLength(1);
    expect(findMatches(chunks, "Material", { caseSensitive: true })[0].start).toBe(0);
  });

  it("runs a match through the nodes a word is split across", () => {
    const chunks = ["sen", "tence", " ends"];
    const matches = findMatches(chunks, "sentence");
    expect(matches).toHaveLength(1);
    expect(matches[0].parts).toEqual([
      { chunk: 0, start: 0, end: 3 },
      { chunk: 1, start: 0, end: 5 },
    ]);
    expect(texts(chunks, matches)).toEqual(["sentence"]);
  });

  it("never runs a match across a block boundary", () => {
    // Two paragraphs: “…the” and “me…”. Without the boundary chunk between them
    // the join reads “theme” and the search would report a word nobody wrote.
    const chunks = ["Read the", "\n", "me first"];
    expect(findMatches(chunks, "theme")).toHaveLength(0);
  });

  it("matches whole words only when told to", () => {
    const chunks = ["a cat in concatenate, and a cat"];
    expect(findMatches(chunks, "cat")).toHaveLength(3);
    const whole = findMatches(chunks, "cat", { wholeWord: true });
    expect(whole).toHaveLength(2);
    expect(whole[0].start).toBe(2);
    expect(whole[1].start).toBe(28);
  });

  it("counts word boundaries by letters and digits of any script", () => {
    const chunks = ["Θέμα θέματος"];
    // The second word contains the first, so “whole word” must reject it.
    expect(findMatches(chunks, "θέμα", { wholeWord: true })).toHaveLength(1);
  });

  it("does not overlap matches", () => {
    expect(findMatches(["aaaa"], "aa")).toHaveLength(2);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches(["text"], "")).toEqual([]);
  });

  it("reports offsets the text can be sliced with", () => {
    const chunks = ["Grid cards", "\n", "Cards again"];
    const joined = chunks.join("");
    for (const m of findMatches(chunks, "cards")) {
      expect(joined.slice(m.start, m.end).toLowerCase()).toBe("cards");
    }
  });
});

describe("folding case without moving offsets", () => {
  it("keeps the length of text that lower-cases into more code units", () => {
    // “İ”.toLowerCase() is two code units; taken as is, every offset after it
    // would be off by one and the highlight would land beside the word.
    const text = "İstanbul ISTANBUL";
    expect(foldCase(text)).toHaveLength(text.length);
  });

  it("still finds the plain letters around such a character", () => {
    const chunks = ["İstanbul and ISTANBUL"];
    const matches = findMatches(chunks, "istanbul");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const last = matches[matches.length - 1];
    expect(chunks[0].slice(last.start, last.end)).toBe("ISTANBUL");
  });
});

describe("moving between matches", () => {
  const matches = findMatches(["one two one two one"], "one");

  it("wraps around at both ends", () => {
    expect(stepMatch(0, matches.length, -1)).toBe(2);
    expect(stepMatch(2, matches.length, 1)).toBe(0);
    expect(stepMatch(0, matches.length, 1)).toBe(1);
  });

  it("says there is nowhere to go with no matches", () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1);
  });

  it("resumes at the first match after the place we were", () => {
    expect(firstMatchFrom(matches, 0)).toBe(0);
    expect(firstMatchFrom(matches, 1)).toBe(1);
    expect(firstMatchFrom(matches, matches[2].start)).toBe(2);
    // Past the last one the search wraps to the top rather than losing its place.
    expect(firstMatchFrom(matches, 999)).toBe(0);
    expect(firstMatchFrom([], 5)).toBe(-1);
  });
});
