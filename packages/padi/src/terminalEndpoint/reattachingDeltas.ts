import { hasTag } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PtyHostDataMsg } from "kaval";
import { PtyNotFound } from "kaval";
import { abortableDelay } from "../abortableDelay.ts";
import {
  type EndpointGrid,
  TERMINAL_RESET,
  type TerminalAttachFrame,
} from "../endpoint.ts";
import { log } from "../log.ts";

export { TERMINAL_RESET };

export const REATTACH_PAUSE_MS = 150;

export const PLAIN_END_REOPEN_ATTEMPTS = 3;

export const OSCILLATION_CYCLES = 8;

export const OSCILLATION_WINDOW_MS = 10_000;

export const OSCILLATION_LOG_INTERVAL_MS = 60_000;

const NEVER_ABORTS: AbortSignal = new AbortController().signal;

/** On the two per-terminal STREAM members `PtyNotFound` is an UNDECLARED
 *  failure (a `StreamSpec` has no error channel to carry it — kaval's stated
 *  asymmetry), so it can reach a re-open as a bare defect rather than a decoded
 *  class instance. Matching the tag rather than the constructor is what keeps
 *  the recognition honest across that hop, and across two copies of the class in
 *  one bundle. */
function isPtyNotFound(err: unknown): boolean {
  return hasTag(err, PTY_NOT_FOUND_TAG);
}

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
  /** The grid the fresh snapshot was LAID OUT at — carried onto the re-attach
   *  frame so a consumer sizes its terminal to the bytes before painting them.
   *  Required since kaval contract 9.0.
   *
   *  `null` only on the one open that describes no screen: the consumer aborted
   *  before kaval answered. */
  grid: EndpointGrid | null;
  iter: AsyncIterator<PtyHostDataMsg>;
}

export interface ReattachContext {
  id: TerminalId;
  /** The consumer's teardown. Absent ⇒ no teardown channel, so no plain end is
   *  ever ours. */
  signal?: AbortSignal;
}

/**
 * Bridge a consumer's abort onto ONE opened kaval attach's teardown.
 *
 * Per WHATWG, `addEventListener("abort")` on an ALREADY
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
 */
export async function* reattachingDeltas(
  open: () => Promise<OpenedAttach>,
  firstIter: AsyncIterator<PtyHostDataMsg>,
  ctx: ReattachContext,
): AsyncGenerator<TerminalAttachFrame> {
  const signal = ctx.signal ?? NEVER_ABORTS;
  let cur = firstIter;
  let barrenReopens = 0;
  const cycles: number[] = [];
  let reportedAt = 0;
  const recordOscillationCycle = (): void => {
    const now = Date.now();
    const windowStart = now - OSCILLATION_WINDOW_MS;
    while (cycles.length > 0 && (cycles[0] as number) < windowStart) {
      cycles.shift();
    }
    cycles.push(now);
    if (cycles.length < OSCILLATION_CYCLES) return;
    if (now - reportedAt < OSCILLATION_LOG_INTERVAL_MS) return;
    reportedAt = now;
    log.warn(
      {
        id: ctx.id,
        cycles: cycles.length,
        windowMs: OSCILLATION_WINDOW_MS,
        spanMs: now - (cycles[0] as number),
        pauseMs: REATTACH_PAUSE_MS,
      },
      "attach: the kaval attach stream is oscillating — each leg delivers a frame and then ends plainly, which refills the re-open budget by design, so this loop will not stop on its own; the chain between padi and the pty-host keeps dropping attachments",
    );
  };
  for (;;) {
    let overflowed = false;
    let delivered = false;
    for await (const msg of { [Symbol.asyncIterator]: () => cur }) {
      delivered = true;
      if (msg.kind === "overflow") {
        overflowed = true;
        break;
      }
      if (msg.kind === "resized") {
        yield { kind: "resized", grid: msg.grid };
        continue;
      }
      if (msg.kind === "snapshot") {
        throw new Error(
          `attach(${ctx.id}): kaval sent a mid-stream snapshot frame, which the attach contract does not allow`,
        );
      }
      yield { kind: "delta", data: msg.data };
    }
    const ending = classifyEnd(overflowed, delivered, signal.aborted);
    if (ending === "ourAbort") return;
    let pause = REATTACH_PAUSE_MS;
    if (ending === "overflow") {
      barrenReopens = 0;
    } else {
      if (ending === "productive") {
        barrenReopens = 0;
        recordOscillationCycle();
      }
      if (++barrenReopens > PLAIN_END_REOPEN_ATTEMPTS) {
        throw new Error(
          `attach: the kaval stream ended with no overflow frame and no PTY exit ${barrenReopens} times in a row, delivering nothing — giving up after ${PLAIN_END_REOPEN_ATTEMPTS} re-opens`,
        );
      }
      pause = REATTACH_PAUSE_MS * 2 ** (barrenReopens - 1);
    }
    await abortableDelay(pause, signal);
    if (signal.aborted) return;
    let next: OpenedAttach;
    try {
      next = await open();
    } catch (err) {
      if (isPtyNotFound(err)) return;
      throw err;
    }
    if (next.grid === null) return;
    yield {
      kind: "snapshot",
      data: TERMINAL_RESET + next.snapshot,
      topLine: next.topLine,
      reflowEpoch: next.reflowEpoch,
      grid: next.grid,
    };
    cur = next.iter;
  }
}

type AttachEnd = "overflow" | "ourAbort" | "productive" | "barren";

function classifyEnd(
  overflowed: boolean,
  delivered: boolean,
  aborted: boolean,
): AttachEnd {
  if (overflowed) return "overflow";
  if (aborted) return "ourAbort";
  return delivered ? "productive" : "barren";
}
