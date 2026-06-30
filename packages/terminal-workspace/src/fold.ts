/**
 * The fold — a reduce over the producer's observation stream. `fold(cur, o, ctx)
 * → cur'` is a reducer; kolu's stored `KoluAwareness` is a left-fold (scan) over
 * the stream. For the five OBSERVED fields it is plain last-write-wins; the only
 * judgments are the two REMEMBERED fields — stamp `lastActivityAt` on a LIVE
 * agent-identity change (kolu's clock) and keep `lastAgentCommand` from the latest
 * recognized `commandRun`. A producer can write none of that: `Observation` has no
 * memory field to carry, so however buggy / restarted / hostile a producer's
 * stream, it cannot overwrite a remembered fact — the fence is the EMIT TYPE.
 *
 * Pure and host-agnostic: kolu's in-process fold (R9.0) and a remote fold (R9.3)
 * are the SAME function. `foldObserved` (the observed-only half) is shared with
 * the dashboard producers (pulam), which remember nothing — the one source of
 * truth for "apply an observation to the observed state."
 */

import type {
  AgentInfo,
  AwarenessObservation,
  KoluAwareness,
  Observation,
} from "./schema.ts";

/** Apply one observation to the OBSERVED half (last-write-wins). Shared by kolu's
 *  full {@link fold} and a memory-less dashboard accumulator (pulam), so "apply an
 *  observation to the observed state" lives once. The agent's `Observed<>` rule
 *  lives here: `"unknown"` (mid-resolution) returns the SAME object — kolu KEEPS
 *  its last value, no clobber and no spurious autosave; `{ value }` is
 *  authoritative and APPLIES (even an authoritative `null` = session ended). A
 *  `commandRun` is a memory mark — the observed half is unchanged. */
export function foldObserved(
  observed: Observation,
  o: AwarenessObservation,
): Observation {
  switch (o.kind) {
    case "cwd":
      return { ...observed, cwd: o.cwd };
    case "git":
      return { ...observed, git: o.git };
    case "pr":
      return { ...observed, pr: o.pr };
    case "foreground":
      return { ...observed, foreground: o.foreground };
    case "agent":
      // `unknown` returns the SAME reference (no clobber) — callers rely on the
      // identity to detect "nothing changed"; `{ value }` applies authoritatively.
      return o.agent === "unknown"
        ? observed
        : { ...observed, agent: o.agent.value };
    case "commandRun":
      return observed;
  }
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
  prev: AgentInfo | null,
  next: AgentInfo | null,
): boolean {
  return prev?.kind !== next?.kind || prev?.sessionId !== next?.sessionId;
}

/** Liveness + clock, kolu's own facts passed as VALUES (never a thunk the reducer
 *  may fire): `live` — true iff this came in a DELTA frame (a snapshot
 *  re-observation is not "new activity", so it never bumps recency); `at` — kolu
 *  samples its OWN clock ONCE at intake, so a remote producer's wall clock is never
 *  imported as ordering truth. */
export type FoldCtx = { live: boolean; at: number };

/** Fold one framed observation into a NEW `KoluAwareness` — nothing is mutated.
 *  Five observed fields: last-write-wins (via {@link foldObserved}). Two memory
 *  fields: `lastActivityAt` stamped on a LIVE agent-identity change (kolu's clock);
 *  `lastAgentCommand` kept from the latest `commandRun` (the producer emits it ONLY
 *  for a recognized, normalized agent command, so a non-agent `ls` never reaches
 *  here — a replay is deduped to a no-op). */
export function fold(
  cur: KoluAwareness,
  o: AwarenessObservation,
  ctx: FoldCtx,
): KoluAwareness {
  if (o.kind === "commandRun") {
    return cur.memory.lastAgentCommand === o.command
      ? cur // dedup: a replayed (or repeated) mark is a no-op
      : { ...cur, memory: { ...cur.memory, lastAgentCommand: o.command } };
  }
  const observed = foldObserved(cur.observed, o);
  if (o.kind !== "agent" || o.agent === "unknown") {
    // Observed-only change (or `unknown`, which `foldObserved` returned as-is →
    // observed === cur.observed → cur). Memory is untouched.
    return observed === cur.observed ? cur : { ...cur, observed };
  }
  // An authoritative agent `{ value }` (incl. a shell-idle null = session ended).
  // RECENCY (identity-only): bump iff a LIVE agent-identity change. `ctx.live` (the
  // frame phase), not a producer flag, says "live"; kolu's clock stamps it.
  const next: KoluAwareness = { ...cur, observed };
  return ctx.live && agentIdentityChanged(cur.observed.agent, o.agent.value)
    ? { ...next, memory: { ...next.memory, lastActivityAt: ctx.at } }
    : next;
}
