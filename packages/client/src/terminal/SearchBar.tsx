/** Search bar overlay for find-in-terminal — Kolu UI chrome around the
 *  `createTerminalSearch` controller from `@kolu/solid-xterm`. All xterm
 *  mechanics (the addon calls, result subscription, decoration styling) live
 *  in the controller; this component owns only the input box, buttons, focus,
 *  and keyboard handling. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { createTerminalSearch, type SearchAddon } from "@kolu/solid-xterm";
import { type Component, createEffect, type JSX, on, Show } from "solid-js";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../ui/Icons";
import { surface } from "../ui/Surface";
import Tip from "../ui/Tip";

/** Small icon button used for prev/next/close actions. */
function IconButton(props: {
  onClick: () => void;
  label: string;
  children: JSX.Element;
}) {
  return (
    <Tip label={props.label}>
      <button
        type="button"
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
  const search = createTerminalSearch(props.searchAddon);

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
          search.clear();
        }
      },
    ),
  );

  function resultLabel(): string {
    if (!search.query()) return "";
    if (search.resultCount() === 0) return "No results";
    const idx = search.resultIndex() >= 0 ? search.resultIndex() + 1 : "?";
    return `${idx} / ${search.resultCount()}`;
  }

  const chrome = surface({ radius: "xl", shadow: "soft" });

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
        if (e.shiftKey) search.findPrevious();
        else search.findNext();
      }
    },
    { capture: true },
  );

  return (
    <Show when={props.open}>
      <div
        class={`absolute top-1 right-3 z-10 flex items-center gap-1.5 ${chrome.class} px-2 py-1.5`}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Find…"
          class="bg-surface-2 text-fg text-sm rounded-lg px-2 py-1 w-48 outline-none border border-edge focus:border-accent"
          value={search.query()}
          onInput={(e) => search.search(e.currentTarget.value)}
        />
        <span class="text-xs text-fg-3 min-w-[3.5rem] text-center tabular-nums">
          {resultLabel()}
        </span>
        <IconButton
          onClick={() => search.findPrevious()}
          label="Previous match (Shift+Enter)"
        >
          <ChevronUpIcon />
        </IconButton>
        <IconButton
          onClick={() => search.findNext()}
          label="Next match (Enter)"
        >
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
