/**
 * The fold — a reduce over the producer's observation stream. `fold(cur, o, ctx)
 * → cur'` is a reducer; kolu's stored `TerminalState` is a left-fold (scan) over
 * the stream. For the six OBSERVED fields it is plain last-write-wins; the only
 * judgments are the REMEMBERED fields — stamp `lastActivityAt` from a LIVE
 * agent observation (kolu's clock — an identity change always, a same-identity
 * output tick throttled) and stamp `promptedAt` at the current agent's first
 * live state — plus the live agent's allowlisted argv, which it carries so
 * `restoreTargetOf` can build the resume target from OS facts alone. A producer
 * can write none of that: `TerminalSnapshot` has no memory field to carry, so
 * however buggy / restarted / hostile a producer's stream, it cannot overwrite a
 * remembered fact — the fence is the EMIT TYPE. And no PTY BYTE reaches here at
 * all: a shell command mark re-samples the foreground; it carries no command
 * line into the fold.
 *
 * Pure and host-agnostic: kolu's in-process fold (R9.0) and a remote fold (R9.3)
 * are the SAME function. `foldSnapshot` (the snapshot-only half) is shared with
 * the memoryless dashboard consumers, which remember nothing — the one source of
 * truth for "apply an observation to the snapshot state."
 */

import { agentLive } from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  RestoreTarget,
  TerminalEvent,
  TerminalSnapshot,
  TerminalState,
} from "@kolu/terminal-vocab/schema";
import { resumeRefFor } from "kolu-agents/vocab";
import { match, P } from "ts-pattern";

/** How often a same-identity OUTPUT tick may re-stamp recency. The agent-detail
 *  firehose ticks ~1×/s while an agent works; stamping every tick would restore
 *  the per-tick write noise #1626 deliberately removed (and re-arm the authored
 *  publish + session autosave on each). 60s is the compromise: an actively
 *  producing terminal's recency never drifts more than a window stale (the dock's
 *  "Nh ago" chip stays honest), while the write happens at most once a minute per
 *  terminal. An IDENTITY change is NOT throttled — it stamps immediately. The window
 *  is also the coalescing window for the adopt survivor-settle (floored at the sensor
 *  run's start): right after an adopt, same-identity output is held for one window
 *  before it may re-stamp, so the settle burst can't false-bump the saved recency. */
export const RECENCY_THROTTLE_MS = 60_000;

/** The identity the recency baseline tracks — kind + session id. A structural
 *  subset of the persisted `AgentIdentity` (which also carries `resumeRef`):
 *  the baseline only ever answers "did the conversation change?", so it needs
 *  no resume ref. */
export type AgentIdentityRef = { kind: string; sessionId: string };

/** Apply one observation to the OBSERVED half (last-write-wins). Shared by kolu's
 *  full {@link fold} and a memory-less dashboard accumulator, so "apply an
 *  observation to the snapshot state" lives once. The agent's `Known<>` rule
 *  lives here: `"unknown"` (mid-resolution, OR a defined non-shell foreground whose
 *  session is unresolvable — W12's can't-tell-ended-from-lost-observer) returns the
 *  SAME object — kolu KEEPS its last value, no clobber and no spurious autosave;
 *  `{ value }` is authoritative and APPLIES (even an authoritative `null` = session
 *  ended). A PTY command mark emits no event — it is a sensor. */
export function foldSnapshot(
  snapshot: TerminalSnapshot,
  o: TerminalEvent,
): TerminalSnapshot {
  return (
    match(o)
      .with({ kind: "cwd" }, ({ cwd }) => ({ ...snapshot, cwd }))
      .with({ kind: "git" }, ({ git }) => ({ ...snapshot, git }))
      .with({ kind: "pr" }, ({ pr }) => ({ ...snapshot, pr }))
      .with({ kind: "foreground" }, ({ foreground }) => ({
        ...snapshot,
        foreground,
      }))
      // Last-write-wins like the rest: the scan re-samples the WHOLE port set
      // each pass, so a port that died is absent from the next sample rather
      // than needing a removal event. The producer already dropped a sample
      // structurally equal to the one before it (`portsEqual`), so anything that
      // reaches here is a real change.
      .with({ kind: "ports" }, ({ ports }) => ({ ...snapshot, ports }))
      // Same shape and same guarantee as `ports` above: the grid sensor drops a
      // sample equal to the one before it, so anything reaching here is a real
      // resize — which matters because every attach republishes the grid it was
      // served at and almost none of those are a change.
      .with({ kind: "grid" }, ({ grid }) => ({ ...snapshot, grid }))
      // `unknown` returns the SAME reference (no clobber) — callers rely on the
      // identity to detect "nothing changed"; `{ value }` applies authoritatively.
      .with({ kind: "agent", agent: "unknown" }, () => snapshot)
      .with({ kind: "agent", agent: { value: P.any } }, ({ agent }) => ({
        ...snapshot,
        agent: agent.value,
      }))
      .exhaustive()
  );
}

