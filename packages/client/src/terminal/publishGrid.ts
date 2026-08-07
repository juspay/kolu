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
 *  **Why SUPPRESS rather than defer, and why that needs a latch (kolu#2101
 *  K4).** The original argument was that every (re-)attach RESTATES the grid —
 *  `Terminal.tsx`'s `streamFn` thunk re-reads `h.grid()` into the attach's own
 *  `resizeTo` on each open, and the post-convergence re-attach is exactly such
 *  an open. True, but only when a re-attach HAPPENS. The grid effect fires once
 *  per grid CHANGE, nothing re-observes the host returning to `connected`, and
 *  an attach that produces no frame, no failure and no end across the outage
 *  window never re-opens at all. Then the drop is permanent: the pane renders
 *  132×43 over a PTY that stayed 80×24, with no symptom but wrong output and no
 *  cure but another manual resize. So the suppressed grid is LATCHED and
 *  restated once on the flip back to `connected` — see
 *  {@link createGridPublisher}. Still not a deferred publish: the latch holds
 *  the LAST measurement and is superseded by any publish that goes through
 *  normally, so it can never replay a grid the pane has already moved past. */
export function publishGridAction(
  size: TerminalGrid,
  deps: PublishGridDeps,
  /** Told when the publish is dropped, so the caller can latch it. */
  onSuppressed?: (size: TerminalGrid) => void,
): UiAction<void> {
  const { cols, rows } = size;
  return Effect.suspend(() => {
    // Read at RUN time, not at construction: the action is described in a
    // `createEffect` body and the host's state is a live signal.
    const host = deps.hostState();
    if (host !== "connected") {
      console.info(
        `terminal ${deps.terminalId}: host entry is "${host}", not connected — suppressing the ${cols}×${rows} grid publish (restated on the flip back to connected)`,
      );
      onSuppressed?.(size);
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
          toast.error(
            `Terminal resize to ${cols}×${rows} failed: ${errMsg(err)}`,
            {
              id: `terminal-resize-failed-${deps.terminalId}`,
            },
          );
        }),
      ),
      Effect.asVoid,
    );
  });
}

/** One pane's grid publisher — {@link publishGridAction} plus the LATCH that
 *  makes its suppression converge (kolu#2101 K4).
 *
 *  A factory rather than a module-level map because the latch's lifetime is the
 *  tile's: `Terminal.tsx` builds one inside `onReady`, so it is collected with
 *  the pane and two tiles cannot share a latch by accident.
 *
 *  **What the latch holds, and why it cannot go stale.** Exactly one grid: the
 *  LAST measurement a not-connected window dropped. Every later measurement
 *  overwrites it (an outage that spans three re-fits must restate the pane's
 *  final size, never replay the first two onto a shared PTY), and any publish
 *  that goes through normally CLEARS it (the pane's size is on the wire, so
 *  there is nothing left owed). It is therefore never a queue and never a
 *  deferred write of an old fact — it is one bit of "this pane still owes the
 *  PTY its size", carrying the answer.
 *
 *  **Idempotent by the latch, not by the caller.** {@link republishSuppressed}
 *  is written to be run on every tick of the host-state signal: with nothing
 *  owed it is `Effect.void`, and a successful restatement clears the latch, so
 *  the second and third call after a flip cost nothing. The caller does not have
 *  to detect an EDGE, which is the part that would otherwise be easy to get
 *  wrong (a tile that mounts while the host is already connected has no edge to
 *  observe). */
export interface GridPublisher {
  /** Publish a measured grid — or latch it, if the host is not connected. */
  publish: (size: TerminalGrid) => UiAction<void>;
  /** Restate the latched grid, if any. Safe to run on every host-state tick. */
  republishSuppressed: () => UiAction<void>;
}

export function createGridPublisher(deps: PublishGridDeps): GridPublisher {
  /** The last grid a not-connected window dropped, still owed to the PTY. */
  let owed: TerminalGrid | null = null;

  const publish = (size: TerminalGrid): UiAction<void> =>
    Effect.suspend(() => {
      // This measurement supersedes whatever was owed — either it lands, and
      // nothing is owed, or it is suppressed and the callback below re-latches
      // it. Clearing FIRST is what keeps the latch one grid rather than a queue.
      owed = null;
      return publishGridAction(size, deps, (dropped) => {
        owed = dropped;
      });
    });

  const republishSuppressed = (): UiAction<void> =>
    Effect.suspend(() => {
      const pending = owed;
      if (!pending) return Effect.void;
      if (deps.hostState() !== "connected") return Effect.void;
      console.info(
        `terminal ${deps.terminalId}: host entry is connected again — restating the suppressed ${pending.cols}×${pending.rows} grid`,
      );
      return publish(pending);
    });

  return { publish, republishSuppressed };
}
