/**
 * The framer — turns a memoryless producer's `emit` sequence into the framed
 * `TerminalFrame` stream the consumer (and the wire) speak. It derives PHASE and
 * SEQ **only**: it never decides liveness (that's kolu's consumer-arm baseline
 * check — a remote framer runs in pulam, which has no kolu memory) and never
 * touches the two memory facts (the producer can't spell them, by type).
 *
 * Two callers, one factory:
 *   - kolu's LOCAL in-process path stamps every emission `phase:"delta"` — there
 *     is no per-subscription snapshot, because kolu seeds `current` from its
 *     durable record. A `snapshot`-phased local emit would fold with `live:false`
 *     and so SUPPRESS the fresh-spawn recency bump — exactly the bug the framer
 *     must not introduce.
 *   - the SERVING side (pulam) emits a `snapshot` frame per subscription (the
 *     current state replayed as events, via {@link snapshotToEvents}), then a
 *     `delta` per live emission with a monotonic per-subscription `seq`.
 *
 * The framer is the ONE phase/seam, so "subscribe-and-fold" is uniform: only the
 * SOURCE of frames differs (in-process framer vs the ssh wire F-REMOTE consumes).
 */

import type {
  TerminalEvent,
  TerminalFrame,
  TerminalSnapshot,
} from "./schema.ts";

/** Assigns phase + a monotonic per-instance `seq` to a producer's raw events.
 *  One framer per local terminal (its deltas run 1, 2, 3, … over the terminal's
 *  life) or per serving subscription (the snapshot, then deltas 1, 2, 3, …). */
export interface Framer {
  /** A live emission as a `delta` frame (seq advances). */
  delta(events: TerminalEvent[]): TerminalFrame;
  /** The current state as a `snapshot` frame — phase-tagged so the consumer folds
   *  it with `live:false` (a re-observation never bumps recency). Does NOT advance
   *  `seq`; deltas are numbered relative to it. */
  snapshot(events: TerminalEvent[]): TerminalFrame;
}

/** Build a framer with its own `seq` counter. */
export function createFramer(): Framer {
  let seq = 0;
  return {
    delta: (events) => ({ phase: "delta", seq: ++seq, events }),
    snapshot: (events) => ({ phase: "snapshot", events }),
  };
}

/** Replay a `TerminalSnapshot` as the five observation events that reconstruct it
 *  under {@link foldSnapshot} — the body of a `snapshot` frame. There are exactly
 *  five (one per re-samplable field); `commandRun` is intentionally absent — it's
 *  a MEMORY mark the snapshot cache drops, so a consumer only ever sees it as a
 *  live `delta`, which is why a remote kolu must read this event stream, not the
 *  served snapshot. */
export function snapshotToEvents(s: TerminalSnapshot): TerminalEvent[] {
  return [
    { kind: "cwd", cwd: s.cwd },
    { kind: "git", git: s.git },
    { kind: "pr", pr: s.pr },
    { kind: "agent", agent: { value: s.agent } },
    { kind: "foreground", foreground: s.foreground },
  ];
}

/** Just the `subscribe` slice of a `Channel<TerminalEvent>` the serving framer
 *  needs — kept structural so this file stays free of the `@kolu/surface/server`
 *  runtime (the framer is pure). A home passes its own broadcast channel. */
export interface TerminalEventSource {
  subscribe(signal: AbortSignal | undefined): AsyncIterable<TerminalEvent>;
}

/** Serve one terminal's framed event stream: a `snapshot` frame (current state
 *  replayed as events) followed by a `delta` per live emission, with a monotonic
 *  per-subscription `seq`.
 *
 *  Subscribe-BEFORE-snapshot, so no emission in the snapshot→first-delta window is
 *  lost: `events.subscribe(signal)` registers the subscriber synchronously, so an
 *  emission published between reading the snapshot and forwarding it is BUFFERED,
 *  not dropped (an emission already folded into the snapshot AND buffered is a
 *  harmless duplicate — last-write-wins / `commandRun` dedup). Acquire one iterator
 *  up front and return it in `finally`, so an early `.return()` taken after the
 *  snapshot `yield` still drops the subscriber (the same shape `@kolu/surface`'s
 *  collection `subscribeBeforeSnapshot` uses). */
export async function* serveTerminalEvents(deps: {
  events: TerminalEventSource;
  currentSnapshot: () => TerminalSnapshot;
  signal: AbortSignal | undefined;
}): AsyncGenerator<TerminalFrame> {
  const framer = createFramer();
  const iterator = deps.events.subscribe(deps.signal)[Symbol.asyncIterator]();
  try {
    yield framer.snapshot(snapshotToEvents(deps.currentSnapshot()));
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield framer.delta([next.value]);
    }
  } finally {
    await iterator.return?.();
  }
}