/** Did the agent's conversation IDENTITY (`kind` + `sessionId`) change? The one
 *  product judgment that gates recency — it starts, finishes, or a new session
 *  appears — NOT a `thinking↔awaiting` state flip or token churn. The restore
 *  caveat is gone (deleted, not ported): kolu SEEDS its `current` from its durable
 *  record, so a re-observation of the same session is no identity change at all,
 *  and the frame phase (`ctx.live`) — not a saved-recency heuristic — distinguishes
 *  a re-observation from a real change. This also fixes a latent bug the old caveat
 *  carried: a genuinely-new agent started after a prior one finished is no longer
 *  wrongly suppressed. */
export function agentIdentityChanged(
  prev: AgentIdentityRef | null,
  next: AgentIdentityRef | null,
): boolean {
  return prev?.kind !== next?.kind || prev?.sessionId !== next?.sessionId;
}

/** Seed the producer's transient RECENCY BASELINE — the agent identity the producer
 *  last knew, so {@link agentIdentityChanged} against it says "is this observation
 *  new activity or a re-observation of what we already knew?". On ADOPT / resuming
 *  wake the run re-attaches to a SURVIVOR (an `exact` restore target), so the baseline
 *  is that survivor's identity: its re-observation matches → not live → the saved
 *  recency stands, however MANY same-identity settle emits the producer fires while
 *  it resolves the survivor's detail. A genuinely-NEW agent (the survivor finished
 *  during downtime and the user launched another) differs from the baseline → live →
 *  it bumps. A fresh spawn / bare shell / migrated-legacy target has no survivor, so
 *  the baseline is `null` and the first agent is genuinely new. This is identity-based,
 *  not count-based: it survives the multi-emit adopt settle and never swallows a later
 *  new-agent launch. Transient producer state (never persisted — the fence is the emit
 *  type). The re-seat on a live change is the caller's (padi's `emit`), threading it
 *  like `current`. */
export function seedRecencyBaseline(
  restoreTarget: RestoreTarget | undefined,
): AgentIdentityRef | null {
  // The baseline is the identity WITHOUT its resume ref: it only answers "did
  // the conversation change?", and comparing on `{ kind, sessionId }` (not the
  // full persisted `AgentIdentity`, which also carries `resumeRef`) keeps the
  // survivor's identity stable across a restore that re-derives the ref.
  return restoreTarget?.kind === "exact"
    ? {
        kind: restoreTarget.agent.kind,
        sessionId: restoreTarget.agent.sessionId,
      }
    : null;
}

/** Advance the RECENCY BASELINE for one observation and decide `live` — the frame
 *  phase's per-observation step, seeded by {@link seedRecencyBaseline} and threaded
 *  by the caller like `current`. A non-agent mark or an `unknown` (mid-resolution)
 *  tick touches nothing: `{ live: false, baseline }` — the SAME baseline, so a
 *  mid-resolution `unknown` never disturbs liveness (#1626). An authoritative agent
 *  `{ value }` is judged against the baseline via {@link agentIdentityChanged}; on a
 *  live change the baseline advances to the new identity (a re-observation of what we
 *  already knew is `!live` and leaves it be). Pure — the sole home of the frame
 *  phase's step, exercised by the producer ({@link fold}'s caller, padi's `emit`) and
 *  its conformance test alike, so the unknown guard lives once. */
export function stepRecencyBaseline(
  baseline: AgentIdentityRef | null,
  o: TerminalEvent,
): { live: boolean; baseline: AgentIdentityRef | null } {
  if (o.kind !== "agent" || o.agent === "unknown")
    return { live: false, baseline };
  const next = o.agent.value;
  const live = agentIdentityChanged(baseline, next);
  return {
    live,
    baseline: live
      ? next && { kind: next.kind, sessionId: next.sessionId }
      : baseline,
  };
}

