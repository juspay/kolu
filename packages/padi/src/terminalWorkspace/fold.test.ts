import {
  type AgentInfo,
  type AgentObservation,
  type RestoreTarget,
  seedMemory,
  seedSnapshot,
  type TerminalEvent,
  type TerminalState,
} from "@kolu/terminal-vocab/schema";
import { agentPresence } from "kolu-agents/vocab";
import { describe, expect, it } from "vitest";
import {
  type AgentIdentityRef,
  agentIdentityChanged,
  type FoldCtx,
  fold,
  foldSnapshot,
  RECENCY_WRITE_WINDOW_MS,
  restoreTargetFor,
  seedRecencyBaseline,
  stepRecencyBaseline,
} from "./fold.ts";

const gitInfo = (branch: string) =>
  ({
    kind: "repo",
    info: {
      repoRoot: "/r",
      repoName: "r",
      worktreePath: "/r",
      branch,
      isWorktree: false,
      mainRepoRoot: "/r",
      remoteUrl: null,
      isBare: false,
    },
  }) as const;

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
  restoreTarget: { kind: "none" },
});

const observed = (
  info: AgentInfo,
  argv: readonly string[] = [],
): AgentObservation => ({ info, argv });

const steadyState = (at: number, runStartedAt = 0): FoldCtx => ({
  live: true,
  at,
  runStartedAt,
});
const atRunStart = (at: number, runStartedAt = at): FoldCtx => ({
  live: false,
  at,
  runStartedAt,
});

const agentObs = (
  agent: AgentInfo | null,
  argv: readonly string[] = [],
): TerminalEvent => ({
  kind: "agent",
  agent: { value: agent === null ? null : observed(agent, argv) },
});

describe("foldSnapshot — last-write-wins over the six snapshot fields", () => {
  it("applies cwd/git/pr/foreground edges", () => {
    let o = seedSnapshot("/a");
    o = foldSnapshot(o, { kind: "cwd", cwd: "/b" });
    expect(o.cwd).toBe("/b");
    o = foldSnapshot(o, { kind: "pr", pr: { kind: "absent" } });
    expect(o.pr).toEqual({ kind: "absent" });
    o = foldSnapshot(o, {
      kind: "foreground",
      foreground: { name: "vim", title: null, shell: false },
    });
    expect(o.foreground).toEqual({ name: "vim", title: null, shell: false });
  });

  it("KEEPS the prior agent on `unknown` (same reference — no clobber)", () => {
    const o = { ...seedSnapshot("/a"), agent: claude("A", "thinking") };
    const next = foldSnapshot(o, { kind: "agent", agent: "unknown" });
    expect(next).toBe(o);
  });

  it("APPLIES an authoritative `{ value }` agent, including a null (session ended)", () => {
    const o = { ...seedSnapshot("/a"), agent: claude("A", "thinking") };
    const next = foldSnapshot(o, {
      kind: "agent",
      agent: { value: null },
    });
    expect(next.agent).toBeNull();
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
    const next = fold(
      seed(),
      agentObs(claude("A", "thinking")),
      steadyState(1000),
    );
    expect(next.snapshot.agent?.sessionId).toBe("A");
    expect(next.memory.lastActivityAt).toBe(1000);
  });

  it("does NOT bump the same null→detected re-observation in a SNAPSHOT frame", () => {
    const next = fold(
      seed(),
      agentObs(claude("A", "thinking")),
      atRunStart(1000),
    );
    expect(next.snapshot.agent?.sessionId).toBe("A");
    expect(next.memory.lastActivityAt).toBe(null);
  });

  it("does NOT bump on a same-identity state tick (firehose) — keeps prior recency", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 500, promptedAt: null },
      restoreTarget: { kind: "none" },
    };
    const next = fold(cur, agentObs(claude("A", "waiting")), steadyState(9999));
    expect(next.snapshot.agent?.state).toBe("waiting");
    expect(next.memory.lastActivityAt).toBe(500);
  });

  it("bumps when a finished agent is followed by a genuinely-new one (the old-caveat bug)", () => {
    let cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "waiting") },
      memory: { lastActivityAt: 500, promptedAt: null },
      restoreTarget: { kind: "none" },
    };
    cur = fold(cur, agentObs(null), steadyState(600));
    expect(cur.memory.lastActivityAt).toBe(600);
    cur = fold(cur, agentObs(claude("B", "thinking")), steadyState(700));
    expect(cur.memory.lastActivityAt).toBe(700);
  });

  it("KEEPS kolu's value (and recency) on an `unknown` agent — mid-resolution never clobbers", () => {
    const cur: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
      memory: { lastActivityAt: 500, promptedAt: null },
      restoreTarget: { kind: "none" },
    };
    const next = fold(
      cur,
      { kind: "agent", agent: "unknown" },
      steadyState(9999),
    );
    expect(next).toBe(cur);
  });
});

