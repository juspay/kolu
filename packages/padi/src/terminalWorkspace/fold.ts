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
} from "@kolu/terminal-vocab/schema";

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

/** Apply one observation to the OBSERVED half (last-write-wins). Shared by kolu's
 *  full {@link fold} and a memory-less dashboard accumulator (pulam), so "apply an
 *  observation to the snapshot state" lives once. The agent's `Known<>` rule
 *  lives here: `"unknown"` (mid-resolution, OR a defined non-shell foreground whose
 *  session is unresolvable — W12's can't-tell-ended-from-lost-observer) returns the
 *  SAME object — kolu KEEPS its last value, no clobber and no spurious autosave;
 *  `{ value }` is authoritative and APPLIES (even an authoritative `null` = session
 *  ended). A `commandRun` is a memory mark — the snapshot half is unchanged. */
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
): AgentIdentity | null {
  return restoreTarget?.kind === "exact" ? restoreTarget.agent : null;
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
  baseline: AgentIdentity | null,
  o: TerminalEvent,
): { live: boolean; baseline: AgentIdentity | null } {
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
  // RECENCY, two arms that COMPOSE, kolu's clock stamps both — one stamp shape:
  const next: TerminalState = { ...cur, snapshot };
  const stamped = (): TerminalState => ({
    ...next,
    memory: { ...next.memory, lastActivityAt: ctx.at },
  });
  //  - IDENTITY-change arm (#1626, unthrottled): NEW activity (`ctx.live`) whose
  //    identity differs from what the fold last held — a session starts / finishes /
  //    a new one appears. A re-observation of the survivor kolu already knew is
  //    `!ctx.live`, so it never takes this arm.
  //    The `agentIdentityChanged(cur.snapshot.agent, …)` conjunct is NOT belt-and-
  //    suspenders with `ctx.live`: it is the fold's OWN identity fence. `ctx.live` is
  //    the caller's frame-phase judgment (against a baseline the fold doesn't hold);
  //    this fold bumps only on a change it can see against its OWN persisted
  //    `snapshot.agent`, so it never trusts the caller's `ctx.live` blindly. Requiring
  //    BOTH is this file's producer-fence thesis applied to itself — a self-contained
  //    contract for any present-or-future caller, not a redundant AND to simplify away.
  if (ctx.live && agentIdentityChanged(cur.snapshot.agent, o.agent.value))
    return stamped();
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
