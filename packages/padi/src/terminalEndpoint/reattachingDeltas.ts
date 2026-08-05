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
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { abortableDelay } from "../abortableDelay.ts";
import { log } from "../log.ts";
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

/** How many DELIVER-then-plain-end cycles inside {@link OSCILLATION_WINDOW_MS}
 *  mean "this chain is oscillating" rather than "this chain blipped".
 *
 *  **Why this lane has no ceiling, and gets loudness instead.** A leg that
 *  delivers at least one frame and then ends plainly RESETS the barren counter
 *  (see {@link PLAIN_END_REOPEN_ATTEMPTS}) — by design, and the design is right:
 *  a stream that keeps flowing is working, and capping it would kill a chain
 *  that is genuinely recovering. But the same reset means a flaky proxy that
 *  hands back one frame and hangs up can hold this loop at ~150ms per cycle
 *  FOREVER, and until this constant existed it did so without a single log line.
 *  Unbounded is defensible; unbounded AND silent is not.
 *
 *  **Deriving N.** The only question is where "recovering" ends and
 *  "oscillating" begins:
 *   - a genuine reconvergence blip is ONE cycle — {@link REATTACH_PAUSE_MS} is
 *     the unit of "let a host that just spawned two dozen terminals settle", and
 *     the documented transient (an overflow burst) "re-attaches once and settles";
 *   - the worst honest transient is a chain rebuild landing mid-attach, which
 *     spends at most the full barren ladder (150+300+600 ≈ 1.05s) and then either
 *     flows or throws — call it TWO cycles;
 *   - so 1–2 cycles must stay silent, and N = 8 keeps a 4× margin over that while
 *     still tripping ~1.2s into a sustained oscillation (a delivering leg resets
 *     the backoff, so the cadence stays a flat {@link REATTACH_PAUSE_MS}).
 *
 *  The cycle is counted on DELIVERY, not on "exactly one frame": the pathology is
 *  the cadence, not the payload size, and a leg that delivers fifty frames before
 *  hanging up refills the budget exactly as thoroughly as a leg that delivers one. */
export const OSCILLATION_CYCLES = 8;

/** The window {@link OSCILLATION_CYCLES} is counted in. Far wider than the ~1.2s
 *  eight cycles take at full speed, so a SLOWER oscillation (up to ~1.25s per
 *  cycle — still pathological: kaval closes an attach fan-out in exactly one
 *  place, its own exit teardown, so it never ends a healthy attach) is caught
 *  too, while eight independent blips scattered across ten seconds is not
 *  something a healthy chain produces. */
export const OSCILLATION_WINDOW_MS = 10_000;

/** Minimum spacing between oscillation reports from ONE attach loop, so the
 *  report cannot become the flood it describes: at the ~150ms cadence this is one
 *  line per ~400 cycles, which is enough to see the condition start, persist and
 *  stop in a rolled log. State lives on the loop instance rather than in a
 *  module-level per-terminal map: the oscillation IS one loop that will not exit,
 *  so per-loop state needs no eviction and a genuinely new attach legitimately
 *  re-arms. */
export const OSCILLATION_LOG_INTERVAL_MS = 60_000;

/** Stand-in for "the caller gave us no teardown channel" — a signal that never
 *  aborts, so every abort check below reads the same way with or without one
 *  (absent signal ⇒ no teardown of ours ⇒ every plain end stays a question). */
const NEVER_ABORTS: AbortSignal = new AbortController().signal;

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

/** Everything the loop needs besides the attachments themselves: who it is
 *  streaming (the label on the oscillation report) and the consumer's teardown. */
export interface ReattachContext {
  /** The terminal being streamed — carried on the oscillation report so an
   *  operator reading padi's log knows WHICH pane is churning. */
  id: TerminalId;
  /** The consumer's teardown. Absent ⇒ no teardown channel, so no plain end is
   *  ever ours. */
  signal?: AbortSignal;
}

/**
 * Bridge a consumer's abort onto ONE opened kaval attach's teardown.
 *
 * A kaval stream member is a lazy `Stream`; the async iterator is what runs it,
 * and its `return()` interrupts the running fiber — which IS the unsubscribe
 * (D10/#18). So this is the whole release path for a subscription: without it an
 * aborted attach keeps a fan-out slot and a bounded queue on the host until the
 * PTY exits or the 10k-item overflow drops it.
 *
 * The `aborted` check in front is not an optimisation — it is the fix for a real
 * leak (kolu#2101 K2). Per WHATWG, `addEventListener("abort")` on an ALREADY
 * aborted signal never fires, and this bridge is registered once per `open()`,
 * including the re-opens the loop performs after a pause the abort landed in. A
 * bare registration there produces a subscription that NOTHING can ever detach.
 */
