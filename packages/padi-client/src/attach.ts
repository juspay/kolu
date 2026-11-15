/**
 * **The `terminalAttach` CONSUMER CONTRACT** — what you must do with the frames,
 * not just how to subscribe to them.
 *
 * Subscribing is the easy half and it is already yours: the member is
 * `padiSurface.streams.terminalAttach`, its input is
 * `PadiTerminalAttachInputSchema`, and its frames are the discriminated
 * `snapshot | delta | resized` union, all in `./surface`. This module is the
 * OTHER half — the rules a consumer cannot derive from those schemas, and which
 * cost kolu three production incidents to learn (kolu#2101 deploys #2 and #3:
 * three panes blank over live agents at once, and scrollback rebuilt at the
 * wrong width; kolu#2362: the top of a terminal blank after a split closed
 * under a working agent).
 *
 * Four things are true about this stream that nothing in its schema says:
 *
 *  1. **THE STREAM OWNS YOUR TERMINAL'S SIZE.** Your box decides what size you
 *     ASK for; it never decides what size your terminal IS. Two frames change
 *     that size and nothing else may:
 *       · a `snapshot` — set your terminal to the frame's `grid`, then paint its
 *         bytes. They are laid out for exactly that cols×rows.
 *       · a `resized` — set your terminal to the frame's `grid`, at this point
 *         in the stream.
 *     Do it anywhere else and you have invented a screen the program never drew.
 *
 *     This is not a style preference, it is the only way the two screens can be
 *     made to agree. The pty's mirror resizes when the host resizes it; your
 *     box moves when the user drags a divider. Those are different moments, and
 *     everything written between them is laid out for one grid. Resize at your
 *     moment and you parse those bytes at the other size: the cursor ends a row
 *     off, different lines come out of scrollback, and the program's next
 *     repaint — "up N, erase below, redraw", which is what a full-screen agent
 *     does on SIGWINCH — erases the wrong rows on your side and nowhere else.
 *     Resize at the stream's moment and your screen has received the same events
 *     in the same order as the mirror, so it cannot disagree with it about a
 *     resize at all.
 *
 *  2. **ORDER IS THE WHOLE CONTENT OF A `resized` FRAME.** It carries a grid,
 *     but what it MEANS is a position: every byte before it is laid out for the
 *     old size, every byte after it for the new one. A consumer that buffers
 *     bytes anywhere — a rate-coalescer, a scroll lock, a paint queue — must put
 *     the resize through the SAME buffer, in line. A resize that overtakes bytes
 *     you are still holding is the original defect, reproduced locally.
 *
 *  3. **You still ASK, and you may not get it.** `resizeTo` is last-attach-wins
 *     on a SHARED pty, so another viewer attaching at its size moves yours. You
 *     will be told — the `resized` frame arrives on your stream and your screen
 *     follows the pty — but following is not winning. Three things can leave the
 *     pty at a size you did not ask for:
 *       · another viewer attached at ITS size;
 *       · the framework's transport retry re-subscribed by REPLAYING the input
 *         it captured at the first call, so a retry re-sent an ORIGINAL grid
 *         your box has moved on from (see `dev/skills/streaming/SKILL.md`, "A
 *         member's input is CAPTURED — never a live fact");
 *       · you resized while the request was in flight.
 *     None of them is a frame to refuse — the bytes you are being sent are
 *     correct for the size they state, and painting them is right. What they
 *     are is a SIZE DISAGREEMENT, and the standing fact that reports it is the
 *     terminal record's grid (`TerminalSnapshot.grid`, on the awareness half of
 *     `terminalWorkspace.snapshots`). When it differs from the grid your box
 *     wants, re-attach at your grid, which re-asserts it. Two viewers then
 *     ping-pong the width, which is `./surface`'s multi-client contract's own
 *     stated outcome — contention costs a repaint, never the attach loop — so
 *     wait out a settle window first (your OWN resize produces exactly the same
 *     mismatch for one round trip) and bound the reopen with the same backoff
 *     your other re-attach lanes use.
 *
 *     Absence on either side ANSWERS "no evidence": a pane that has not measured
 *     has nothing to ask for, and reopening on ignorance spins a loop.
 *
 *  4. **A clean end does not mean the PTY exited, and silence is a failure mode
 *     with no event.** Treat completion as a recoverable re-attach unless your
 *     own facts about the terminal agree it is gone; kolu budgets the
 *     re-attaches so a genuinely-dead terminal still converges. And a stream can
 *     open, never fail, never end, and never deliver — leaving a pane blank over
 *     a live agent forever — so give the FIRST frame a deadline and treat expiry
 *     as a re-attach. Having a deadline is the contract; the number is policy.
 *
 * The LOOP that acts on all of it — backoff, budgets, the fruitless-cycle
 * verdict, how a disagreement is surfaced to a user — is deliberately NOT here.
 * It is application policy (kolu's lives in
 * `client/src/terminal/reattachingStream.ts` and reaches for toasts), and a
 * package that shipped it would be shipping one app's idea of how loudly to
 * complain. What ships here is the part that is a property of the CONTRACT, so
 * no consumer has to rediscover it the way kolu did.
 */

import type { EndpointGrid, TerminalAttachFrame } from "./surface.ts";

/** The grid this frame SETS the consumer's terminal to, or `undefined` for a
 *  frame that sets nothing (a `delta`).
 *
 *  The one reading rule 1 is spelled as, so a consumer writes one branch
 *  instead of two and cannot cover `snapshot` while forgetting `resized`. Both
 *  frames mean the same imperative — "your terminal is this size as of here" —
 *  and differ only in whether bytes follow in the same frame. */
export function frameGrid(
  frame: TerminalAttachFrame,
): EndpointGrid | undefined {
  return frame.kind === "delta" ? undefined : frame.grid;
}

/** Narrow a frame to the snapshot arm — the one that also carries a screen to
 *  paint and a backfill seed to re-seed from.
 *
 *  Exported because every consumer needs it and `"kind" in frame` narrowing is
 *  easy to spell subtly wrong; this tests the discriminant rather than the
 *  presence of `topLine`. */
export function isSnapshotFrame(
  frame: TerminalAttachFrame,
): frame is Extract<TerminalAttachFrame, { kind: "snapshot" }> {
  return frame.kind === "snapshot";
}

/** Narrow a frame to the `resized` arm — the control frame whose POSITION in
 *  the stream is its content (rule 2). */
export function isResizedFrame(
  frame: TerminalAttachFrame,
): frame is Extract<TerminalAttachFrame, { kind: "resized" }> {
  return frame.kind === "resized";
}
