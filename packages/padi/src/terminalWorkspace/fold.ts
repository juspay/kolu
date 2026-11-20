import { agentLive } from "@kolu/terminal-vocab/agentProjection";
import type {
  AgentInfo,
  AgentObservation,
  RestoreTarget,
  TerminalEvent,
  TerminalSnapshot,
  TerminalState,
} from "@kolu/terminal-vocab/schema";
import { isAgentPresence, resumeRefFor } from "kolu-agents/vocab";
import { match, P } from "ts-pattern";

export const RECENCY_WRITE_WINDOW_MS = 60_000;

export type AgentIdentityRef = { kind: string; sessionId: string | null };

function identityRef(info: {
  kind: string;
  sessionId: string | null;
}): AgentIdentityRef {
  return { kind: info.kind, sessionId: info.sessionId };
}

/** Apply one observation to the OBSERVED half (last-write-wins). An agent
 *  `"unknown"` returns the SAME object (callers detect "nothing changed" by
 *  reference); `{ value }` applies authoritatively. */
export function foldSnapshot(
  snapshot: TerminalSnapshot,
  o: TerminalEvent,
): TerminalSnapshot {
  return match(o)
    .with({ kind: "cwd" }, ({ cwd }) => ({ ...snapshot, cwd }))
    .with({ kind: "git" }, ({ git }) => ({ ...snapshot, git }))
    .with({ kind: "pr" }, ({ pr }) => ({ ...snapshot, pr }))
    .with({ kind: "foreground" }, ({ foreground }) => ({
      ...snapshot,
      foreground,
    }))
    .with({ kind: "ports" }, ({ ports }) => ({ ...snapshot, ports }))
    .with({ kind: "grid" }, ({ grid }) => ({ ...snapshot, grid }))
    .with({ kind: "agent", agent: "unknown" }, () => snapshot)
    .with({ kind: "agent", agent: { value: P.any } }, ({ agent }) => ({
      ...snapshot,
      agent: agent.value === null ? null : agent.value.info,
    }))
    .exhaustive();
}

export function agentIdentityChanged(
  prev: AgentIdentityRef | null,
  next: AgentIdentityRef | null,
): boolean {
  return prev?.kind !== next?.kind || prev?.sessionId !== next?.sessionId;
}

export function seedRecencyBaseline(
  restoreTarget: RestoreTarget | undefined,
): AgentIdentityRef | null {
  return restoreTarget?.kind === "exact"
    ? identityRef(restoreTarget.agent)
    : null;
}

export function stepRecencyBaseline(
  baseline: AgentIdentityRef | null,
  o: TerminalEvent,
): { live: boolean; baseline: AgentIdentityRef | null } {
  if (o.kind !== "agent" || o.agent === "unknown")
    return { live: false, baseline };
  const next = o.agent.value?.info ?? null;
  const live = agentIdentityChanged(baseline, next);
  return {
    live,
    baseline: live ? next && identityRef(next) : baseline,
  };
}

export function restoreTargetFor(
  observation: AgentObservation | null,
): RestoreTarget {
  if (observation === null) return { kind: "none" };
  const { info } = observation;
  if (isAgentPresence(info)) return { kind: "none" };
  return {
    kind: "exact",
    agent: {
      kind: info.kind,
      sessionId: info.sessionId,
      resumeRef: resumeRefFor(info),
    },
    argv: [...observation.argv],
  };
}

/** Structural equality of two RESTORE TARGETS, BY VALUE. Hand-written rather
 *  than `node:util`'s `isDeepStrictEqual` so the fold stays browser-safe (it
 *  runs in the client bundle). */
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

export function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type FoldCtx = { live: boolean; at: number; runStartedAt: number };

/** Fold one framed observation into a NEW `TerminalState` — nothing is mutated. */
export function fold(
  cur: TerminalState,
  o: TerminalEvent,
  ctx: FoldCtx,
): TerminalState {
  const snapshot = foldSnapshot(cur.snapshot, o);
  if (o.kind !== "agent" || o.agent === "unknown") {
    return snapshot === cur.snapshot ? cur : { ...cur, snapshot };
  }
  const observation = o.agent.value;
  const info = observation === null ? null : observation.info;
  const newIdentity =
    ctx.live && agentIdentityChanged(cur.snapshot.agent, info);
  const next: TerminalState = {
    ...cur,
    snapshot,
    restoreTarget: restoreTargetFor(observation),
    memory: {
      ...cur.memory,
      promptedAt: nextPromptedAt(cur, info, newIdentity, ctx.at),
    },
  };
  const stampAt = recencyStampAt(cur, ctx, newIdentity);
  return stampAt === null
    ? next
    : { ...next, memory: { ...next.memory, lastActivityAt: stampAt } };
}

function recencyStampAt(
  cur: TerminalState,
  ctx: FoldCtx,
  newIdentity: boolean,
): number | null {
  if (newIdentity) return ctx.at;
  const since = Math.max(cur.memory.lastActivityAt ?? 0, ctx.runStartedAt);
  return ctx.at - since >= RECENCY_WRITE_WINDOW_MS ? ctx.at : null;
}

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
