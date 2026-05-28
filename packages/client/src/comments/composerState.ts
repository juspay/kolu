/** Explicit state machine for the comment composer UI. The states are
 *  module-level so every surface (text browse, branch diff, HTML iframe)
 *  shares one composer — exactly one selection can be turned into a
 *  comment at a time.
 *
 *  RULE: `selectionchange` events while in `"composing"` are IGNORED.
 *  An in-flight draft wins over new selections — the user must Cancel
 *  or Save before a new anchor can be captured. This makes the
 *  "I started typing and a stray click wiped my anchor" failure mode
 *  impossible by construction.
 *
 *  RULE: clearing the selection while in `"pill"` returns to `"idle"`
 *  and dismisses the pill — click-away never leaves a stale pill behind. */

import type { Locator, SelectionRect } from "@kolu/artifact-sdk/client";
import { createSignal } from "solid-js";

export type ComposerTarget = {
  /** Repo-relative path the new comment will be anchored to. */
  path: string;
  locator: Locator;
  /** Optional line range captured at selection time — passed through
   *  to `Comment.lineRange` on save so the tray-click jump can use
   *  `openInCodeTab` to land Pierre's line-selection highlight on
   *  the right row. */
  lineRange?: { start: number; end: number };
  /** Viewport rect (parent-local coordinates) of the selection — the
   *  composer is positioned next to it. */
  rect: SelectionRect;
};

const [target, setTarget] = createSignal<ComposerTarget | null>(null);

export function useComposer() {
  return {
    /** When non-null, the composer popover should render at the rect. */
    target,
    /** Called by every capture surface (pill click, iframe bridge). A
     *  no-op when a draft is already open — drafts win. */
    open: (t: ComposerTarget): void => {
      if (target() !== null) return;
      setTarget(t);
    },
    close: (): void => {
      setTarget(null);
    },
    /** True when a draft is open. Capture surfaces use this to suppress
     *  their own pill rendering during a draft. */
    isComposing: () => target() !== null,
  };
}
