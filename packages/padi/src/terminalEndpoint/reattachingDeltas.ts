/**
 * The overflow-recovery half of `local.ts`'s `attach()`: turn a *re-openable*
 * kaval attach into one continuous delta-string stream that survives a
 * slow-subscriber drop.
 *
 * kaval bounds each attach subscriber's buffer and DROPS a consumer that lags
 * (a wedged browser tab on a chatty PTY), ending its stream. Before contract
 * 4.0 that drop was indistinguishable on the wire from a PTY exit, so the web
 * tier ended the stream and the client froze its scrollback as if the terminal
 * had died. The host now emits a typed `overflow` control frame as the stream's
 * last frame; here we read it as "re-attach for a fresh snapshot".
 *
 * Since kolu#2101 an end WITHOUT that frame is no longer trusted either: the only
 * plain end that means "the PTY exited" is the one a re-open confirms with
 * `PtyNotFound`, and the only one that means "we let go" is our own abort. See
 * {@link reattachingDeltas} — that classification is the whole point of this
 * module now, and the overflow re-attach is one case of it.
 *
 * A fresh snapshot replaces the screen rather than appending to it, so we prefix
 * it with a full terminal reset — the byte-stream equivalent of the
 * `terminal.reset()` the browser already runs in its own reconnect `onRetry` —
 * so the re-attach repaints cleanly instead of double-painting onto stale rows.
 *
 * Kept as a pure function over an `open` callback (not a method reaching for the
 * `ptyHostClient` singleton) so the recovery loop is unit-testable with scripted
 * iterators.
 */

import type { PtyHostDataMsg } from "kaval";
import { PtyNotFound } from "kaval";
import { TERMINAL_RESET, type TerminalAttachFrame } from "../endpoint.ts";

/** RIS (`ESC c`) — a full terminal reset. Re-exported from the frame-type barrel
 *  (`endpoint.ts`, the one source of truth both sides read) so existing importers
 *  keep resolving it here. Prepended to a re-attach snapshot so the consumer's
 *  screen + scrollback clear before it redraws. */
export { TERMINAL_RESET };

/** Pause before an overflow-driven re-attach, so a pathological host that keeps
 *  dropping us immediately can't spin the loop hot (mirrors kaval-tui's
 *  re-attach pause). One transient burst re-attaches once and settles. */
export const REATTACH_PAUSE_MS = 150;

/** How many times a PLAIN end (no `overflow` frame) may be answered with a
 *  re-open before the loop gives up and THROWS.
 *
 *  **Why there is a budget at all.** The re-open IS the liveness probe (kaval
 *  answers `PtyNotFound` when the PTY is gone), so a live PTY re-opens and a dead
 *  one ends the stream. What neither answer covers is a chain that keeps handing
 *  back attachments that immediately end again — and a repair loop with no
 *  ceiling is the fallback this repo forbids. So the attempts are counted.
 *
 *  **Why three, and why this backoff.** The pause doubles per barren attempt off
 *  {@link REATTACH_PAUSE_MS} — 150ms, 300ms, 600ms, ~1.05s of in-process repair
 *  before the throw. The lower bound is kaval's own re-attach pause, the unit of
 *  "let a host that just spawned two dozen terminals settle". The upper bound is
 *  the ESCALATION: exhausting the budget is not the end of recovery, it hands off
 *  to the client's failure machinery (`client/src/terminal/reattachingStream.ts`,
 *  300ms backoff), which rebuilds the WHOLE chain — a strictly stronger repair
 *  that this loop must not delay for long. ~1s here plus one client cycle keeps
 *  the user-visible recovery inside the same ~2s budget the round already accepts
 *  for a full daemon respawn (G2). Spending longer in here would only mean a
 *  blank pane held by the layer with the weakest tools.
 *
 *  **Reset.** The count is CONSECUTIVE-barren: a leg that delivered at least one
 *  frame clears it, exactly as `STREAM_RETRY` resets its schedule when an element
 *  passes through (`surface/src/client.ts`). A stream that keeps flowing is
 *  working, however oddly its legs end; a stream that keeps ending empty is not. */
export const PLAIN_END_REOPEN_ATTEMPTS = 3;

/** "The PTY is gone" — kaval's own declared `PtyNotFound`, recognised
 *  STRUCTURALLY by its `_tag`.
 *
 *  On the two per-terminal STREAM members `PtyNotFound` is an UNDECLARED
 *  failure (a `StreamSpec` has no error channel to carry it — kaval's stated
 *  asymmetry), so it can reach a re-open as a bare defect rather than a decoded
 *  class instance. Matching the tag rather than the constructor is what keeps
 *  the recognition honest across that hop, and across two copies of the class in
 *  one bundle. */
function isPtyNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "_tag" in err &&
    (err as { _tag: unknown })._tag === PTY_NOT_FOUND_TAG
  );
}

/** The tag string, read OFF the class rather than re-spelled — a rename in
 *  kaval moves this with it instead of silently un-matching. */
const PTY_NOT_FOUND_TAG: string = new PtyNotFound({ id: "" })._tag;

/** One opened kaval attach: the screen snapshot already consumed off the wire,
 *  plus the iterator positioned at the first delta. */
export interface OpenedAttach {
  snapshot: string;
  /** Absolute mirror-line seed for the fresh snapshot — carried onto the
   *  re-attach frame so the client re-seeds its backfill cursor. */
  topLine: number;
  /** Reflow generation the fresh snapshot was serialized under — carried onto
   *  the re-attach frame so the client re-seeds its backfill epoch (F3).
   *  Undefined from a kaval predating the field (fail-open). */
  reflowEpoch?: number;
  iter: AsyncIterator<PtyHostDataMsg>;
}

