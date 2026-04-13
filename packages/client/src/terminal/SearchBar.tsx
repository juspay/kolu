/** Search bar overlay for find-in-terminal. Wraps @xterm/addon-search. */

import {
  type Component,
  type JSX,
  Show,
  createSignal,
  createEffect,
  on,
  onCleanup,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../ui/Icons";
import Tip from "../ui/Tip";
import type {
  SearchAddon,
  ISearchResultChangeEvent,
  ISearchOptions,
} from "@xterm/addon-search";

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

/** Small icon button used for prev/next/close actions. */
function IconButton(props: {
  onClick: () => void;
  label: string;
  children: JSX.Element;
}) {
  return (
    <Tip label={props.label}>
      <button
        class="p-1 text-fg-3 hover:text-fg rounded hover:bg-surface-2 transition-colors"
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </Tip>
  );
}

/** Find-in-terminal search bar — overlays the active terminal with incremental search, match navigation, and result count. */
const SearchBar: Component<{
  searchAddon: SearchAddon;
  open: boolean;
  onClose: () => void;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [resultIndex, setResultIndex] = createSignal(-1);
  const [resultCount, setResultCount] = createSignal(0);

  const disposable = props.searchAddon.onDidChangeResults(
    (e: ISearchResultChangeEvent) => {
      setResultIndex(e.resultIndex);
      setResultCount(e.resultCount);
    },
  );
  onCleanup(() => disposable.dispose());

  // Focus input when opened; clear decorations when closed
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          // rAF: input is inside <Show> and may not be in DOM yet when the effect runs
          requestAnimationFrame(() => {
            inputRef?.focus();
            inputRef?.select();
          });
        } else {
          props.searchAddon.clearDecorations();
          setResultIndex(-1);
          setResultCount(0);
        }
      },
    ),
  );

  function findNext() {
    const q = query();
    if (q) props.searchAddon.findNext(q, SEARCH_OPTIONS);
  }

  function findPrevious() {
    const q = query();
    if (q) props.searchAddon.findPrevious(q, SEARCH_OPTIONS);
  }

  function handleInput(value: string) {
    setQuery(value);
    if (value) {
      props.searchAddon.findNext(value, SEARCH_OPTIONS);
    } else {
      props.searchAddon.clearDecorations();
      setResultIndex(-1);
      setResultCount(0);
    }
  }

  function resultLabel(): string {
    if (!query()) return "";
    if (resultCount() === 0) return "No results";
    const idx = resultIndex() >= 0 ? resultIndex() + 1 : "?";
    return `${idx} / ${resultCount()}`;
  }

  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if (!props.open) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        return;
      }

      // Enter = next, Shift+Enter = previous
      if (e.key === "Enter" && document.activeElement === inputRef) {
        e.preventDefault();
        if (e.shiftKey) findPrevious();
        else findNext();
      }
    },
    { capture: true },
  );

  return (
    <Show when={props.open}>
      <div class="absolute top-1 right-3 z-10 flex items-center gap-1.5 bg-surface-1 border border-edge rounded-xl shadow-2xl shadow-black/40 px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          placeholder="Find…"
          class="bg-surface-2 text-fg text-sm rounded-lg px-2 py-1 w-48 outline-none border border-edge focus:border-accent"
          value={query()}
          onInput={(e) => handleInput(e.currentTarget.value)}
        />
        <span class="text-xs text-fg-3 min-w-[3.5rem] text-center tabular-nums">
          {resultLabel()}
        </span>
        <IconButton onClick={findPrevious} label="Previous match (Shift+Enter)">
          <ChevronUpIcon />
        </IconButton>
        <IconButton onClick={findNext} label="Next match (Enter)">
          <ChevronDownIcon />
        </IconButton>
        <IconButton onClick={() => props.onClose()} label="Close (Escape)">
          <CloseIcon />
        </IconButton>
      </div>
    </Show>
  );
};

export default SearchBar;
