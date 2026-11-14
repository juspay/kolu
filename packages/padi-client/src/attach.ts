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
 *  1. **A snapshot is only valid at the grid it was LAID OUT for.** The frame is
 *     bytes already laid out for a specific `cols × rows`. Painting one laid out
 *     for a different grid does damage you cannot undo afterwards: a later
 *     SIGWINCH repaints a full-screen app, but nothing rebuilds scrollback that
 *     has already been wrapped at the wrong width.
 *
 *     So, BEFORE writing a byte: ask {@link snapshotLayoutGrid} which grid these
 *     bytes were laid out at, and paint only if {@link snapshotPaintableAt} says
 *     that is the grid your pane has NOW. On a mismatch, refuse the frame and
 *     re-attach at the current grid.
 *
 *     NOW — not "the grid you asked at", and that difference is the whole of
 *     rule 2. The question a consumer actually has is "do these bytes fit the
 *     box I am about to paint them into"; the grid you asked at is a PROXY for
 *     it, and was the best one available before contract 5.5 put the real answer
 *     on the frame. Judging by the proxy refuses frames that are in fact
 *     perfect: a host that re-serializes you AFTER acting on your resize answers
 *     at your NEW grid while the attach still remembers the grid it opened at —
 *     exactly the mid-stream re-snapshot kaval sends every subscriber when a
 *     real resize reflows the pty. Judged against the asked grid, every resize
 *     costs a refusal, a screen reset and a second round trip for a snapshot
 *     that was already right.
 *
 *  2. **Three things can make the layout not yours**, and only one of them is
 *     your own resize:
 *       · you resized while the request was in flight;
 *       · the framework's transport retry re-subscribed by REPLAYING the input
 *         it captured at the first call — so a retry re-sends the ORIGINAL grid
 *         even though your pane has moved on (see `dev/skills/streaming/SKILL.md`,
 *         "A member's input is CAPTURED — never a live fact");
 *       · another viewer attached at ITS size. `resizeTo` is last-attach-wins on
 *         a SHARED pty, so the bytes come back serialized at a width you never
 *         asked for.
 *
 *     The first two move your pane out from under the answer; the third moves
 *     the answer out from under your pane. ONE comparison catches all three,
 *     because {@link snapshotLayoutGrid} reads the frame's OWN `grid` whenever
 *     it states one — a fact from the other side of the wire, not a second local
 *     measurement of your own box.
 *
 *  2b. **Against a padi predating 5.5 the third case is invisible, and that is
 *     the degradation, not a bug.** A frame that states no `grid` falls back to
 *     the grid you asked at, so the comparison is two LOCAL measurements again
 *     and a foreign resize passes it: your own attach asserted YOUR grid, so
 *     asked === current and the frame is painted. What you receive afterwards is
 *     reflowed BYTES — no snapshot, no frame to refuse — rendered at N columns
 *     inside your 2N-column pane until something makes you re-attach.
 *     `./surface`'s multi-client contract states that limit. Fail-open is the
 *     deliberate half: a rule that refused on silence would refuse every frame a
 *     5.4 daemon sends, which spends live PTYs to buy a readout.
 *
 *  2c. **A foreign resize AFTER your snapshot sends you no frame at all**, and
 *     this is the half no frame-shaped rule can reach. Rule 1 judges the layout
 *     a SNAPSHOT was serialized at, so it only fires when a foreign resize beat
 *     that snapshot back to you. Once you are attached and streaming, the other
 *     viewer's attach reflows the pty and you receive — deltas. No snapshot, no
 *     frame to refuse, no error, nothing to time out. You keep painting bytes
 *     laid out for a grid you never asked for, indefinitely.
 *
 *     WATCH THE RECORD. The terminal record carries the pty's current grid
 *     (`TerminalSnapshot.grid`, contract 5.5 — on the awareness half of
 *     `terminalWorkspace.snapshots`, so it is already in whatever store holds
 *     your terminals). When it differs from the grid your pane has, you lost
 *     last-attach-wins: re-attach at your own grid, which re-asserts it. Two
 *     viewers then ping-pong the width, which is `./surface`'s multi-client
 *     contract's own stated outcome — contention costs a repaint, never the
 *     attach loop — so bound the reopen with the same backoff your other
 *     re-attach lanes use.
 *
 *     Absence on either side ANSWERS "no evidence", exactly as rule 1's
 *     predicates read it: an older padi states no grid, and a pane that has not
 *     measured has none to compare. Reopening on ignorance spins a loop against
 *     a pane with nothing to ask for.
 *
 *     Your OWN resize is not this case and needs no special-casing: it publishes
 *     the grid you then measure, so the two agree and nothing fires.
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

/** What grid were these bytes laid out at, as the FRAME itself states it?
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

/** The grid rule 1 judges a frame by: what layout are these bytes IN?
 *
 *  Two sources, one question. The frame's own `grid` (contract 5.5) is the
 *  answer whenever it states one, because it is the only source that can see
 *  another viewer's resize — it comes from the side of the wire that did the
 *  serializing. `asked` — the grid your OPEN request carried in `resizeTo` — is
 *  the fallback, and it is a PROXY rather than a second rule: a padi predating
 *  5.5 states nothing, so the only evidence left is that the host serialized the
 *  screen after applying the size you sent.
 *
 *  Absent on both sides for an observe-only consumer against an old daemon:
 *  nothing claimed, nothing to compare, and {@link snapshotPaintableAt} reads
 *  that as "do not refuse". */
export function snapshotLayoutGrid(
  frame: TerminalAttachFrame,
  asked: EndpointGrid | null | undefined,
): EndpointGrid | null | undefined {
  return snapshotGrid(frame) ?? asked;
}

/** May bytes laid out at `laidOutAt` be painted into a pane that is `current`?
 *
 *  The whole of rule 1, and the comparison is deliberately against the grid the
 *  pane has NOW rather than the grid it asked at: a host that re-serializes you
 *  after acting on your resize answers at your new size while the attach still
 *  remembers its old one, and those bytes fit the pane exactly. Refusing them
 *  would buy a reset and a second round trip for a snapshot that was already
 *  right — per resize, per viewer.
 *
 *  Both absences are benign and both mean "do not refuse": nothing has been
 *  claimed about the layout yet, or the pane has been disposed and released its
 *  measurement. A refusal in either case would spin a re-attach loop against a
 *  pane that is not there — which is the failure mode rule 1's first spelling
 *  caused when it was written to throw.
 *
 *  Ask it on EVERY `snapshot` frame, including a mid-stream overflow or
 *  resize re-attach, and ask it before writing a byte. Ask it a SECOND time if
 *  your writes land asynchronously (a parser, a scroll-lock buffer the user
 *  controls), against the layout grid you captured when you accepted the frame:
 *  a pane that resized while the bytes were in flight ends up with the same
 *  wrong-width screen as one that never checked at all. */
export function snapshotPaintableAt(
  laidOutAt: EndpointGrid | null | undefined,
  current: EndpointGrid | null | undefined,
): boolean {
  if (!laidOutAt || !current) return true;
  return laidOutAt.cols === current.cols && laidOutAt.rows === current.rows;
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
