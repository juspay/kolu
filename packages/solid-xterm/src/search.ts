/** Reactive search controller over `@xterm/addon-search`.
 *
 *  Separates terminal-search *mechanics* (the addon calls, the result-change
 *  subscription, the decoration styling) from search *chrome* (the input box,
 *  buttons, focus handling — Kolu UI). A consumer renders whatever UI it likes
 *  and drives it through this controller's accessors and methods, never
 *  touching the addon directly. */

import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import { type Accessor, createSignal, onCleanup } from "solid-js";

/** Re-exported so consumers can type the addon handle they pass to
 *  `createTerminalSearch` without importing `@xterm/*` themselves. */
export type { SearchAddon } from "@xterm/addon-search";

const SEARCH_OPTIONS: ISearchOptions = {
  incremental: true,
  decorations: {
    matchBackground: "#FFD33D44",
    matchBorder: "#FFD33D88",
    matchOverviewRuler: "#FFD33D",
    activeMatchBackground: "#FFD33DAA",
    activeMatchBorder: "#FFD33D",
    activeMatchColorOverviewRuler: "#FFD33DFF",
  },
};

/** Reactive find-in-terminal controller. Self-registers cleanup for its
 *  result-change subscription, so create it inside a reactive owner (e.g. a
 *  component body). */
export interface TerminalSearch {
  query: Accessor<string>;
  /** 0-based index of the active match, or -1 when there is none. */
  resultIndex: Accessor<number>;
  resultCount: Accessor<number>;
  /** Set the query and run an incremental find; clears when empty. */
  search: (value: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  /** Clear match decorations and reset the result counters. */
  clear: () => void;
}

export function createTerminalSearch(addon: SearchAddon): TerminalSearch {
  const [query, setQuery] = createSignal("");
  const [resultIndex, setResultIndex] = createSignal(-1);
  const [resultCount, setResultCount] = createSignal(0);

  const disposable = addon.onDidChangeResults((e: ISearchResultChangeEvent) => {
    setResultIndex(e.resultIndex);
    setResultCount(e.resultCount);
  });
  onCleanup(() => disposable.dispose());

  function clear(): void {
    addon.clearDecorations();
    setResultIndex(-1);
    setResultCount(0);
  }

  function search(value: string): void {
    setQuery(value);
    if (value) addon.findNext(value, SEARCH_OPTIONS);
    else clear();
  }

  function findNext(): void {
    const q = query();
    if (q) addon.findNext(q, SEARCH_OPTIONS);
  }

  function findPrevious(): void {
    const q = query();
    if (q) addon.findPrevious(q, SEARCH_OPTIONS);
  }

  return {
    query,
    resultIndex,
    resultCount,
    search,
    findNext,
    findPrevious,
    clear,
  };
}
