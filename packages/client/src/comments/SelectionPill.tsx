import type { SelectionRect } from "@kolu/artifact-sdk/client";
import { type Component, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { PlusIcon } from "../ui/Icons";

export type SelectionPillProps = {
  rect: SelectionRect;
  /** Set when no comment can be taken on this selection: the pill shows
   *  this reason and is not clickable. */
  unavailable?: string;
  onActivate: () => void;
};

export const SelectionPill: Component<SelectionPillProps> = (props) => {
  const position = () => ({
    position: "fixed" as const,
    top: `${props.rect.y + props.rect.height + 4}px`,
    left: `${props.rect.x + props.rect.width + 4}px`,
  });
  return (
    <Portal>
      <Show
        when={props.unavailable === undefined}
        fallback={
          <div
            data-testid="kolu-comment-pill-unavailable"
            role="note"
            style={position()}
            class="z-50 rounded-full bg-surface-2 text-fg-2 text-[11px] px-2.5 py-1 shadow-lg select-none font-sans"
          >
            {props.unavailable}
          </div>
        }
      >
        <button
          type="button"
          data-testid="kolu-comment-pill"
          aria-label="Add comment on selected text"
          // mousedown beats click: by the time `click` fires the browser
          // has collapsed the selection (focus moves to the button), so
          // we can't read `window.getSelection()` reliably from a click
          // handler. Suppress default to keep selection alive — the
          // caller's onActivate captures `lastSelectionRange` from the
          // adapter's debounced cache rather than from getSelection.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onActivate();
          }}
          style={position()}
          class="z-50 flex items-center gap-1.5 rounded-full bg-accent text-surface-0 text-[11px] px-2.5 py-1 shadow-lg cursor-pointer select-none font-sans hover:opacity-90"
        >
          <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface-0/20 text-surface-0 leading-none">
            <PlusIcon class="w-2.5 h-2.5" />
          </span>
          Comment
        </button>
      </Show>
    </Portal>
  );
};

export default SelectionPill;