describe("fold — a stable session's OUTPUT advances recency, THROTTLED (the freeze fix)", () => {
  const busy = (at: number): TerminalState => ({
    snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
    memory: { lastActivityAt: at, promptedAt: null },
    restoreTarget: { kind: "none" },
  });

  it("bumps on a same-identity output tick once the throttle window has elapsed", () => {
    const next = fold(
      busy(500),
      agentObs(claude("A", "tool_use")),
      steadyState(500 + RECENCY_WRITE_WINDOW_MS),
    );
    expect(next.snapshot.agent?.state).toBe("tool_use");
    expect(next.memory.lastActivityAt).toBe(500 + RECENCY_WRITE_WINDOW_MS);
  });

  it("COALESCES output ticks inside the window to a single write (throttle pin)", () => {
    let cur = busy(500);
    cur = fold(
      cur,
      agentObs(claude("A", "tool_use")),
      steadyState(500 + 10_000),
    );
    expect(cur.memory.lastActivityAt).toBe(500);
    cur = fold(
      cur,
      agentObs(claude("A", "thinking")),
      steadyState(500 + 20_000),
    );
    expect(cur.memory.lastActivityAt).toBe(500);
    cur = fold(
      cur,
      agentObs(claude("A", "tool_use")),
      steadyState(500 + RECENCY_WRITE_WINDOW_MS),
    );
    expect(cur.memory.lastActivityAt).toBe(500 + RECENCY_WRITE_WINDOW_MS);
  });

  it("does NOT identity-bump a `!live` re-observation, and its throttle coalesces at run start", () => {
    const adoptedIdle: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: null },
      memory: { lastActivityAt: 500, promptedAt: null },
      restoreTarget: { kind: "none" },
    };
    const now = 500 + 10 * RECENCY_WRITE_WINDOW_MS;
    const next = fold(adoptedIdle, agentObs(claude("A", "waiting")), {
      live: false,
      at: now,
      runStartedAt: now,
    });
    expect(next.snapshot.agent?.sessionId).toBe("A");
    expect(next.memory.lastActivityAt).toBe(500);
  });

  it("an IDENTITY change still bumps INSIDE the window (unthrottled — #1626 composes)", () => {
    const next = fold(
      busy(500),
      agentObs(claude("B", "thinking")),
      steadyState(600),
    );
    expect(next.memory.lastActivityAt).toBe(600);
  });
});

const EXACT_TARGET: RestoreTarget = {
  kind: "exact",
  agent: { kind: "claude-code", sessionId: "A", resumeRef: "A" },
  argv: ["--model", "sonnet"],
};

function driveRecency(
  restoreTarget: RestoreTarget | undefined,
  from: TerminalState,
  runStartedAt: number,
  ticks: { agent: AgentInfo | null; at: number }[],
): TerminalState {
  let baseline: AgentIdentityRef | null = seedRecencyBaseline(restoreTarget);
  let state = from;
  for (const t of ticks) {
    const o = agentObs(t.agent);
    const step = stepRecencyBaseline(baseline, o);
    baseline = step.baseline;
    state = fold(state, o, { live: step.live, at: t.at, runStartedAt });
  }
  return state;
}

