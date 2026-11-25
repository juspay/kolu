/** Explicit state machine for ONE comment-capturing view's composer. A view
 *  (the Code view, the work reader) holds one through `createCommentView`,
 *  and every surface inside it (text browse, branch diff, HTML iframe) shares
 *  that one composer — exactly one selection per view can be turned into a
 *  comment at a time. Two views mounted at once each have their own: a draft
 *  is drawn and saved by the view it was opened in, and closed only by that
 *  view's own navigation.
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
import { type Accessor, createSignal } from "solid-js";

export type ComposerTarget = {
  /** Repo-relative path the new comment will be anchored to. */
  path: string;
  locator: Locator;
  /** Optional line range captured at selection time — passed through
   *  to `Comment.lineRange` on save so the tray-click jump can use the
   *  view's open door to land Pierre's line-selection highlight on
   *  the right row. */
  lineRange?: { start: number; end: number };
  /** Which browse surface the selection was made on, when the file offers
   *  more than one (Markdown's Source ⇄ Rendered). Passed through to
   *  `Comment.surface` so the tray jump can flip the toggle back to it.
   *  Absent for single-surface captures (plain source, diff, HTML iframe). */
  surface?: "source" | "prose";
  /** Viewport rect (parent-local coordinates) of the selection — the
   *  composer is positioned next to it. */
  rect: SelectionRect;
};

/** One view's composer. */
export interface Composer {
  /** When non-null, the composer popover should render at the rect. */
  readonly target: Accessor<ComposerTarget | null>;
  /** Called by every capture surface (pill click, iframe bridge). A
   *  no-op when a draft is already open — drafts win. */
  readonly open: (t: ComposerTarget) => void;
  readonly close: () => void;
  /** True when a draft is open. Capture surfaces use this to suppress
   *  their own pill rendering during a draft. */
  readonly isComposing: Accessor<boolean>;
}

/** A fresh composer for one view. The view's close-on-navigate effect drops
 *  its draft when what it shows changes, so a draft never floats over
 *  content it was not made on. */
export function createComposer(): Composer {
  const [target, setTarget] = createSignal<ComposerTarget | null>(null);
  return {
    target,
    open: (t) => {
      if (target() !== null) return;
      setTarget(t);
    },
    // BRACES, NOT A CONCISE BODY: `close` is called from a view's
    // close-on-navigate EFFECT (`code-view/CodeTab.tsx`), and what an effect
    // callback returns is its CLEANUP — Solid 2 refuses anything that is not a
    // function or `undefined`. A Solid 2 setter answers with the value it set,
    // so `() => setTarget(null)` hands the effect a `null`. DEV THROWS on it
    // ("callback returned an invalid cleanup value") at the end of that run, so
    // the view's reactivity halts there; PROD stores the value and calls it as
    // `f?.()` on the next run, which drops a `null` silently. The bug is a
    // dev-only halt here — and the shape is one a setter that answered `false`
    // would halt prod with too.
    close: () => {
      setTarget(null);
    },
    isComposing: () => target() !== null,
  };
}