/** kolu's RESTORE TARGET, derived from the folded state — the fold OWNS this
 *  projection rather than the shell assembling it. Every input is a fact kolu
 *  owns through the OS, never a byte off the PTY:
 *   - no live `agent` → `none` (a quit-to-shell drops the live agent, a
 *     never-launched terminal never had one; wake lands on a BARE SHELL, #1492);
 *   - a LIVE `agent` → `exact`, pairing its IDENTITY (the adapter matched a
 *     session file / the foreground process — `kind` + `sessionId` + the
 *     agent's own resume ref) with the live process's `stableFlags`-filtered
 *     argv the producer sampled (`TerminalState.argv`).
 *
 *  There is no command string and no kind-consistency gate any more, because
 *  there is nothing to disagree: identity and argv are read from the same live
 *  agent process, so `{ opencode command, claude identity }` is unspellable.
 *  The old gate policed a stale PTY mark paired against a new agent — a class
 *  that no longer exists now that the mark feeds neither.
 *
 *  The PTY's `OSC 633;E` mark is NOT an input. It is a sensor: it re-samples the
 *  foreground and names a shim for the adapters. A restored command rendered
 *  from it would be attacker-controlled (`cat` a file, `curl` a banner — anyone
 *  whose text the user displays can emit the mark), which is exactly the forgery
 *  this projection exists to make unspellable. */
export function restoreTargetOf(aw: TerminalState): RestoreTarget {
  const agent = aw.snapshot.agent;
  if (agent === null) return { kind: "none" };
  return {
    kind: "exact",
    agent: {
      kind: agent.kind,
      sessionId: agent.sessionId,
      // The agent's OWN resume ref (juspay/kolu#1495): for most agents the
      // session id; for pi the transcript PATH (which opens regardless of where
      // pi's session store has moved). Derived by the agent's own vocab, so this
      // fold knows nothing about which agent spells its ref as a path.
      resumeRef: resumeRefFor(agent),
    },
    // Copied out of the fold state: the persisted value is a plain array, and
    // nothing downstream may mutate the accumulator.
    argv: [...aw.argv],
  };
}

/** Structural equality of two RESTORE TARGETS, BY VALUE. Lets an emit fence gate
 *  on the projection {@link restoreTargetOf} produces rather than re-deriving "did
 *  the target move" from its raw inputs (the agent identity + the live argv):
 *  fold in another input here and every consumer stays correct for free. Switches
 *  on the discriminant — a future arm is a compile error (no path returns) — and is
 *  hand-written rather than `node:util` `isDeepStrictEqual` so the fold stays
 *  browser-safe (it runs in the client bundle). */
export function restoreTargetEqual(
  a: RestoreTarget,
  b: RestoreTarget,
): boolean {
  switch (a.kind) {
    case "none":
      return b.kind === "none";
    case "exact":
      return (
        b.kind === "exact" &&
        a.agent.kind === b.agent.kind &&
        a.agent.sessionId === b.agent.sessionId &&
        a.agent.resumeRef === b.agent.resumeRef &&
        sameArgv(a.argv, b.argv)
      );
  }
}

/** Element-wise argv equality — the flag tokens are the only ordered list in the
 *  restore target, and replaying them in a different order is a different
 *  invocation (`--model x --model y`), so order is part of the value. */
function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Liveness + clock, kolu's own facts passed as VALUES (never a thunk the reducer
 *  may fire): `live` — true iff this is NEW activity (a change vs the producer's
 *  recency baseline), not a re-observation of the survivor kolu already knew; `at` —
 *  kolu samples its OWN clock ONCE at intake, so a remote producer's wall clock is
 *  never imported as ordering truth; `runStartedAt` — kolu's clock at THIS sensor
 *  run's start (the adopt/spawn moment). It floors the throttle clock so the adopt
 *  SETTLE — a burst of same-identity emits clustered at run start while the producer
 *  resolves the survivor's detail — coalesces against `runStartedAt` rather than
 *  false-bumping against a week-old saved stamp. All three are same-host (`Date.now`
 *  on the owning padi), so the `at - max(prior, runStartedAt)` delta is well-ordered. */
export type FoldCtx = { live: boolean; at: number; runStartedAt: number };

/** Fold one framed observation into a NEW `TerminalState` — nothing is mutated.
 *  Six snapshot fields: last-write-wins (via {@link foldSnapshot}). Three memory
 *  facts: `lastActivityAt` stamped from a LIVE agent observation — an IDENTITY
 *  change (kolu's clock) or, on a stable identity, an OUTPUT tick throttled to
 *  {@link RECENCY_THROTTLE_MS}; `promptedAt` stamped once per agent identity, at
 *  its first live state ({@link nextPromptedAt}); and the live agent's
 *  allowlisted `argv`, carried for `restoreTargetOf` (cleared when the session
 *  ends). */
