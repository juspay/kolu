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
 * last frame; here we read it as "re-attach for a fresh snapshot", distinct from
 * a graceful end (PTY exit / abort / close), which ends the stream for real.
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

import { TERMINAL_RESET, type TerminalAttachFrame } from "../endpoint.ts";
import type { PtyHostDataMsg } from "kaval";
import { PtyNotFound } from "kaval";

/** RIS (`ESC c`) — a full terminal reset. Re-exported from the frame-type barrel
 *  (`endpoint.ts`, the one source of truth both sides read) so existing importers
 *  keep resolving it here. Prepended to a re-attach snapshot so the consumer's
 *  screen + scrollback clear before it redraws. */
export { TERMINAL_RESET };

/** Pause before an overflow-driven re-attach, so a pathological host that keeps
 *  dropping us immediately can't spin the loop hot (mirrors kaval-tui's
 *  re-attach pause). One transient burst re-attaches once and settles. */
export const REATTACH_PAUSE_MS = 150;

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
 * host drops us for overflow — so the consumer sees one unbroken stream across
 * the drop. Each re-attach yields `TERMINAL_RESET` + the fresh snapshot, then
 * the new iterator's deltas. A graceful end (no `overflow` frame) ends the
 * stream; a re-attach that hits kaval's `PtyNotFound` (the PTY vanished
 * meanwhile) ends it cleanly too — any other re-open failure propagates.
 */
export async function* reattachingDeltas(
  open: () => Promise<OpenedAttach>,
  firstIter: AsyncIterator<PtyHostDataMsg>,
): AsyncGenerator<TerminalAttachFrame> {
  let cur = firstIter;
  for (;;) {
    let overflowed = false;
    // `cur` is an AsyncIterator, not AsyncIterable — wrap it so `for await` can
    // consume the already-advanced iterator (its snapshot was read by `open`).
    for await (const msg of { [Symbol.asyncIterator]: () => cur }) {
      if (msg.kind === "overflow") {
        overflowed = true;
        break;
      }
      yield { kind: "delta", data: msg.data };
    }
    if (!overflowed) return; // graceful end: PTY exit / abort / clean close
    await new Promise((r) => setTimeout(r, REATTACH_PAUSE_MS));
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
