/**
 * Finding a string in the text of a page — the rules, with no DOM in sight.
 *
 * The page arrives as a list of chunks (one per text node, plus artificial
 * separators at block boundaries) and a match is reported back in the same
 * coordinates: which chunk, and where inside it. That is what lets a match
 * span the nodes of “sen**tence**” while never running from the end of one
 * paragraph into the beginning of the next.
 *
 * Covered by test/unit/findModel.test.ts.
 */

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** The part of a match that falls inside one chunk. */
export interface MatchPart {
  chunk: number;
  start: number;
  end: number;
}

export interface FindMatch {
  /** Offset in the chunks joined together — what “the next match from here” is measured in. */
  start: number;
  end: number;
  parts: MatchPart[];
}

/** A word character for “whole word”: any letter or digit, plus the underscore. */
const WORD = /[\p{L}\p{N}_]/u;

/**
 * Lower-cases the text WITHOUT changing its length.
 *
 * `String.toLowerCase` may not preserve it — “İ” becomes two code units — and a
 * single such letter would shift every offset after it, so the highlight would
 * land beside the word it found. The fast path is the common one; the fallback
 * folds unit by unit and keeps whatever refuses to fold to one.
 */
export function foldCase(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    return lower;
  }
  let out = "";
  for (const ch of text) {
    const one = ch.toLowerCase();
    out += one.length === ch.length ? one : ch;
  }
  return out;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

/** Where each chunk begins in the joined text. */
function chunkStarts(chunks: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const chunk of chunks) {
    starts.push(at);
    at += chunk.length;
  }
  return starts;
}

/** Cuts a [start, end) range of the joined text into per-chunk parts. */
function partsOf(
  chunks: readonly string[],
  starts: readonly number[],
  start: number,
  end: number,
  from: number,
): MatchPart[] {
  const parts: MatchPart[] = [];
  for (let i = from; i < chunks.length && starts[i] < end; i++) {
    const chunkEnd = starts[i] + chunks[i].length;
    if (chunkEnd <= start) {
      continue;
    }
    parts.push({
      chunk: i,
      start: Math.max(start, starts[i]) - starts[i],
      end: Math.min(end, chunkEnd) - starts[i],
    });
  }
  return parts;
}

/** Every occurrence of `query`, in reading order and never overlapping. */
export function findMatches(
  chunks: readonly string[],
  query: string,
  opts: FindOptions = {},
): FindMatch[] {
  if (query === "") {
    return [];
  }
  const joined = chunks.join("");
  const haystack = opts.caseSensitive ? joined : foldCase(joined);
  const needle = opts.caseSensitive ? query : foldCase(query);
  const starts = chunkStarts(chunks);
  const matches: FindMatch[] = [];
  // The chunk the previous match ended in: matches only move forward, so the
  // cut never has to start looking from the top of the page again.
  let chunk = 0;
  let at = 0;
  for (;;) {
    const start = haystack.indexOf(needle, at);
    if (start < 0) {
      break;
    }
    const end = start + needle.length;
    at = end;
    if (opts.wholeWord && (isWordChar(joined[start - 1]) || isWordChar(joined[end]))) {
      // A hit inside a longer word is not a match, but the text after it may
      // still hold one — “cat” in “concatenate cat”.
      at = start + 1;
      continue;
    }
    while (chunk + 1 < starts.length && starts[chunk + 1] <= start) {
      chunk++;
    }
    matches.push({ start, end, parts: partsOf(chunks, starts, start, end, chunk) });
  }
  return matches;
}

/**
 * The match to jump to when the search runs again from a known place: the first
 * one at or after `offset`, wrapping to the top when there is none. Returns -1
 * for an empty list.
 */
export function firstMatchFrom(matches: readonly FindMatch[], offset: number): number {
  if (matches.length === 0) {
    return -1;
  }
  const found = matches.findIndex((m) => m.start >= offset);
  return found === -1 ? 0 : found;
}

/** The next (or previous) match, wrapping around at both ends. */
export function stepMatch(current: number, total: number, dir: 1 | -1): number {
  if (total === 0) {
    return -1;
  }
  return (((current + dir) % total) + total) % total;
}
