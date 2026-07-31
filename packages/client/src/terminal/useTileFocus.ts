/** Focus a terminal — the ONE writer of the per-host focus fact.
 *
 *  This is what is left of `useSubPanel` once the in-tile split retired. A
 *  tile used to be a parent PTY plus a hidden stack of panes, so "focus" had
 *  to answer *which pane* — hence the remembered-pane bookkeeping, the tab
 *  selection, and the panel chrome that all lived around this write. Now every
 *  terminal is its own tile, so focusing one is just: write the fact.
 *
 *  The write stays trapped behind this narrow module (rather than exposed on
 *  the broad terminal/view facades) for the same reason it always was: a
 *  focus write is an authority, and there should be exactly one place that
 *  holds it. A missing active scope is the expected host-removal race and
 *  follows the active-host facade convention — the departing owner's write is
 *  a no-op. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { activeScope } from "../hostScope/hostScopes";

/** Bumped when a focus write REPEATS the already-focused terminal. Selection
 *  may still need to restore DOM focus after a dock row or a close button took
 *  it, and an equal-id write correctly notifies nobody — so this edge-less
 *  impulse is the only way to ask the terminal to re-grab the keyboard. It is
 *  never a second focus authority; it carries no id. */
const [refocusNonce, bumpRefocus] = createSignal(0);

export function useTileFocus() {
  return {
    focusedTerminalId: (): TerminalId | null =>
      activeScope()?.view.focusedTerminalId() ?? null,
    refocusNonce,
    /** Focus a terminal. `tileHint` is the terminal itself now that every
     *  terminal is a tile — kept in the written fact because the view's focus
     *  shape still carries it. */
    focusTerminal: (id: TerminalId): void => {
      const view = activeScope()?.view;
      if (!view) return;
      const repeats = view.focusedTerminalId() === id;
      view.writeFocus({ id, tileHint: id });
      if (repeats) bumpRefocus((n) => n + 1);
    },
    /** Drop focus entirely (the last tile departed). */
    clearFocus: (): void => activeScope()?.view.writeFocus(null),
  } as const;
}
