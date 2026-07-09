/**
 * The fold — a reduce over the producer's observation stream. `fold(cur, o, ctx)
 * → cur'` is a reducer; kolu's stored `TerminalState` is a left-fold (scan) over
 * the stream. For the five OBSERVED fields it is plain last-write-wins; the only
 * judgments are the two REMEMBERED fields — stamp `lastActivityAt` from a LIVE
 * agent observation (kolu's clock — an identity change always, a same-identity
 * output tick throttled) and keep `lastAgentCommand` from the latest
 * recognized `commandRun`. A producer can write none of that: `TerminalSnapshot` has no
 * memory field to carry, so however buggy / restarted / hostile a producer's
 * stream, it cannot overwrite a remembered fact — the fence is the EMIT TYPE.
 *
 * Pure and host-agnostic: kolu's in-process fold (R9.0) and a remote fold (R9.3)
 * are the SAME function. `foldSnapshot` (the snapshot-only half) is shared with
 * the dashboard producers (pulam), which remember nothing — the one source of
 * truth for "apply an observation to the snapshot state."
 */

import { exactRestoreTarget } from "anyagent/cli";
import { match, P } from "ts-pattern";
import type {
  AgentIdentity,
  TerminalEvent,
  TerminalState,
  TerminalSnapshot,
  RestoreTarget,
} from "./schema.ts";

/** How often a same-identity OUTPUT tick may re-stamp recency. The agent-detail
 *  firehose ticks ~1×/s while an agent works; stamping every tick would restore
 *  the per-tick write noise #1626 deliberately removed (and re-arm the authored
 *  publish + session autosave on each). 60s is the compromise: an actively
 *  producing terminal's recency never drifts more than a window stale (the dock's
 *  "Nh ago" chip stays honest), while the write happens at most once a minute per
 *  terminal. An IDENTITY change is NOT throttled — it stamps immediately. */
export const RECENCY_THROTTLE_MS = 60_000;

/** Apply one observation to the OBSERVED half (last-write-wins). Shared by kolu's
 *  full {@link fold} and a memory-less dashboard accumulator (pulam), so "apply an
 *  observation to the snapshot state" lives once. The agent's `Known<>` rule
 *  lives here: `"unknown"` (mid-resolution) returns the SAME object — kolu KEEPS
 *  its last value, no clobber and no spurious autosave; `{ value }` is
 *  authoritative and APPLIES (even an authoritative `null` = session ended). A
 *  `commandRun` is a memory mark — the snapshot half is unchanged. */
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
      // `unknown` returns the SAME reference (no clobber) — callers rely on the
      // identity to detect "nothing changed"; `{ value }` applies authoritatively.
      .with({ kind: "agent", agent: "unknown" }, () => snapshot)
      .with({ kind: "agent", agent: { value: P.any } }, ({ agent }) => ({
        ...snapshot,
        agent: agent.value,
      }))
      // A `commandRun` is a memory mark — the snapshot half is unchanged.
      .with({ kind: "commandRun" }, () => snapshot)
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
  prev: AgentIdentity | null,
  next: AgentIdentity | null,
): boolean {
  return prev?.kind !== next?.kind || prev?.sessionId !== next?.sessionId;
}

/** The producer's transient RECENCY GATE — the one bit of state deciding whether a
 *  just-started sensor run's FIRST agent observation is live. On ADOPT (kolu
 *  re-attaches to a survivor whose agent state evolved during downtime at an
 *  unknown past time) that first observation REPORTS pre-existing state, not
 *  activity happening now — so it must not move recency; the saved `lastActivityAt`
 *  is the truth. Only the deltas AFTER it are live. A FRESH spawn has no downtime,
 *  so its first agent observation is already live. Opening the gate after the adopt
 *  re-observation is what lets a stable-session terminal's recency advance at all —
 *  the fold's throttled output bump then takes over. Transient: never persisted (a
 *  memory field would let the producer overwrite a remembered fact; the fence is
 *  the emit type). Extracted from padi's `emit` so the adopt-vs-fresh recency pins
 *  live at the pure, testable layer beside `fold`. */
export type RecencyGate = { readonly awaitingAdoptReObservation: boolean };

/** Seed the gate from the run's restore target: CLOSED (the next agent observation
 *  is the adopt re-observation, held back) iff this run adopted a live agent — an
 *  `exact` target. A fresh spawn / bare shell / migrated-legacy target has no
 *  survivor to re-observe, so the gate starts OPEN (already live). */
export function seedRecencyGate(
  restoreTarget: RestoreTarget | undefined,
): RecencyGate {
  return { awaitingAdoptReObservation: restoreTarget?.kind === "exact" };
}

/** Step the gate on ONE authoritative agent observation. While closed, this
 *  observation is the adopt re-observation → `live: false`, and the gate OPENS so
 *  every later observation is a live delta. While open, every observation is live.
 *  Only the FIRST observation is ever held. */
export function stepRecencyGate(gate: RecencyGate): {
  live: boolean;
  gate: RecencyGate;
} {
  return gate.awaitingAdoptReObservation
    ? { live: false, gate: { awaitingAdoptReObservation: false } }
    : { live: true, gate };
}

