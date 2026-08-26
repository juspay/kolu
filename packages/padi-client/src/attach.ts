/**
 * **The `terminalAttach` CONSUMER CONTRACT** — what you must do with the frames,
 * not just how to subscribe to them.
 *
 * Subscribing is the easy half and it is already yours: the member is
 * `padiSurface.streams.terminalAttach`, its input is
 * `PadiTerminalAttachInputSchema`, and its frames are the discriminated
 * `snapshot | delta` union, all in `./surface`. This module is the OTHER half —
 * the rules a consumer cannot derive from those schemas, and which cost kolu two
 * production incidents to learn (kolu#2101, deploys #2 and #3: three panes blank
 * over live agents at once, and scrollback rebuilt at the wrong width).
 *
 * Four things are true about this stream that nothing in its schema says:
 *
 *  1. **A snapshot is only valid at the grid it was asked for.** The frame is
 *     bytes already laid out for a specific `cols × rows`. Painting one that
 *     answers a different grid does damage you cannot undo afterwards: a later
 *     SIGWINCH repaints a full-screen app, but nothing rebuilds scrollback that
 *     has already been wrapped at the wrong width. Check with
 *     {@link snapshotAnswersGrid} BEFORE writing a byte; on a mismatch, refuse
 *     the frame and re-attach at the current grid.
 *
 *  2. **Three different things can stale that grid**, and only one of them is
 *     your own resize:
 *       · you resized while the request was in flight;
 *       · the framework's transport retry re-subscribed by REPLAYING the input
 *         it captured at the first call — so a retry re-sends the ORIGINAL grid
 *         even though your pane has moved on (see `.claude/rules/streaming.md`,
 *         "A member's input is CAPTURED — never a live fact");
 *       · **another client attached at its own size.** `resizeTo` is
 *         last-attach-wins on a SHARED pty, so a phone joining the same terminal
 *         resizes it under you, with no local event to observe. This is the one
 *         no consumer guesses, and it is why the check must run on every
 *         snapshot rather than only after your own resizes.
 *
 *  3. **A clean end does not mean the PTY exited.** Treat completion as a
 *     recoverable re-attach unless your own facts about the terminal agree it is
 *     gone; kolu budgets the re-attaches so a genuinely-dead terminal still
 *     converges.
 *
 *  4. **Silence is a failure mode with no event.** A stream can open, never
 *     fail, never end, and never deliver — leaving a pane blank over a live
 *     agent forever. Give the first frame a deadline and treat expiry as a
 *     re-attach. kolu uses 4 s; the number is policy, having one is not.
 *
 * The LOOP that acts on all four — backoff, budgets, the fruitless-cycle
 * verdict, how a refusal is surfaced to a user — is deliberately NOT here. It is
 * application policy (kolu's lives in `client/src/terminal/reattachingStream.ts`
 * and reaches for toasts), and a package that shipped it would be shipping one
 * app's idea of how loudly to complain. What ships here is the part that is a
 * property of the CONTRACT, so no consumer has to rediscover it the way kolu
 * did.
 */

import type { EndpointGrid, TerminalAttachFrame } from "./surface.ts";

/** Is this snapshot still describing the pane it will be painted into?
 *
 *  `asked` is the grid the OPEN request carried (`resizeTo`), remembered at the
 *  moment the stream was opened — not re-read, because the answer in flight
 *  belongs to the question that was asked. `current` is the grid the pane has
 *  now.
 *
 *  Both absences are benign and both mean "do not refuse": no request has been
 *  made yet, or the pane has been disposed and released its measurement. A
 *  refusal in either case would spin a re-attach loop against a pane that is not
 *  there — which is the failure mode this predicate's own error path caused when
 *  it was first written as a throw.
 *
 *  Ask it on EVERY `snapshot` frame, including a mid-stream overflow re-attach,
 *  and ask it before writing a byte. */
export function snapshotAnswersGrid(
  asked: EndpointGrid | null | undefined,
  current: EndpointGrid | null | undefined,
): boolean {
  if (!asked || !current) return true;
  return asked.cols === current.cols && asked.rows === current.rows;
}

/** Narrow a frame to the snapshot arm — the frames rule 1 governs.
 *
 *  A `delta` is bytes to write and carries no layout claim; a `snapshot` is a
 *  serialized screen plus the `topLine` seed for a scrollback-backfill cursor,
 *  and it is the ONLY arm that can be stale. Spelled once here so a consumer
 *  tests the discriminant rather than the presence of `topLine`. */
export function isSnapshotFrame(
  frame: TerminalAttachFrame,
): frame is Extract<TerminalAttachFrame, { kind: "snapshot" }> {
  return frame.kind === "snapshot";
}
