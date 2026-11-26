// @vitest-environment happy-dom
/** A HIGHLIGHTED LABEL HOLDS ITS SEGMENT NODES while the palette republishes
 *  the row that carries it. `highlightSegments` mints fresh segment objects on
 *  every call, and the palette hands each row a NEW object on every refresh, so
 *  without an equality gate the `<For>` below would dispose and rebuild every
 *  segment node per tick — four such publishes are Solid's
 *  `UNSTABLE_MEMO_OUTPUT`, which `@kolu/solid-test-setup` fails a test on. */

import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";
import HighlightedText from "./highlightMatch";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

/** A palette row as the list publishes it: a fresh object, equal in content. */
const freshRow = (): { text: string; query: string } => ({
  text: "watch-edge",
  query: "edge",
});

it("keeps its segment nodes across four equal republishes of its row", () => {
  const [row, setRow] = createSignal(freshRow());
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <HighlightedText text={row().text} query={row().query} />,
    host,
  );
  flush();
  const bold = host.querySelector("b");
  expect(bold?.textContent).toBe("edge");

  for (let i = 0; i < 4; i++) {
    setRow(freshRow());
    flush();
  }

  // The same node, never rebuilt, still showing the same split.
  expect(host.querySelector("b")).toBe(bold);
  expect(host.textContent).toBe("watch-edge");
});
