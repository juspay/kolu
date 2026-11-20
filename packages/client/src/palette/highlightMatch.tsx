import { type Component, For } from "solid-js";
import { tokenize } from "../search";

type Segment = { text: string; hit: boolean };

export function highlightSegments(text: string, query: string): Segment[] {
  const tokens = tokenize(query);
  if (tokens.length === 0 || text.length === 0) {
    return [{ text, hit: false }];
  }

  const lower = text.toLowerCase();
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

const HighlightedText: Component<{ text: string; query: string }> = (props) => (
  <For each={highlightSegments(props.text, props.query)}>
    {(seg) => (seg.hit ? <b class="font-semibold">{seg.text}</b> : seg.text)}
  </For>
);

export default HighlightedText;
