// @vitest-environment happy-dom
/**
 * What the declaration is FOR, measured where the reader actually feels it: the
 * DOM.
 *
 * The suite beside this one pins object identity through the merge; this one pins
 * what a view built on that identity does. It is the downstream audit's §6 probe
 * reduced to a unit test — tag every element under the target before, count the
 * survivors after — over the one thing the audit could not fix from its own side:
 * a `<For>` (Solid's reference-keyed list) fed straight from a wire frame.
 *
 * Two facts, one per direction:
 *
 *   - a frame that REPEATS what the store holds must destroy nothing. Undeclared,
 *     every row's `<li>` is torn down and rebuilt on every such frame — a page
 *     redrawn per keystroke rebuilds its whole list per keystroke, which is the
 *     flicker the report opened with.
 *   - a REORDER must MOVE the elements it already has. That is the other half of
 *     what a key buys, and the half a positional merge cannot give: the row that
 *     was third is the same element now sitting first, with its DOM state (a focus,
 *     a scroll, an open editor) still on it.
 */

import { For } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { writeWrappedValue } from "./writeValue";

interface Row {
  key: string;
  node: { id: string; title: string };
}

const rowsOf = (keys: readonly string[]): { rows: Row[] } => ({
  rows: keys.map((k) => ({ key: k, node: { id: k, title: `title of ${k}` } })),
});

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** Render a reference-keyed `<For>` over a frame-backed store and hand back the
 *  handles the probe needs: a writer for the next frame, and a reader of the
 *  current `<li>` elements. */
function mount(first: { rows: Row[] }, arrayKey?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const [store, setStore] = createStore<{ v: { rows: Row[] } | undefined }>({
    v: undefined,
  });
  writeWrappedValue(setStore, first, arrayKey);
  cleanup = render(
    () => (
      <ul>
        <For each={store.v?.rows}>
          {(row) => <li data-key={row.key}>{row.node.title}</li>}
        </For>
      </ul>
    ),
    host,
  );
  const items = () => [...host.querySelectorAll("li")];
  return {
    items,
    push: (next: { rows: Row[] }) =>
      writeWrappedValue(setStore, next, arrayKey),
  };
}

/** The §6 probe, in one line: stamp a serial on every element, and afterwards count
 *  how many of those serials are still on screen. */
const tag = (els: readonly Element[]): void => {
  els.forEach((el, i) => {
    el.setAttribute("data-serial", String(i));
  });
};
const survivors = (els: readonly Element[]): string[] =>
  els.map((el) => el.getAttribute("data-serial") ?? "new");

describe("a declared array key, at the DOM", () => {
  const KEYS = ["a", "b", "c"];

  it("UNDECLARED: an identical frame destroys every row's element", () => {
    const view = mount(rowsOf(KEYS));
    tag(view.items());
    view.push(rowsOf(KEYS));
    // 3 of 3 gone. This is the measurement the report is about, not an analogy for
    // it: nothing about the list changed and the list was rebuilt anyway.
    expect(survivors(view.items())).toEqual(["new", "new", "new"]);
  });

  it("DECLARED: an identical frame destroys nothing", () => {
    const view = mount(rowsOf(KEYS), "key");
    tag(view.items());
    view.push(rowsOf(KEYS));
    expect(survivors(view.items())).toEqual(["0", "1", "2"]);
    expect(view.items().map((li) => li.getAttribute("data-key"))).toEqual(KEYS);
  });

  it("DECLARED: a reorder MOVES the elements instead of rebuilding them", () => {
    const view = mount(rowsOf(["a", "b", "c"]), "key");
    tag(view.items());
    view.push(rowsOf(["c", "a", "b"]));
    // The same three elements, in the frame's order — serial 2 (`c`) is now first.
    expect(survivors(view.items())).toEqual(["2", "0", "1"]);
    expect(view.items().map((li) => li.getAttribute("data-key"))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("DECLARED: a mid-insert keeps every row that was already there", () => {
    const view = mount(rowsOf(["a", "b", "c"]), "key");
    tag(view.items());
    view.push(rowsOf(["a", "mid", "b", "c"]));
    expect(survivors(view.items())).toEqual(["0", "new", "1", "2"]);
    expect(view.items().map((li) => li.textContent)).toEqual([
      "title of a",
      "title of mid",
      "title of b",
      "title of c",
    ]);
  });

  it("DECLARED: a row whose field changed updates in place, element intact", () => {
    const view = mount(rowsOf(["a", "b"]), "key");
    tag(view.items());
    const renamed = rowsOf(["a", "b"]);
    const second = renamed.rows[1];
    if (second === undefined) throw new Error("no second row");
    second.node.title = "renamed";
    view.push(renamed);
    expect(survivors(view.items())).toEqual(["0", "1"]);
    expect(view.items().map((li) => li.textContent)).toEqual([
      "title of a",
      "renamed",
    ]);
  });
});