export function fold(
  cur: TerminalState,
  o: TerminalEvent,
  ctx: FoldCtx,
): TerminalState {
  const snapshot = foldSnapshot(cur.snapshot, o);
  if (o.kind !== "agent" || o.agent === "unknown") {
    // Observed-only change (or `unknown`, which `foldSnapshot` returned as-is →
    // snapshot === cur.snapshot → cur). Memory is untouched.
    return snapshot === cur.snapshot ? cur : { ...cur, snapshot };
  }
  // An authoritative agent `{ value }` (incl. a shell-idle null = session ended).
  // A NEW agent identity: NEW activity (`ctx.live`) whose identity differs from
  // what the fold last held — a session starts / finishes / a new one appears. A
  // re-observation of the survivor kolu already knew is `!ctx.live`.
  // The `agentIdentityChanged(cur.snapshot.agent, …)` conjunct is NOT belt-and-
  // suspenders with `ctx.live`: it is the fold's OWN identity fence. `ctx.live` is
  // the caller's frame-phase judgment (against a baseline the fold doesn't hold);
  // this fold acts only on a change it can see against its OWN persisted
  // `snapshot.agent`, so it never trusts the caller's `ctx.live` blindly. Requiring
  // BOTH is this file's producer-fence thesis applied to itself — a self-contained
  // contract for any present-or-future caller, not a redundant AND to simplify away.
  const newIdentity =
    ctx.live && agentIdentityChanged(cur.snapshot.agent, o.agent.value);
  // FIRST LIVE TURN first (it rides every arm below), then RECENCY.
  const next: TerminalState = {
    ...cur,
    snapshot,
    // The flags the wake may replay. A null agent (session ended) clears them;
    // otherwise take the sample the producer read off the same live process.
    // Reuse the current array when it is unchanged so an identity-stable detail
    // tick allocates nothing.
    argv:
      o.agent.value === null
        ? []
        : sameArgv(cur.argv, o.argv)
          ? cur.argv
          : o.argv,
    memory: {
      ...cur.memory,
      promptedAt: nextPromptedAt(cur, o.agent.value, newIdentity, ctx.at),
    },
  };
  // RECENCY, two arms that COMPOSE, kolu's clock stamps both — one stamp shape:
  const stamped = (): TerminalState => ({
    ...next,
    memory: { ...next.memory, lastActivityAt: ctx.at },
  });
  //  - IDENTITY-change arm (#1626, unthrottled): a new agent identity.
  if (newIdentity) return stamped();
  //  - THROTTLED-output arm (the freeze fix): a same-identity DETAIL tick is the
  //    agent producing OUTPUT. Stamp it too, but only once per RECENCY_THROTTLE_MS so
  //    the ~1s firehose doesn't recreate the per-tick write noise #1626 removed. The
  //    throttle clock is `max(prior, runStartedAt)`, NOT `prior` alone: right after an
  //    adopt `prior` is the (possibly week-old) SAVED stamp, and the survivor-settle
  //    burst would each read "overdue" against it and false-bump to now — flooring at
  //    `runStartedAt` coalesces that burst (it is clustered at run start) while a
  //    long-running session still throttles against its own last stamp.
  const prior = cur.memory.lastActivityAt ?? 0;
  const since = Math.max(prior, ctx.runStartedAt);
  return ctx.at - since >= RECENCY_THROTTLE_MS ? stamped() : next;
}

/** `promptedAt` after one authoritative agent observation — "has the CURRENT
 *  agent had a live turn yet?" (see `AgentMemorySchema`). Three cases:
 *   - no agent → `null` (nothing to have been prompted);
 *   - a NEW agent identity (`newIdentity`, the fence the recency arm uses too)
 *     → starts over: stamped only if it is already live, so a fresh agent
 *     detected at its first prompt (`waiting`) stays `null`;
 *   - the same agent → keeps its stamp, or takes one on its first live state.
 *  The identity fence matters on ADOPT: the seeded snapshot has no agent, so the
 *  survivor's re-observation is an identity change the baseline says is NOT live
 *  — it must keep the saved stamp, not reset it. */
function nextPromptedAt(
  cur: TerminalState,
  agent: AgentInfo | null,
  newIdentity: boolean,
  at: number,
): number | null {
  if (agent === null) return null;
  const firstLive = agentLive(agent.state) ? at : null;
  if (newIdentity) return firstLive;
  return cur.memory.promptedAt ?? firstLive;
}