/** kolu's RESTORE TARGET, derived from the folded state — the fold OWNS this
 *  projection rather than the shell assembling it. The discriminant is decided by
 *  the agent the fold just observed paired with the remembered launch line:
 *   - a LIVE `agent` + a remembered `lastAgentCommand` THAT INVOKES THE SAME AGENT
 *     KIND → `exact` (wake resumes THAT conversation by id, #1495);
 *   - otherwise → `none` (a quit-to-shell drops the live agent, a never-launched
 *     terminal never had one, OR the remembered command and the live agent disagree
 *     on kind — either way wake lands on a BARE SHELL, #1492, never the wrong agent).
 *  The kind-consistency gate lives in `exactRestoreTarget`: a stale-command/new-agent
 *  race (the producer observes a new agent before the replayed command mark updates
 *  memory) could otherwise pair, say, an `opencode` command with a `claude-code`
 *  identity, which `resumeAgentCommand` would silently downgrade to opencode's
 *  most-recent — the wrong-agent resume #2 makes unspellable. Refused here instead.
 *  Absence is decided HERE as `none`; never read downstream as "resume most-recent".
 *  The live fold never produces `legacyMostRecent` — that arm exists only for migrated
 *  pre-1.29 records (`backfillSnapshotCutover`). */
export function restoreTargetOf(aw: TerminalState): RestoreTarget {
  const command = aw.memory.lastAgentCommand;
  const agent = aw.snapshot.agent;
  if (command === undefined || agent === null) return { kind: "none" };
  return (
    exactRestoreTarget(command, {
      kind: agent.kind,
      sessionId: agent.sessionId,
    }) ?? { kind: "none" }
  );
}

/** Structural equality of two RESTORE TARGETS, BY VALUE. Lets an emit fence gate
 *  on the projection {@link restoreTargetOf} produces rather than re-deriving "did
 *  the target move" from its raw inputs (the agent identity + `lastAgentCommand`):
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
    case "legacyMostRecent":
      return b.kind === "legacyMostRecent" && a.command === b.command;
    case "exact":
      return (
        b.kind === "exact" &&
        a.command === b.command &&
        a.agent.kind === b.agent.kind &&
        a.agent.sessionId === b.agent.sessionId
      );
  }
}

/** Liveness + clock, kolu's own facts passed as VALUES (never a thunk the reducer
 *  may fire): `live` — true iff this came in a DELTA frame (a snapshot
 *  re-observation is not "new activity", so it never bumps recency); `at` — kolu
 *  samples its OWN clock ONCE at intake, so a remote producer's wall clock is never
 *  imported as ordering truth. */
export type FoldCtx = { live: boolean; at: number };

/** Fold one framed observation into a NEW `TerminalState` — nothing is mutated.
 *  Five snapshot fields: last-write-wins (via {@link foldSnapshot}). Two memory
 *  fields: `lastActivityAt` stamped from a LIVE agent observation — an IDENTITY
 *  change (kolu's clock) or, on a stable identity, an OUTPUT tick throttled to
 *  {@link RECENCY_THROTTLE_MS}; `lastAgentCommand` kept from the latest `commandRun`
 *  (the producer emits it ONLY for a recognized, normalized agent command, so a
 *  non-agent `ls` never reaches here — a replay is deduped to a no-op). */
export function fold(
  cur: TerminalState,
  o: TerminalEvent,
  ctx: FoldCtx,
): TerminalState {
  if (o.kind === "commandRun") {
    return cur.memory.lastAgentCommand === o.command
      ? cur // dedup: a replayed (or repeated) mark is a no-op
      : { ...cur, memory: { ...cur.memory, lastAgentCommand: o.command } };
  }
  const snapshot = foldSnapshot(cur.snapshot, o);
  if (o.kind !== "agent" || o.agent === "unknown") {
    // Observed-only change (or `unknown`, which `foldSnapshot` returned as-is →
    // snapshot === cur.snapshot → cur). Memory is untouched.
    return snapshot === cur.snapshot ? cur : { ...cur, snapshot };
  }
  // An authoritative agent `{ value }` (incl. a shell-idle null = session ended).
  // A re-observation replay (`!ctx.live` — the frame phase, not a producer flag) is
  // never activity, so it never moves recency.
  const next: TerminalState = { ...cur, snapshot };
  if (!ctx.live) return next;
  // RECENCY, two arms that COMPOSE, kolu's clock stamps both:
  //  - an IDENTITY change (a session starts / finishes / a new one appears) is a
  //    discrete event — stamp it always (#1626);
  //  - OTHERWISE a same-identity DETAIL tick is the agent producing OUTPUT — stamp
  //    it too, but THROTTLED so the ~1s firehose doesn't recreate the per-tick write
  //    noise #1626 removed. `lastActivityAt` IS the throttle clock (no separate
  //    timer/state): a null (never active) or a stamp older than the window is due.
  const prior = cur.memory.lastActivityAt;
  const due =
    agentIdentityChanged(cur.snapshot.agent, o.agent.value) ||
    prior === null ||
    ctx.at - prior >= RECENCY_THROTTLE_MS;
  return due
    ? { ...next, memory: { ...next.memory, lastActivityAt: ctx.at } }
    : next;
}