describe("recency baseline — adopt survives its multi-emit settle, then output flows", () => {
  const adopted = (savedAt: number): TerminalState => ({
    snapshot: { ...seedSnapshot("/a"), agent: null },
    memory: { lastActivityAt: savedAt, promptedAt: null },
    restoreTarget: { kind: "none" },
  });

  it("fresh spawn: baseline is null, so the first agent is live and bumps (#1626)", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "thinking"), at: 1000 },
    ]);
    expect(out.memory.lastActivityAt).toBe(1000);
  });

  it("adopt idle, MULTI-emit settle: the whole survivor burst holds saved recency", () => {
    const out = driveRecency(EXACT_TARGET, adopted(1000), 999_999, [
      { agent: claude("A", "waiting"), at: 999_999 },
      { agent: claude("A", "waiting"), at: 999_999 + 50 },
      { agent: claude("A", "waiting"), at: 999_999 + 120 },
    ]);
    expect(out.memory.lastActivityAt).toBe(1000);
  });

  it("adopt then output: the settle holds, a later live tick past the window advances", () => {
    const advanced = driveRecency(EXACT_TARGET, adopted(1000), 999_999, [
      { agent: claude("A", "thinking"), at: 999_999 },
      {
        agent: claude("A", "tool_use"),
        at: 999_999 + RECENCY_WRITE_WINDOW_MS + 5,
      },
    ]);
    expect(advanced.memory.lastActivityAt).toBe(
      999_999 + RECENCY_WRITE_WINDOW_MS + 5,
    );
  });

  it("adopt, survivor gone during downtime, then a NEW agent launches → its start bumps", () => {
    const out = driveRecency(EXACT_TARGET, adopted(1000), 999_999, [
      { agent: claude("B", "thinking"), at: 1_000_050 },
    ]);
    expect(out.memory.lastActivityAt).toBe(1_000_050);
  });

  it("seedRecencyBaseline: an exact target seeds the survivor identity; none/absent seed null", () => {
    expect(seedRecencyBaseline(EXACT_TARGET)).toEqual({
      kind: "claude-code",
      sessionId: "A",
    });
    expect(seedRecencyBaseline({ kind: "none" })).toBeNull();
    expect(seedRecencyBaseline(undefined)).toBeNull();
  });
});

describe("promptedAt — the current agent's first live turn", () => {
  it("is NOT stamped when a fresh agent is detected at its first prompt (`waiting`)", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "waiting"), at: 1000 },
      { agent: claude("A", "waiting"), at: 2000 },
    ]);
    expect(out.memory.lastActivityAt).toBe(1000);
    expect(out.memory.promptedAt).toBeNull();
  });

  it("is stamped on the first live state (`thinking`)", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "waiting"), at: 1000 },
      { agent: claude("A", "thinking"), at: 3000 },
    ]);
    expect(out.memory.promptedAt).toBe(3000);
  });

  it("counts `awaiting_user` as live too", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "awaiting_user"), at: 1500 },
    ]);
    expect(out.memory.promptedAt).toBe(1500);
  });

  it("is NOT re-stamped on later turns of the same agent", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "thinking"), at: 1000 },
      { agent: claude("A", "waiting"), at: 2000 },
      { agent: claude("A", "tool_use"), at: 3000 },
      { agent: claude("A", "waiting"), at: 4000 },
    ]);
    expect(out.memory.promptedAt).toBe(1000);
  });

  it("resets on an agent IDENTITY change — a new session has its own first prompt", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "thinking"), at: 1000 },
      { agent: claude("B", "waiting"), at: 2000 },
    ]);
    expect(out.memory.promptedAt).toBeNull();
  });

  it("is null once the agent exits", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: claude("A", "thinking"), at: 1000 },
      { agent: null, at: 2000 },
    ]);
    expect(out.memory.promptedAt).toBeNull();
  });

  it("survives an adopt: the survivor's re-observation keeps the saved stamp", () => {
    const adoptedPrompted: TerminalState = {
      snapshot: { ...seedSnapshot("/a"), agent: null },
      memory: { lastActivityAt: 1000, promptedAt: 900 },
      restoreTarget: { kind: "none" },
    };
    const out = driveRecency(EXACT_TARGET, adoptedPrompted, 999_999, [
      { agent: claude("A", "waiting"), at: 999_999 },
      { agent: claude("A", "waiting"), at: 999_999 + 50 },
    ]);
    expect(out.memory.promptedAt).toBe(900);
  });

  it("is NOT stamped while an agent is only present, and IS on its first turn", () => {
    const out = driveRecency(undefined, seed(), 999, [
      { agent: agentPresence("claude-code", "starting", null), at: 1000 },
      { agent: agentPresence("claude-code", "fresh", null), at: 2000 },
    ]);
    expect(out.memory.promptedAt).toBeNull();
    const prompted = driveRecency(undefined, seed(), 999, [
      { agent: agentPresence("claude-code", "fresh", null), at: 1000 },
      { agent: claude("A", "thinking"), at: 3000 },
    ]);
    expect(prompted.memory.promptedAt).toBe(3000);
  });
});

