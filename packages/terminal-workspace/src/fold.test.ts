import { describe, expect, it } from "vitest";
import {
  agentIdentityChanged,
  fold,
  type FoldCtx,
  foldSnapshot,
  restoreTargetOf,
} from "./fold.ts";
import {
  type AgentInfo,
  type TerminalEvent,
  type TerminalState,
  seedMemory,
  seedSnapshot,
} from "./schema.ts";

const gitInfo = (branch: string) => ({
  repoRoot: "/r",
  repoName: "r",
  worktreePath: "/r",
  branch,
  isWorktree: false,
  mainRepoRoot: "/r",
  remoteUrl: null,
});

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

const seed = (): TerminalState => ({
  snapshot: seedSnapshot("/work/repo"),
  memory: seedMemory(),
});

const delta = (at: number): FoldCtx => ({ live: true, at });
const snapshot = (at: number): FoldCtx => ({ live: false, at });

const agentObs = (agent: AgentInfo | null): TerminalEvent => ({
  kind: "agent",
  agent: { value: agent },
});

describe("foldSnapshot — last-write-wins over the five snapshot fields", () => {
  it("applies cwd/git/pr/foreground edges", () => {
    let o = seedSnapshot("/a");
    o = foldSnapshot(o, { kind: "cwd", cwd: "/b" });
    expect(o.cwd).toBe("/b");
    o = foldSnapshot(o, { kind: "pr", pr: { kind: "absent" } });
    expect(o.pr).toEqual({ kind: "absent" });
    o = foldSnapshot(o, {
      kind: "foreground",
      foreground: { name: "vim", title: null },
    });
    expect(o.foreground).toEqual({ name: "vim", title: null });
  });

  it("KEEPS the prior agent on `unknown` (same reference — no clobber)", () => {
    const o = { ...seedSnapshot("/a"), agent: claude("A", "thinking") };
    const next = foldSnapshot(o, { kind: "agent", agent: "unknown" });
    expect(next).toBe(o); // identical reference → kolu detects "nothing changed"
  });

  it("APPLIES an authoritative `{ value }` agent, including a null (session ended)", () => {
    const o = { ...seedSnapshot("/a"), agent: claude("A", "thinking") };
    const next = foldSnapshot(o, { kind: "agent", agent: { value: null } });
    expect(next.agent).toBeNull();
  });

  it("a commandRun leaves the snapshot half untouched (it is a memory mark)", () => {
    const o = seedSnapshot("/a");
    expect(
      foldSnapshot(o, {
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
    expect(next.snapshot.agent?.sessionId).toBe("A");
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
    expect(next.snapshot.agent?.sessionId).toBe("A");
    expect(next.memory.lastActivityAt).toBe(0); // untouched
  });

  it("does NOT bump on a same-identity state tick (firehose) — keeps prior recency", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 500 },
    };
    const next = fold(cur, agentObs(claude("A", "waiting")), delta(9999));
    expect(next.snapshot.agent?.state).toBe("waiting");
    expect(next.memory.lastActivityAt).toBe(500); // unchanged
  });

  it("bumps when a finished agent is followed by a genuinely-new one (the old-caveat bug)", () => {
    let cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "waiting") },
      memory: { lastActivityAt: 500 },
    };
    cur = fold(cur, agentObs(null), delta(600)); // A finishes
    expect(cur.memory.lastActivityAt).toBe(600);
    cur = fold(cur, agentObs(claude("B", "thinking")), delta(700)); // B starts
    expect(cur.memory.lastActivityAt).toBe(700); // NOT suppressed
  });

  it("KEEPS kolu's value (and recency) on an `unknown` agent — mid-resolution never clobbers", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
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
    const cur: TerminalState = {
      snapshot: seedSnapshot("/a"),
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

describe("restoreTargetOf — the fold owns the discriminated resume target", () => {
  it("a LIVE agent + a remembered command → an `exact` target (resume by id)", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 1, lastAgentCommand: "claude --model sonnet" },
    };
    expect(restoreTargetOf(cur)).toEqual({
      kind: "exact",
      command: "claude --model sonnet",
      agent: { kind: "claude-code", sessionId: "A" },
    });
  });

  it("a quit-to-shell (agent null) with a sticky command → `none` (bare shell, never most-recent)", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: null },
      memory: { lastActivityAt: 1, lastAgentCommand: "claude --model sonnet" },
    };
    expect(restoreTargetOf(cur)).toEqual({ kind: "none" });
  });

  it("a never-launched terminal (no command) → `none`", () => {
    expect(restoreTargetOf(seed())).toEqual({ kind: "none" });
  });

  it("a command/agent KIND MISMATCH → `none` (refuse — never the wrong-agent most-recent)", () => {
    // The stale-command/new-agent race: memory still holds an `opencode` launch line
    // while the producer has already observed a live `claude-code` agent. Pairing them
    // into `exact` would make `resumeAgentCommand` silently downgrade to opencode's
    // most-recent — the wrong-agent resume #2 makes unspellable. Refuse: a bare shell.
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
      memory: {
        lastActivityAt: 1,
        lastAgentCommand: "opencode --model sonnet",
      },
    };
    expect(restoreTargetOf(cur)).toEqual({ kind: "none" });
  });

  it("never produces `legacyMostRecent` — that arm is migration-only", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 1, lastAgentCommand: "claude" },
    };
    expect(restoreTargetOf(cur).kind).not.toBe("legacyMostRecent");
  });
});

describe("foldSnapshot — reference stability the autosave fence rides (#6 pin)", () => {
  it("PRESERVES the git/pr object reference when an UNRELATED field changes", () => {
    // `restoreRelevantEqual` (the disk fence in server/local.ts) compares git/pr by
    // reference, relying on a non-git/pr fold spreading the SAME object through. Pin
    // that so a future fold change (a copy / structuredClone) that breaks ref
    // stability is caught here, not as a silent spurious-autosave regression.
    const git = gitInfo("main");
    const pr = { kind: "ok" as const, value: { number: 1 } } as never;
    const base = { ...seedSnapshot("/a"), git, pr };
    const afterForeground = foldSnapshot(base, {
      kind: "foreground",
      foreground: { name: "vim", title: null },
    });
    expect(afterForeground.git).toBe(git); // SAME reference — fence stays equal
    expect(afterForeground.pr).toBe(pr);
    const afterCwd = foldSnapshot(base, { kind: "cwd", cwd: "/b" });
    expect(afterCwd.git).toBe(git);
    expect(afterCwd.pr).toBe(pr);
  });

  it("produces a NEW git reference on a genuine git change (the fence trips)", () => {
    const git = gitInfo("main");
    const base = { ...seedSnapshot("/a"), git };
    const next = foldSnapshot(base, { kind: "git", git: gitInfo("feature") });
    expect(next.git).not.toBe(git);
    expect(next.git?.branch).toBe("feature");
  });
});