/**
 * Yield the delta strings of `firstIter`, re-opening via `open` whenever the
 * host drops us — so the consumer sees one unbroken stream across the drop. Each
 * re-attach yields `TERMINAL_RESET` + the fresh snapshot, then the new
 * iterator's deltas. A re-attach that hits kaval's `PtyNotFound` (the PTY
 * vanished meanwhile) ends the stream cleanly — any other re-open failure
 * propagates.
 *
 * **A plain end is a QUESTION, not an answer (kolu#2101, deploy #2).** This loop
 * used to `return` the moment an iterator ended without an `overflow` frame,
 * reading that as "PTY exit / abort / clean close". Under the deploy-#2 restore
 * stampede that reading manufactured the incident: attach streams ended plainly
 * while their PTYs kept running, padi relayed a graceful end, and every retry
 * layer above — all of which retry FAILURES only — treated it as a normal exit.
 * Blank pane, live title, no verdict, forever.
 *
 * What kaval actually guarantees makes the old reading indefensible: it closes an
 * attach fan-out in exactly ONE place, the PTY's own `onExit` teardown (its
 * `entries.delete` runs in the same synchronous function), and there is no idle
 * timeout, reaper or lifetime cap. So a plain end while the PTY is alive can only
 * come from OUR side of the subscription or from the chain between us — never
 * from a healthy host deciding to stop. Which means the honest response is to ASK
 * again: `open()` IS the liveness probe, because kaval answers a re-open for a
 * departed PTY with `PtyNotFound`. Alive ⇒ re-attach and keep going (bounded by
 * {@link PLAIN_END_REOPEN_ATTEMPTS}); gone ⇒ end cleanly, which is the real exit.
 * A normal PTY exit therefore still ends this stream cleanly, one pause later,
 * and the manufactured clean end for a LIVE PTY is no longer spellable here.
 *
 * `signal` is the ONE plain end that is genuinely ours and genuinely graceful:
 * the consumer's teardown aborts it, which is what ends the kaval iterator in the
 * first place (`local.ts` bridges the abort onto `iter.return()`). Re-opening
 * there would resurrect a subscription the caller has already released. Absent
 * signal ⇒ no teardown channel ⇒ every plain end is a question.
 */
export async function* reattachingDeltas(
  open: () => Promise<OpenedAttach>,
  firstIter: AsyncIterator<PtyHostDataMsg>,
  signal?: AbortSignal,
): AsyncGenerator<TerminalAttachFrame> {
  let cur = firstIter;
  /** Consecutive re-opens after a plain end that delivered nothing. Cleared by
   *  any frame — see {@link PLAIN_END_REOPEN_ATTEMPTS}. */
  let barrenReopens = 0;
  for (;;) {
    let overflowed = false;
    let delivered = false;
    // `cur` is an AsyncIterator, not AsyncIterable — wrap it so `for await` can
    // consume the already-advanced iterator (its snapshot was read by `open`).
    for await (const msg of { [Symbol.asyncIterator]: () => cur }) {
      delivered = true;
      if (msg.kind === "overflow") {
        overflowed = true;
        break;
      }
      yield { kind: "delta", data: msg.data };
    }
    let pause = REATTACH_PAUSE_MS;
    if (overflowed) {
      // The host TOLD us why it dropped us, and a drop for overflow is proof of
      // a live, chatty PTY — nothing barren about it.
      barrenReopens = 0;
    } else {
      // Our own teardown: the abort is what ended the iterator (above), so this
      // is the one plain end that means what the old code assumed they all did.
      if (signal?.aborted) return;
      if (delivered) barrenReopens = 0;
      if (++barrenReopens > PLAIN_END_REOPEN_ATTEMPTS) {
        // LOUD, deliberately: the client's failure machinery re-subscribes the
        // whole chain on a failed stream, and a typed verdict beats a silent
        // clean end that renders as a frozen pane. Never `return` here.
        throw new Error(
          `attach: the kaval stream ended with no overflow frame and no PTY exit ${barrenReopens} times in a row, delivering nothing — giving up after ${PLAIN_END_REOPEN_ATTEMPTS} re-opens`,
        );
      }
      // Back off per barren attempt so a chain that keeps handing back
      // immediately-ending attachments can't spin this loop hot.
      pause = REATTACH_PAUSE_MS * 2 ** (barrenReopens - 1);
    }
    await new Promise((r) => setTimeout(r, pause));
    let next: OpenedAttach;
    try {
      next = await open();
    } catch (err) {
      // Narrow on the `_tag`, never on a code: kaval's `PtyNotFound` crosses a
      // wire by being decoded and re-encoded, and may arrive from another module
      // instance, so an `instanceof` against one realm's class would silently
      // stop recognising the other's — turning "the PTY is gone, end cleanly"
      // into "propagate a failure into a live attach stream".
      if (isPtyNotFound(err)) return;
      throw err;
    }
    // A fresh snapshot: reset the screen (RIS) AND re-seed the backfill cursor
    // with this re-attach's own `topLine` + reflow generation.
    yield {
      kind: "snapshot",
      data: TERMINAL_RESET + next.snapshot,
      topLine: next.topLine,
      reflowEpoch: next.reflowEpoch,
    };
    cur = next.iter;
  }
}