describe("fold — the observation's argv reaches the restore target", () => {
  it("derives the target from the SAME observation (identity + allowlisted argv)", () => {
    const next = fold(
      seed(),
      agentObs(claude("A", "thinking"), ["--model", "sonnet"]),
      steadyState(1),
    );
    expect(next.restoreTarget).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId: "A", resumeRef: "A" },
      argv: ["--model", "sonnet"],
    });
  });

  it("REPLACES an empty argv on a same-identity tick (the flags-return case)", () => {
    const first = fold(
      seed(),
      agentObs(claude("A", "thinking"), []),
      steadyState(1),
    );
    const second = fold(
      first,
      agentObs(claude("A", "waiting"), ["--model", "sonnet"]),
      steadyState(2),
    );
    expect(second.restoreTarget).toMatchObject({
      kind: "exact",
      argv: ["--model", "sonnet"],
    });
  });

  it("clears the target when the agent ends", () => {
    const live = fold(
      seed(),
      agentObs(claude("A", "thinking"), ["--model", "sonnet"]),
      steadyState(1),
    );
    const after = fold(live, agentObs(null), steadyState(2));
    expect(after.restoreTarget).toEqual({ kind: "none" });
  });

  it("keeps the target through an `unknown` tick", () => {
    const live = fold(
      seed(),
      agentObs(claude("A", "thinking"), ["--model", "sonnet"]),
      steadyState(1),
    );
    const after = fold(
      live,
      { kind: "agent", agent: "unknown" },
      steadyState(2),
    );
    expect(after).toBe(live);
  });
});

describe("restoreTargetFor — the fold owns the discriminated resume target", () => {
  it("an observation → `exact` with its identity and argv", () => {
    expect(
      restoreTargetFor(
        observed(claude("A", "thinking"), ["--model", "sonnet"]),
      ),
    ).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId: "A", resumeRef: "A" },
      argv: ["--model", "sonnet"],
    });
  });

  it("an observation with no allowlisted flags → `exact` with an empty argv", () => {
    expect(restoreTargetFor(observed(claude("A", "thinking")))).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId: "A", resumeRef: "A" },
      argv: [],
    });
  });

  it("no observation → `none` (bare shell)", () => {
    expect(restoreTargetFor(null)).toEqual({ kind: "none" });
  });

  it("copies the argv out — a caller cannot mutate the observation through the target", () => {
    const observation = observed(claude("A", "thinking"), [
      "--model",
      "sonnet",
    ]);
    const target = restoreTargetFor(observation);
    if (target.kind !== "exact") throw new Error("expected exact");
    expect(target.argv).not.toBe(observation.argv);
    (target.argv as string[]).push("--yolo");
    expect(observation.argv).toEqual(["--model", "sonnet"]);
  });

  it("a PRESENCE → `none`: there is no conversation to resume, even when the agent already names its session", () => {
    expect(
      restoreTargetFor(observed(agentPresence("omp", "fresh", "lazy-id"))),
    ).toEqual({ kind: "none" });
    expect(
      restoreTargetFor(
        observed(agentPresence("claude-code", "starting", null)),
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("W12 — the two absences persist the resume target differently (twin pins)", () => {
  const exact: RestoreTarget = {
    kind: "exact",
    agent: { kind: "claude-code", sessionId: "A", resumeRef: "A" },
    argv: ["--model", "sonnet"],
  };
  const liveExact: TerminalState = {
    snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
    memory: { lastActivityAt: 1, promptedAt: null },
    restoreTarget: exact,
  };

  it("PIN #1 — an UNOBSERVABLE terminal (sensor emits `unknown`) KEEPS the exact target", () => {
    expect(liveExact.restoreTarget).toEqual(exact);
    const after = fold(
      liveExact,
      { kind: "agent", agent: "unknown" },
      steadyState(2),
    );
    expect(after.restoreTarget).toEqual(exact);
  });

  it("PIN #2 — a GENUINE end (sensor emits `{value:null}`) CLEARS the target to `none`", () => {
    expect(liveExact.restoreTarget).toEqual(exact);
    const after = fold(liveExact, agentObs(null), steadyState(2));
    expect(after.restoreTarget).toEqual({ kind: "none" });
  });
});

describe("foldSnapshot — reference stability the autosave fence rides (#6 pin)", () => {
  it("PRESERVES the git/pr object reference when an UNRELATED field changes", () => {
    const git = gitInfo("main");
    const pr = { kind: "ok" as const, value: { number: 1 } } as never;
    const base = { ...seedSnapshot("/a"), git, pr };
    const afterForeground = foldSnapshot(base, {
      kind: "foreground",
      foreground: { name: "vim", title: null, shell: false },
    });
    expect(afterForeground.git).toBe(git);
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
    expect(next.git).toMatchObject({
      kind: "repo",
      info: { branch: "feature" },
    });
  });
});
