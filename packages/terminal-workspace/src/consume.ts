/**
 * kolu's consumer arm — the half of awareness a producer (local or remote)
 * cannot supply. The producer/framer derive PHASE + SEQ; this arm derives
 * LIVENESS and folds with kolu's clock. It owns the durable RECENCY BASELINE —
 * the last known-live agent identity, seeded from kolu's restore target — so the
 * one product judgment ("is this a NEW live agent?") reads kolu's memory, never
 * the frame phase alone:
 *
 *   live = (phase === "delta") AND agentIdentityChanged(baseline, value)
 *
 * Both conjuncts are load-bearing. The phase rules out a `snapshot` re-observation.
 * The baseline rules out a re-resolution of an already-known agent — the ADOPT
 * GUARD: `adoptedSnapshot` seeds `agent: null`, so on adopt the resumed agent
 * re-resolves as a `delta` and `agentIdentityChanged(snapshot.agent=null, A)` is
 * `true`; only the seeded baseline (the resume identity, riding the authored
 * `restoreTarget`) makes it `false` and prevents a spurious recency bump. Drop the
 * baseline and every restart re-stamps recency.
 *
 * `fold.ts` is untouched (its internal `agentIdentityChanged(cur.snapshot.agent, …)`
 * is redundant-but-harmless: this arm already gates `ctx.live` on the durable
 * baseline). The arm is re-seedable — a fresh seed per (re)start, and a `gap`
 * frame re-snapshots rather than fold a divergent stream — so F-REMOTE reuses it
 * verbatim for the remote subscribe path; only the SOURCE of frames differs.
 */

import { agentIdentityChanged, fold } from "./fold.ts";
import type {
  AgentIdentity,
  AgentMemory,
  TerminalEvent,
  TerminalFrame,
  TerminalSnapshot,
  TerminalState,
} from "./schema.ts";

/** What seeds (or re-seeds) the arm: kolu's last-known `TerminalState` plus the
 *  durable recency baseline. The producer can't construct any of it — it is
 *  exactly the memory a host can't re-observe. */
export interface ConsumerSeed {
  snapshot: TerminalSnapshot;
  memory: AgentMemory;
  /** The last known-live agent identity, from kolu's restore target (`exact`'s
   *  agent, else `null`). Equal-on-re-resolution ⇒ no bump (adopt/wake). */
  baseline: AgentIdentity | null;
}

export interface ConsumerArmOptions {
  /** kolu's clock, sampled once per folded event (a remote producer's wall clock
   *  is never imported as ordering truth). Default `Date.now`. */
  clock?: () => number;
  /** The fresh seed a `gap` frame re-snapshots from (re-read kolu's durable
   *  record). Omitted where gaps can't occur — the local in-process framer only
   *  ever stamps `delta`, so a gap there is unreachable; a gap with no source is a
   *  loud throw, never a silent diverge. */
  reseed?: () => ConsumerSeed;
}

export interface ConsumerArm {
  /** Fold one frame into kolu's state. `snapshot`/`delta` fold each event,
   *  invoking `onEvent(event, before, after)` per event so the caller runs its OWN
   *  effects (kolu-server commits; F-REMOTE host-keyed writes); `gap` re-seeds from
   *  the configured source and invokes `onEvent` for none. */
  consume(
    frame: TerminalFrame,
    onEvent: (
      event: TerminalEvent,
      before: TerminalState,
      after: TerminalState,
    ) => void,
  ): void;
  /** kolu's current folded state (read after a `consume`). */
  readonly state: TerminalState;
}

/** Build a consumer arm seeded from kolu's durable record. */
export function createConsumerArm(
  seed: ConsumerSeed,
  opts: ConsumerArmOptions = {},
): ConsumerArm {
  const clock = opts.clock ?? Date.now;
  let state: TerminalState = { snapshot: seed.snapshot, memory: seed.memory };
  let baseline: AgentIdentity | null = seed.baseline;

  const reseed = (s: ConsumerSeed): void => {
    state = { snapshot: s.snapshot, memory: s.memory };
    baseline = s.baseline;
  };

  const foldEvent = (
    phase: "snapshot" | "delta",
    event: TerminalEvent,
  ): TerminalState => {
    const before = state;
    // LIVENESS is the arm's job: a delta-phase frame AND a real agent-identity
    // change against the DURABLE baseline (not `cur.snapshot.agent` — that's the
    // adopt foot-gun). `"unknown"` (mid-resolution) is skipped: it neither bumps
    // nor re-seats the baseline, matching the inline R9.0 rule it replaces.
    let live = false;
    if (event.kind === "agent" && event.agent !== "unknown") {
      const next = event.agent.value;
      live = phase === "delta" && agentIdentityChanged(baseline, next);
      // Re-seat only on a real change: a same-identity tick (the ~150 ms firehose)
      // already matches, so re-allocating an identical `{ kind, sessionId }` is waste.
      if (live)
        baseline = next ? { kind: next.kind, sessionId: next.sessionId } : null;
    }
    state = fold(before, event, { live, at: clock() });
    return before;
  };

  return {
    consume: (frame, onEvent) => {
      if (frame.phase === "gap") {
        if (!opts.reseed) {
          throw new Error(
            "consumer arm: a gap frame arrived but no reseed source was configured",
          );
        }
        reseed(opts.reseed());
        return;
      }
      for (const event of frame.events) {
        const before = foldEvent(frame.phase, event);
        onEvent(event, before, state);
      }
    },
    get state() {
      return state;
    },
  };
}