export function releaseOnAbort(
  iter: AsyncIterator<PtyHostDataMsg>,
  signal: AbortSignal | undefined,
): void {
  if (!signal) return;
  const release = (): void => {
    void iter.return?.();
  };
  if (signal.aborted) release();
  else signal.addEventListener("abort", release, { once: true });
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
 * `ctx.signal` is the ONE plain end that is genuinely ours and genuinely
 * graceful: the consumer's teardown aborts it, which is what ends the kaval
 * iterator in the first place ({@link releaseOnAbort} bridges the abort onto
 * `iter.return()`). Re-opening there would resurrect a subscription the caller
 * has already released — so the abort is checked at EVERY re-open, on the
 * overflow path as much as the plain-end one, and the pause between them is
 * abortable rather than a bare timer. Absent signal ⇒ no teardown channel ⇒ every
 * plain end is a question.
 */
export async function* reattachingDeltas(
  open: () => Promise<OpenedAttach>,
  firstIter: AsyncIterator<PtyHostDataMsg>,
  ctx: ReattachContext,
): AsyncGenerator<TerminalAttachFrame> {
  const signal = ctx.signal ?? NEVER_ABORTS;
  let cur = firstIter;
  /** Consecutive re-opens after a plain end that delivered nothing. Cleared by
   *  any frame — see {@link PLAIN_END_REOPEN_ATTEMPTS}. */
  let barrenReopens = 0;
  /** When each recent budget-refilling cycle happened, pruned to
   *  {@link OSCILLATION_WINDOW_MS} — bounded by the window over the cadence. */
  const refills: number[] = [];
  /** When this loop last reported an oscillation (0 ⇒ never). */
  let reportedAt = 0;
  /** Record one budget-refilling cycle and, once the cadence has crossed from
   *  "recovering" into "oscillating", REPORT it — rate-limited, because the loop
   *  it describes runs several times a second and forever. */
  const noteRefill = (): void => {
    const now = Date.now();
    const windowStart = now - OSCILLATION_WINDOW_MS;
    while (refills.length > 0 && (refills[0] as number) < windowStart) {
      refills.shift();
    }
    refills.push(now);
    if (refills.length < OSCILLATION_CYCLES) return;
    if (now - reportedAt < OSCILLATION_LOG_INTERVAL_MS) return;
    reportedAt = now;
    log.warn(
      {
        id: ctx.id,
        cycles: refills.length,
        windowMs: OSCILLATION_WINDOW_MS,
        spanMs: now - (refills[0] as number),
        pauseMs: REATTACH_PAUSE_MS,
      },
      "attach: the kaval attach stream is oscillating — each leg delivers a frame and then ends plainly, which refills the re-open budget by design, so this loop will not stop on its own; the chain between padi and the pty-host keeps dropping attachments",
    );
  };
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
      if (signal.aborted) return;
      if (delivered) {
        barrenReopens = 0;
        // A refilled budget is the unbounded lane. Count it, and once the
        // cadence says "oscillating" rather than "recovering", SAY SO — this is
        // the loop's only report, and without it the churn is invisible.
        const now = Date.now();
        while (refills.length > 0 && now - (refills[0] as number) > OSCILLATION_WINDOW_MS) {
          refills.shift();
        }
        refills.push(now);
        if (
          refills.length >= OSCILLATION_CYCLES &&
          now - reportedAt >= OSCILLATION_LOG_INTERVAL_MS
        ) {
          reportedAt = now;
          log.warn(
            {
              id: ctx.id,
              cycles: refills.length,
              windowMs: OSCILLATION_WINDOW_MS,
              spanMs: now - (refills[0] as number),
              pauseMs: REATTACH_PAUSE_MS,
            },
            "attach: the kaval attach stream is oscillating — each leg delivers a frame and then ends plainly, which refills the re-open budget by design, so this loop will not stop on its own; the chain between padi and the pty-host is dropping attachments",
          );
        }
      }
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
    // Abortable, not a bare `setTimeout`: a consumer that disconnects during the
    // pause must end the loop HERE, not 150–600ms later.
    await abortableDelay(pause, signal);
    // The abort check that guards EVERY re-open — both the plain-end path (which
    // may have aborted during the pause it just took) and the overflow path
    // (which never checked at all). Re-opening past this point would subscribe a
    // fresh kaval attach for a consumer that is already gone, and the abort that
    // would have released it has already fired.
    if (signal.aborted) return;
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
