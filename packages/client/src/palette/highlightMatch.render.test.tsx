// @vitest-environment happy-dom
/** A HIGHLIGHTED LABEL HOLDS ITS SEGMENT NODES while the palette republishes
 *  the row that carries it. `highlightSegments` mints fresh segment objects on
 *  every call, and the list hands each row a NEW split on every refresh, so
 *  without an equality gate the `<For>` below would dispose and rebuild every
 *  segment node per tick — four such publishes are Solid's
 *  `UNSTABLE_MEMO_OUTPUT`, which `@kolu/solid-test-setup` fails a test on. */

import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";
import HighlightedText, {
  highlightSegments,
  type Segment,
} from "./highlightMatch";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

/** A palette row's split as the list publishes it: a fresh list, equal in
 *  content. */
const freshSegments = (): Segment[] => highlightSegments("watch-edge", "edge");

it("keeps its segment nodes across four equal republishes of its row", () => {
  const [segments, setSegments] = createSignal(freshSegments());
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <HighlightedText segments={segments()} />, host);
  flush();
  const bold = host.querySelector("b");
  expect(bold?.textContent).toBe("edge");

  for (let i = 0; i < 4; i++) {
    setSegments(freshSegments());
    flush();
  }

  // The same node, never rebuilt, still showing the same split.
  expect(host.querySelector("b")).toBe(bold);
  expect(host.textContent).toBe("watch-edge");
});
