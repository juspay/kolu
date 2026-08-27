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
 *  2. **Two things can stale that grid**, and only one of them is your own
 *     resize:
 *       · you resized while the request was in flight;
 *       · the framework's transport retry re-subscribed by REPLAYING the input
 *         it captured at the first call — so a retry re-sends the ORIGINAL grid
 *         even though your pane has moved on (see `.claude/rules/streaming.md`,
 *         "A member's input is CAPTURED — never a live fact").
 *
 *     Both are LOCAL: the predicate compares the grid you asked at with the grid
 *     you have now, and that is the whole of what it can see.
 *
 *  2b. **What it does NOT catch, stated because the tempting reading is wrong.**
 *     `resizeTo` is last-attach-wins on a SHARED pty, so another viewer
 *     attaching at its own size reflows the terminal under you. You will not
 *     detect it here and you cannot: your own attach asserted YOUR grid, so the
 *     snapshot you got answers the grid you asked at and this predicate rightly
 *     returns true. What you receive afterwards is reflowed BYTES — no snapshot,
 *     no frame to refuse — rendered at N columns inside your 2N-column pane
 *     until something makes you re-attach. `./surface`'s multi-client contract
 *     states the limit this predicate has. What CLOSES it is a different fact on
 *     a different field: the snapshot frame now carries `grid` — the cols×rows
 *     those bytes were serialized at (contract 5.5). Compare THAT with the grid
 *     you asked at and a foreign resize is visible; see {@link snapshotGridMoved}.
 *     Do not read `snapshotAnswersGrid` as an answer to it.
 *
 *     kolu CONSUMES that — `client/src/terminal/Terminal.tsx` refuses a frame
 *     whose served grid moved, in the same recoverable channel as a locally
 *     stale one. Stated because shipping the detector and not wiring it would
 *     have left this header claiming a gap was closed while the app still
 *     painted the corruption.
 *
 *  3. **A clean end does not mean the PTY exited.** Treat completion as a
 *     recoverable re-attach unless your own facts about the terminal agree it is
 *     gone; kolu budgets the re-attaches so a genuinely-dead terminal still
 *     converges.
 *
 *  4. **Silence is a failure mode with no event.** A stream can open, never
 *     fail, never end, and never deliver — leaving a pane blank over a live
 *     agent forever. Give the first frame a deadline and treat expiry as a
 *     re-attach. Having a deadline is the contract; the number is policy, so
 *     pick your own rather than inheriting one from here.
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
 *  and ask it before writing a byte. What it answers is precisely "did THIS
 *  pane's grid move since we asked" — see 2b above for what that excludes. */
export function snapshotAnswersGrid(
  asked: EndpointGrid | null | undefined,
  current: EndpointGrid | null | undefined,
): boolean {
  if (!asked || !current) return true;
  return asked.cols === current.cols && asked.rows === current.rows;
}

/** What grid were these bytes laid out at?
 *
 *  The answer for an OBSERVE-ONLY consumer — one that attaches with no
 *  `resizeTo` because it has no size to assert (a monitor, a read-only pane, a
 *  CLI dumping the screen). Such a consumer asserts nothing and so, before
 *  contract 5.5, learned nothing: it had to size its renderer by guess, and a
 *  mismatched box wraps the bytes into garbage. Size to this instead.
 *
 *  `undefined` from a padi/kaval predating 5.5 — fail-open, size as you did
 *  before. It is optional on the wire precisely so an older daemon is not
 *  recycled (killing live PTYs) to buy a readout. */
export function snapshotGrid(
  frame: TerminalAttachFrame,
): EndpointGrid | undefined {
  return isSnapshotFrame(frame) ? frame.grid : undefined;
}

/** Did someone ELSE move this terminal?
 *
 *  The honest foreign-resize detector, and the thing {@link snapshotAnswersGrid}
 *  deliberately is not: it compares the grid you ASKED at with the grid the
 *  bytes were actually SERIALIZED at, which is a fact from the other side of the
 *  wire. `resizeTo` is last-attach-wins on a shared pty, so a mismatch here
 *  means another viewer holds the terminal at its own size and your pane is
 *  rendering N columns of content in a 2N-column box.
 *
 *  `false` when either side is absent — an older daemon that sends no grid, or
 *  a consumer that asked at none. Ignorance is not evidence, the same rule
 *  {@link snapshotAnswersGrid} follows, and for the same reason: a detector that
 *  fires on silence would light permanently against a 5.4 padi. */
export function snapshotGridMoved(
  frame: TerminalAttachFrame,
  asked: EndpointGrid | null | undefined,
): boolean {
  const served = snapshotGrid(frame);
  if (!served || !asked) return false;
  return served.cols !== asked.cols || served.rows !== asked.rows;
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
