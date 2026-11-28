// @vitest-environment happy-dom
/**
 * The search bar's result subscription belongs to the addon it is SHOWING.
 * xterm is rebuilt under a mounted tile (a renderer swap, a font reload), and
 * the `<Show>` that hands the bar its addon is not keyed, so the same bar
 * instance is handed a new addon. A subscription taken once at mount would go
 * on reporting the dead addon's counts — and never hear the live one's.
 */

import { render } from "@solidjs/web";
import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import SearchBar from "./SearchBar";

type FakeAddon = {
  /** What `<SearchBar searchAddon=…>` is handed. */
  addon: SearchAddon;
  /** Fires the addon's result event at whoever is listening right now. */
  emit: (event: ISearchResultChangeEvent) => void;
  /** Listeners that have not been disposed. */
  live: () => number;
  disposed: () => number;
  terms: string[];
};

function fakeAddon(): FakeAddon {
  const listeners = new Set<(event: ISearchResultChangeEvent) => unknown>();
  let disposed = 0;
  const terms: string[] = [];
  const addon: SearchAddon = {
    activate: (_terminal: Terminal) => {},
    dispose: () => {},
    findNext: (term: string, _options?: ISearchOptions) => {
      terms.push(term);
      return true;
    },
    findPrevious: (_term: string, _options?: ISearchOptions) => true,
    clearDecorations: () => {},
    clearActiveDecoration: () => {},
    onDidChangeResults: (
      listener: (event: ISearchResultChangeEvent) => unknown,
    ) => {
      listeners.add(listener);
      return {
        dispose: () => {
          if (listeners.delete(listener)) disposed += 1;
        },
      };
    },
  };
  return {
    addon,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    live: () => listeners.size,
    disposed: () => disposed,
    terms,
  };
}

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function resultLabel(root: HTMLElement): string {
  const span = root.querySelector("[class*='tabular-nums']");
  if (!span) throw new Error("search bar has no result label");
  return span.textContent ?? "";
}

function type(root: HTMLElement, text: string): void {
  const input = root.querySelector("input");
  if (!input) throw new Error("search bar has no input");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

it("reports the counts of the addon it is showing, across an addon swap", () => {
  const first = fakeAddon();
  const second = fakeAddon();
  const [addon, setAddon] = createSignal<SearchAddon>(first.addon);
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <SearchBar searchAddon={addon()} open={true} onClose={() => {}} />,
    host,
  );
  flush();

  type(host, "needle");
  expect(first.terms).toEqual(["needle"]);
  expect(first.live()).toBe(1);

  first.emit({ resultIndex: 0, resultCount: 2 });
  flush();
  expect(resultLabel(host)).toBe("1 / 2");

  // xterm rebuilt: the same bar, a new addon.
  setAddon(() => second.addon);
  flush();
  expect(first.live()).toBe(0);
  expect(first.disposed()).toBe(1);
  expect(second.live()).toBe(1);

  second.emit({ resultIndex: 1, resultCount: 5 });
  flush();
  expect(resultLabel(host)).toBe("2 / 5");

  // The addon that is gone can no longer speak for the bar.
  first.emit({ resultIndex: 7, resultCount: 9 });
  flush();
  expect(resultLabel(host)).toBe("2 / 5");

  // A find goes to the live addon too.
  type(host, "other");
  expect(second.terms).toEqual(["other"]);
  expect(first.terms).toEqual(["needle"]);
});

it("drops the subscription when the bar unmounts", () => {
  const only = fakeAddon();
  host = document.createElement("div");
  document.body.append(host);
  const stop = render(
    () => <SearchBar searchAddon={only.addon} open={true} onClose={() => {}} />,
    host,
  );
  flush();
  expect(only.live()).toBe(1);
  stop();
  expect(only.live()).toBe(0);
  expect(only.disposed()).toBe(1);
  host.remove();
  host = undefined;
});

it("clears the count when the addon changes", () => {
  const first = fakeAddon();
  const second = fakeAddon();
  const [addon, setAddon] = createSignal<SearchAddon>(first.addon);
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <SearchBar searchAddon={addon()} open={true} onClose={() => {}} />,
    host,
  );
  flush();

  type(host, "needle");
  first.emit({ resultIndex: 0, resultCount: 2 });
  flush();
  expect(resultLabel(host)).toBe("1 / 2");

  // The rebuilt xterm's addon has found nothing yet: the dead addon's numbers
  // must not stand in for it.
  setAddon(() => second.addon);
  flush();
  expect(resultLabel(host)).toBe("No results");
});

/** Two frames: the focus effect's `select()` runs in a rAF, so a frame has to
 *  pass before "it focused" or "it never did" is a fact. */
async function frames(): Promise<void> {
  const passed = Promise.withResolvers<void>();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => passed.resolve(undefined)),
  );
  await passed.promise;
}

it("leaves the input's selection alone when the addon changes", async () => {
  const first = fakeAddon();
  const second = fakeAddon();
  const [addon, setAddon] = createSignal<SearchAddon>(first.addon);
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <SearchBar searchAddon={addon()} open={true} onClose={() => {}} />,
    host,
  );
  flush();
  // The opening's own focus has had its frame: what happens next is the
  // addon's doing, not the opening's.
  await frames();

  type(host, "needle");
  const input = host.querySelector("input");
  if (!input) throw new Error("search bar has no input");
  input.setSelectionRange(2, 4);

  // xterm rebuilt under the open bar: the person's caret is theirs.
  setAddon(() => second.addon);
  flush();
  await frames();

  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
});
