/** Bold every AND-token hit inside a string. Tokens that don't appear are
 *  skipped; overlapping hits merge so the string never double-wraps.
 *
 *  The SPLIT is computed where the list is built — once per row, against one
 *  tokenization of the query — and handed to the row as data. The painted
 *  component takes segments, never a query: a list of rows must not put one
 *  subscriber per row on the query signal. */

import { type Component, createMemo, For } from "solid-js";
import { tokenize } from "../search";

export type Segment = { text: string; hit: boolean };

/** Split `text` into hit / non-hit segments for already-tokenized query terms.
 *  The per-row half of {@link highlightSegments}, so a list tokenizes once. */
export function segmentsForTokens(
  text: string,
  tokens: readonly string[],
): Segment[] {
  if (tokens.length === 0 || text.length === 0) {
    return [{ text, hit: false }];
  }

  const lower = text.toLowerCase();
  // Mark every character that participates in any token match.
  const hit = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(token, from);
      if (at < 0) break;
      for (let i = at; i < at + token.length; i++) hit[i] = true;
      from = at + token.length;
    }
  }

  const segs: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const flag = hit[i] ?? false;
    let j = i + 1;
    while (j < text.length && (hit[j] ?? false) === flag) j++;
    segs.push({ text: text.slice(i, j), hit: flag });
    i = j;
  }
  return segs;
}

/** Split `text` for a whole query. Pure so tests and single-string call sites
 *  can reuse it without tokenizing themselves. */
export function highlightSegments(text: string, query: string): Segment[] {
  return segmentsForTokens(text, tokenize(query));
}

/** Whether two segment lists are the same text split the same way. Every
 *  recompute mints fresh segment objects — a palette row republished with the
 *  same text and query produces an equal list — so without this the `<For>`
 *  below would dispose and rebuild every segment node per tick. */
export function sameSegments(
  a: readonly Segment[],
  b: readonly Segment[],
): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.text === b[i]?.text && s.hit === b[i]?.hit)
  );
}

const HighlightedText: Component<{ segments: readonly Segment[] }> = (
  props,
) => {
  const segments = createMemo(() => props.segments, { equals: sameSegments });
  return (
    <For each={segments()}>
      {(seg) => (seg.hit ? <b class="font-semibold">{seg.text}</b> : seg.text)}
    </For>
  );
};

export default HighlightedText;
