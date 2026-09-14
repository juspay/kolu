/**
 * The pane's answer to "someone else is holding this terminal at their size".
 *
 * Attaching is a WRITE on a shared pty and the policy is last-attach-wins, so a
 * second viewer attaching at its own size reflows this pane underneath it. The
 * byte stream cannot say so: a snapshot rides the initial attach and an overflow
 * re-attach and nothing else, so the losing pane goes on painting deltas laid
 * out for a grid no frame ever named — N columns of content inside its own 2N
 * column box, indefinitely, with no error and nothing to time out.
 *
 * What makes it observable is the terminal RECORD, which carries the pty's
 * current grid (`TerminalSnapshot.grid`, padi contract 5.5). This module owns
 * what to DO with that fact, lifted out of `Terminal.tsx` for the same reason
 * `publishGrid.ts` was: the policy is a judgment about timing, the pane supplies
 * three live facts, and the judgment deserves a single owner a unit test can
 * drive without an xterm or a socket.
 *
 * The judgment is the SETTLE WINDOW. A record grid that differs from the pane's
 * is ALSO the ordinary transient shape of the pane's OWN resize — the pane
 * measures first and the record catches up a round-trip later, so a drag on a
 * split divider walks the record through every intermediate grid while the pane
 * already sits at its last one. Acting on the first mismatch would reset the
 * screen mid-drag. Waiting and re-reading tells the two apart with no extra
 * fact: our own resize CONVERGES (the record arrives at the grid we measured), a
 * foreign one does not.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";

export interface ForeignGridDeps {
  /** The pty's grid as the RECORD states it — absent from a padi that predates
   *  the field, and from a terminal nothing has resized yet. */
  readonly served: () => TerminalGrid | null | undefined;
  /** This pane's own measured grid — absent until it has measured, and again
   *  once it is disposed. `null` because that is the kit's spelling of "not
   *  measured"; both absences answer the same, so both are accepted rather than
   *  normalised at the call site. */
  readonly mine: () => TerminalGrid | null | undefined;
  /** The host entry's state KIND, the same fact `publishGrid` gates on. */
  readonly hostState: () => string;
  /** Re-attach at the pane's current grid, which re-asserts it on the pty. */
  readonly reopen: () => void;
  /** How long a mismatch must persist before it counts as foreign. */
  readonly settleMs: number;
}

export interface ForeignGridWatcher {
  /** Call on every change to the served grid. */
  observe(): void;
  /** Cancel a pending settle — the pane's teardown. */
  dispose(): void;
}

/** Is the pty at a size this pane did not ask for?
 *
 *  Absence on EITHER side answers "no evidence", exactly as the snapshot
 *  predicates in `@kolu/padi-client/attach` read it: an older padi states no
 *  grid, and an unmeasured or disposed pane has none to compare. Acting on
 *  ignorance would spin the re-attach loop against a pane with nothing to ask
 *  for — the same failure mode `snapshotAnswersGrid`'s absence rule exists to
 *  avoid. */
function heldByAnother(deps: ForeignGridDeps): boolean {
  const served = deps.served();
  const mine = deps.mine();
  if (!served || !mine) return false;
  return served.cols !== mine.cols || served.rows !== mine.rows;
}

export function createForeignGridWatcher(
  deps: ForeignGridDeps,
): ForeignGridWatcher {
  let settle: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
  };
  return {
    observe() {
      // Re-armed by each new record grid, so a drag costs ONE pending verdict
      // rather than one per frame — and a mismatch that resolved on its own (our
      // own resize landing, the common case) drops the pending one rather than
      // letting it fire against facts that have since agreed.
      cancel();
      if (!heldByAnother(deps)) return;
      settle = setTimeout(() => {
        settle = null;
        // Both facts re-read LIVE — that is the point of having waited.
        if (!heldByAnother(deps)) return;
        // A disconnected host is the one persistent mismatch to sit out: this
        // pane's own publishes are SUPPRESSED while its host is down
        // (`publishGrid`'s H1), so the record legitimately holds a grid we never
        // got to restate, and re-attaching would churn against a host that
        // cannot answer. The publisher's K4 latch restates on the flip back, and
        // the record moving is what re-arms this watcher.
        if (deps.hostState() !== "connected") return;
        deps.reopen();
      }, deps.settleMs);
    },
    dispose: cancel,
  };
}
