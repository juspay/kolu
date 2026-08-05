/**
 * The ONE publisher of a pane's measured grid → the PTY, as a testable action.
 *
 * Lifted out of `Terminal.tsx` so the publish POLICY has a single owner a unit
 * test can drive: `Terminal.tsx` supplies the three real facts (the terminal's
 * host connection, the tile's own PTY liveness, the resize RPC) and this module
 * owns what to do with them.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";

/** The three live facts the publish policy reads, injected so the policy is
 *  drivable without an xterm, a socket, or a host map. */
export interface PublishGridDeps {
  /** For the toast id + the log line — a pane is identified by its terminal. */
  readonly terminalId: string;
  /** The host entry's state KIND as the client's own host map paints it right
   *  now — `padiMap.entry(host).state().kind`, the same fact that colours the
   *  host pip. The word, not a boolean, so the suppression log can say WHICH
   *  non-connected state it saw (`warming` after a wake reads very differently
   *  from `failed`), which is the whole forensic value of the quiet line. */
  readonly hostState: () => string;
  /** Does this tile's PTY still exist locally (the metadata arm)? */
  readonly ptyLive: () => boolean;
  /** Publish the grid — the `lifecycle.resize` call, as an Effect. */
  readonly resize: (grid: TerminalGrid) => Effect.Effect<unknown, unknown>;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resize the server-side PTY so node-pty matches the xterm grid.
 *
 *  **Suppressed while the pane's host is not connected (kolu#2101 H1).** In the
 *  seconds between a laptop waking and a remote host reconverging, every pane on
 *  that host re-measures and republishes. The relay's answer is the correct,
 *  typed refusal — `reServeSurface: procedure "lifecycle.resize" invoked with no
 *  live upstream link` — but it is deliberately UNTAGGED (a re-served
 *  procedure's error schema is the AGENT's, so the refusal has no channel to
 *  travel on) and so crosses as a DEFECT: it skips the `Effect.catch` below
 *  entirely and lands at `runAction`'s edge as `publish terminal grid failed
 *  unexpectedly: …`. Three panes, three red toasts, for an expected transient.
 *
 *  The gate is on the client's OWN fact, never on the refusal's prose. Matching
 *  the message would couple this pane to another package's wording AND would
 *  silence the same refusal from a host the client believes is UP — which is a
 *  real fault and must stay loud (test (b)).
 *
 *  **Why SUPPRESS rather than defer, and why that converges.** Every
 *  (re-)attach RESTATES the grid: `Terminal.tsx`'s `streamFn` thunk re-reads
 *  `h.grid()` into the attach's own `resizeTo` on each open, and the
 *  post-convergence re-attach is exactly such an open. So a publish dropped here
 *  is republished by the re-attach that follows reconvergence — a stale grid
 *  cannot stick, and there is no queue to drain, no timer to arm, and nothing
 *  unbounded added. A DEFERRED publish would instead replay a grid measured
 *  before the wake against a PTY the re-attach has already sized correctly. */
export function publishGridAction(
  size: TerminalGrid,
  deps: PublishGridDeps,
): UiAction<void> {
  const { cols, rows } = size;
  return Effect.suspend(() => {
    // Read at RUN time, not at construction: the action is described in a
    // `createEffect` body and the host's state is a live signal.
    const host = deps.hostState();
    if (host !== "connected") {
      console.info(
        `terminal ${deps.terminalId}: host entry is "${host}", not connected — suppressing the ${cols}×${rows} grid publish (the post-convergence re-attach restates it)`,
      );
      return Effect.void;
    }
    return deps.resize(size).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          // The call is ACKNOWLEDGED through padi to kaval — padi awaits kaval's
          // reply rather than logging server-side and resolving — so a FAILURE
          // here means the grid claim did not land: the PTY kept its old size while
          // this pane renders against the new one. That is a wrong-grid screen with
          // no other symptom, so it must not collapse to a no-op
          // (`.agency/code-police.md` → caught-error-must-not-collapse-to-empty).
          // A PTY that has ALREADY EXITED is not that case: kaval reports `ok: false`
          // and padi returns quietly by design, so nothing reaches here — and the
          // tile tears down via terminalExit anyway. The extra guard below covers the
          // same race one hop earlier (the arm is already gone locally). One STABLE
          // toast id keeps a flurry of failed resizes to a single message.
          if (!deps.ptyLive()) return;
          toast.error(`Terminal resize to ${cols}×${rows} failed: ${errMsg(err)}`, {
            id: `terminal-resize-failed-${deps.terminalId}`,
          });
        }),
      ),
      Effect.asVoid,
    );
  });
}
