import { type Component, Show } from "solid-js";
import { CloseIcon, SearchIcon } from "../ui/Icons";

const FileSearchInput: Component<{
  value: string;
  onChange: (q: string) => void;
  touch?: boolean;
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
        data-touch={props.touch || undefined}
        onClick={() => props.onChange("")}
        title="Clear filter"
        class="grid place-items-center shrink-0 text-fg-3 hover:text-fg cursor-pointer p-0.5 -mr-0.5 data-[touch=true]:p-0 data-[touch=true]:h-6 data-[touch=true]:w-6"
        data-testid="diff-filter-clear"
      >
        <CloseIcon class="w-3 h-3" />
      </button>
    </Show>
  </label>
);

export default FileSearchInput;
