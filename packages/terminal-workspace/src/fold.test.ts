import { describe, expect, it } from "vitest";
import {
  agentIdentityChanged,
  fold,
  type FoldCtx,
  foldObserved,
} from "./fold.ts";
import {
  type AgentInfo,
  type AwarenessObservation,
  type KoluAwareness,
  seedMemory,
  seedObservation,
} from "./schema.ts";

function claude(sessionId: string, state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

const seed = (): KoluAwareness => ({
  observed: seedObservation("/work/repo"),
  memory: seedMemory(),
});

const delta = (at: number): FoldCtx => ({ live: true, at });
const snapshot = (at: number): FoldCtx => ({ live: false, at });

const agentObs = (agent: AgentInfo | null): AwarenessObservation => ({
  kind: "agent",
  agent: { value: agent },
});

describe("foldObserved — last-write-wins over the five observed fields", () => {
  it("applies cwd/git/pr/foreground edges", () => {
    let o = seedObservation("/a");
    o = foldObserved(o, { kind: "cwd", cwd: "/b" });
    expect(o.cwd).toBe("/b");
    o = foldObserved(o, { kind: "pr", pr: { kind: "absent" } });
    expect(o.pr).toEqual({ kind: "absent" });
    o = foldObserved(o, {
      kind: "foreground",
      foreground: { name: "vim", title: null },
    });
    expect(o.foreground).toEqual({ name: "vim", title: null });
  });

  it("KEEPS the prior agent on `unknown` (same reference — no clobber)", () => {
    const o = { ...seedObservation("/a"), agent: claude("A", "thinking") };
    const next = foldObserved(o, { kind: "agent", agent: "unknown" });
    expect(next).toBe(o); // identical reference → kolu detects "nothing changed"
  });

  it("APPLIES an authoritative `{ value }` agent, including a null (session ended)", () => {
    const o = { ...seedObservation("/a"), agent: claude("A", "thinking") };
    const next = foldObserved(o, { kind: "agent", agent: { value: null } });
    expect(next.agent).toBeNull();
  });

  it("a commandRun leaves the observed half untouched (it is a memory mark)", () => {
    const o = seedObservation("/a");
    expect(
      foldObserved(o, {
        kind: "commandRun",
        command: "claude",
        replayed: false,
      }),
    ).toBe(o);
  });
});

describe("agentIdentityChanged — identity-only (kind + sessionId)", () => {
  it("false on a same-identity state/summary tick (the ~150ms firehose)", () => {
    expect(
      agentIdentityChanged(claude("A", "thinking"), claude("A", "waiting")),
    ).toBe(false);
  });
  it("true on a new session, a finish, and a start", () => {
    expect(
      agentIdentityChanged(claude("A", "thinking"), claude("B", "thinking")),
    ).toBe(true);
    expect(agentIdentityChanged(claude("A", "waiting"), null)).toBe(true);
    expect(agentIdentityChanged(null, claude("A", "thinking"))).toBe(true);
  });
});

describe("fold — recency bumps only on a LIVE agent-identity change", () => {
  it("bumps on a genuinely-new agent in a DELTA frame", () => {
    const next = fold(seed(), agentObs(claude("A", "thinking")), delta(1000));
    expect(next.observed.agent?.sessionId).toBe("A");
    expect(next.memory.lastActivityAt).toBe(1000);
  });

  it("does NOT bump the same null→detected re-observation in a SNAPSHOT frame", () => {
    // The adopt / reconnect case: kolu re-observes a survivor; the frame phase —
    // not a saved-recency heuristic — says this is not new activity.
    const next = fold(
      seed(),
      agentObs(claude("A", "thinking")),
      snapshot(1000),
    );
    expect(next.observed.agent?.sessionId).toBe("A");
    expect(next.memory.lastActivityAt).toBe(0); // untouched
  });

  it("does NOT bump on a same-identity state tick (firehose) — keeps prior recency", () => {
    const cur: KoluAwareness = {
      observed: { ...seedObservation("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 500 },
    };
    const next = fold(cur, agentObs(claude("A", "waiting")), delta(9999));
    expect(next.observed.agent?.state).toBe("waiting");
    expect(next.memory.lastActivityAt).toBe(500); // unchanged
  });

  it("bumps when a finished agent is followed by a genuinely-new one (the old-caveat bug)", () => {
    let cur: KoluAwareness = {
      observed: { ...seedObservation("/a"), agent: claude("A", "waiting") },
      memory: { lastActivityAt: 500 },
    };
    cur = fold(cur, agentObs(null), delta(600)); // A finishes
    expect(cur.memory.lastActivityAt).toBe(600);
    cur = fold(cur, agentObs(claude("B", "thinking")), delta(700)); // B starts
    expect(cur.memory.lastActivityAt).toBe(700); // NOT suppressed
  });

  it("KEEPS kolu's value (and recency) on an `unknown` agent — mid-resolution never clobbers", () => {
    const cur: KoluAwareness = {
      observed: { ...seedObservation("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 500 },
    };
    const next = fold(cur, { kind: "agent", agent: "unknown" }, delta(9999));
    expect(next).toBe(cur); // no-op
  });
});

describe("fold — lastAgentCommand from commandRun (dedup; a non-agent ls never reaches here)", () => {
  it("remembers a new agent command", () => {
    const next = fold(
      seed(),
      { kind: "commandRun", command: "claude --model sonnet", replayed: false },
      delta(1),
    );
    expect(next.memory.lastAgentCommand).toBe("claude --model sonnet");
  });

  it("dedups a repeated / replayed command to a no-op", () => {
    const cur: KoluAwareness = {
      observed: seedObservation("/a"),
      memory: { lastActivityAt: 0, lastAgentCommand: "claude --model sonnet" },
    };
    const next = fold(
      cur,
      { kind: "commandRun", command: "claude --model sonnet", replayed: true },
      delta(1),
    );
    expect(next).toBe(cur);
  });
});
