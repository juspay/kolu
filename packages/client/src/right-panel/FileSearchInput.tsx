/** Free-text search input that filters the file tree by path. Hosts
 *  read the value back through `onChange` and forward it into the tree
 *  (e.g. via `PierreFileTree`'s `searchQuery` prop). The input is
 *  controlled so callers can clear or programmatically reset it
 *  (e.g. on view change). */

import { type Component, Show } from "solid-js";
import { CloseIcon, SearchIcon } from "@kolu/solid-icons";

const FileSearchInput: Component<{
  value: string;
  onChange: (q: string) => void;
}> = (props) => (
  <label class="flex items-center gap-1.5 flex-1 min-w-0 text-[10px] font-mono text-fg-3 focus-within:text-fg-2">
    <SearchIcon class="w-3 h-3 opacity-50 shrink-0" />
    <input
      type="text"
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
      placeholder="filter files…"
      class="flex-1 min-w-0 bg-transparent outline-none border-0 placeholder:text-fg-3/40 text-fg"
      data-testid="diff-filter-search"
      spellcheck={false}
      autocomplete="off"
    />
    <Show when={props.value.length > 0}>
      <button
        type="button"
        onClick={() => props.onChange("")}
        title="Clear filter"
        class="shrink-0 text-fg-3 hover:text-fg cursor-pointer p-0.5 -mr-0.5"
        data-testid="diff-filter-clear"
      >
        <CloseIcon class="w-3 h-3" />
      </button>
    </Show>
  </label>
);

export default FileSearchInput;
