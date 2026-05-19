/** Floating "+ Comment" pill anchored to a viewport rect. Rendered via
 *  SolidJS Portal so the pill sits above scrollers, panels, and the
 *  Pierre file viewer regardless of where the host is mounted.
 *
 *  Host-agnostic — text browse and branch diff both render this same
 *  component when their `useTextSelection` adapter surfaces a non-empty
 *  selection. (The iframe SDK uses its own vanilla-DOM equivalent
 *  inside the opaque-origin iframe; see
 *  `packages/artifact-sdk/src/iframe/index.ts`.) */

import type { SelectionRect } from "@kolu/artifact-sdk/client";
import { Portal } from "solid-js/web";
import type { Component } from "solid-js";
import { PlusIcon } from "../ui/Icons";

export type SelectionPillProps = {
  rect: SelectionRect;
  onActivate: () => void;
};

export const SelectionPill: Component<SelectionPillProps> = (props) => {
  // 4px below and to the right of the selection's end. Position fixed —
  // doesn't move with page scroll, but the pill is dismissed and
  // re-rendered on every selectionchange anyway, so scroll re-anchors it.
  return (
    <Portal>
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
        style={{
          position: "fixed",
          top: `${props.rect.y + props.rect.height + 4}px`,
          left: `${props.rect.x + props.rect.width + 4}px`,
        }}
        class="z-50 flex items-center gap-1.5 rounded-full bg-accent text-surface-0 text-[11px] px-2.5 py-1 shadow-lg cursor-pointer select-none font-sans hover:opacity-90"
      >
        <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface-0/20 text-surface-0 leading-none">
          <PlusIcon class="w-2.5 h-2.5" />
        </span>
        Comment
      </button>
    </Portal>
  );
};

export default SelectionPill;
