import { describe, expect, it } from "vitest";
import {
  agentIdentityChanged,
  type FoldCtx,
  fold,
  foldSnapshot,
  RECENCY_THROTTLE_MS,
  type RecencyGate,
  restoreTargetOf,
  seedRecencyGate,
  stepRecencyGate,
} from "./fold.ts";
import {
  type AgentInfo,
  type RestoreTarget,
  seedMemory,
  seedSnapshot,
  type TerminalEvent,
  type TerminalState,
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
    expect(next.memory.lastActivityAt).toBe(null); // untouched — seed()'s honest never-active
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

describe("fold — a stable session's OUTPUT advances recency, THROTTLED (the freeze fix)", () => {
  const busy = (at: number): TerminalState => ({
    snapshot: { ...seedSnapshot("/a"), agent: claude("A", "thinking") },
    memory: { lastActivityAt: at },
  });

  it("bumps on a same-identity output tick once the throttle window has elapsed", () => {
    // The diagnosed freeze: a week-old stable session actively producing output
    // whose recency never moved because only an IDENTITY change bumped. A live
    // detail tick past the window now stamps.
    const next = fold(
      busy(500),
      agentObs(claude("A", "tool_use")),
      delta(500 + RECENCY_THROTTLE_MS),
    );
    expect(next.snapshot.agent?.state).toBe("tool_use");
    expect(next.memory.lastActivityAt).toBe(500 + RECENCY_THROTTLE_MS);
  });

  it("COALESCES output ticks inside the window to a single write (throttle pin)", () => {
    let cur = busy(500);
    // Two ticks well within the window: recency holds — no per-tick write noise.
    cur = fold(cur, agentObs(claude("A", "tool_use")), delta(500 + 10_000));
    expect(cur.memory.lastActivityAt).toBe(500);
    cur = fold(cur, agentObs(claude("A", "thinking")), delta(500 + 20_000));
    expect(cur.memory.lastActivityAt).toBe(500);
    // The first tick PAST the window writes once; the clock resets to it.
    cur = fold(
      cur,
      agentObs(claude("A", "tool_use")),
      delta(500 + RECENCY_THROTTLE_MS),
    );
    expect(cur.memory.lastActivityAt).toBe(500 + RECENCY_THROTTLE_MS);
  });

  it("NEVER throttle-bumps on a snapshot (re-observation) frame, however stale", () => {
    // A replay/re-observation is not activity — the frame phase forbids it even
    // when the throttle window is long past.
    const next = fold(
      busy(500),
      agentObs(claude("A", "waiting")),
      snapshot(500 + 10 * RECENCY_THROTTLE_MS),
    );
    expect(next.memory.lastActivityAt).toBe(500);
  });

  it("an IDENTITY change still bumps INSIDE the window (unthrottled — #1626 composes)", () => {
    // The throttle governs only same-identity output; a session start/finish is a
    // discrete event that stamps immediately regardless of the window.
    const next = fold(busy(500), agentObs(claude("B", "thinking")), delta(600));
    expect(next.memory.lastActivityAt).toBe(600);
  });
});

const EXACT_TARGET: RestoreTarget = {
  kind: "exact",
  command: "claude --model sonnet",
  agent: { kind: "claude-code", sessionId: "A" },
};

/** Simulate the producer's recency path (padi's `emit`): seed the gate from the
 *  restore target, then step it per agent observation to derive `ctx.live` and
 *  fold. Lets the adopt-vs-fresh recency pins live at the pure layer. */
function driveRecency(
  restoreTarget: RestoreTarget | undefined,
  from: TerminalState,
  ticks: { agent: AgentInfo | null; at: number }[],
): TerminalState {
  let gate: RecencyGate = seedRecencyGate(restoreTarget);
  let state = from;
  for (const t of ticks) {
    const stepped = stepRecencyGate(gate);
    gate = stepped.gate;
    state = fold(state, agentObs(t.agent), { live: stepped.live, at: t.at });
  }
  return state;
}

describe("recency gate — adopt suppresses the re-observation, then output flows", () => {
  // An adopted terminal seeds `agent: null` (a live-only field the producer
  // re-derives) and carries the SAVED recency on its memory.
  const adopted = (savedAt: number): TerminalState => ({
    snapshot: { ...seedSnapshot("/a"), agent: null },
    memory: { lastActivityAt: savedAt },
  });

  it("fresh spawn: the gate is open, so the first agent is live and bumps (#1626)", () => {
    const out = driveRecency(undefined, seed(), [
      { agent: claude("A", "thinking"), at: 1000 },
    ]);
    expect(out.memory.lastActivityAt).toBe(1000);
  });

  it("adopt idle: the lone re-observation does NOT bump — saved recency stands (#1626 pin)", () => {
    const out = driveRecency(EXACT_TARGET, adopted(1000), [
      { agent: claude("A", "waiting"), at: 999_999 },
    ]);
    expect(out.memory.lastActivityAt).toBe(1000);
  });

  it("adopt then output: re-observation held, a later live tick past the window advances", () => {
    const afterReObs = driveRecency(EXACT_TARGET, adopted(1000), [
      { agent: claude("A", "thinking"), at: 1000 + 5 },
    ]);
    expect(afterReObs.memory.lastActivityAt).toBe(1000); // held

    const advanced = driveRecency(EXACT_TARGET, adopted(1000), [
      { agent: claude("A", "thinking"), at: 1000 + 5 }, // adopt re-observation
      { agent: claude("A", "tool_use"), at: 1000 + RECENCY_THROTTLE_MS + 5 }, // live output
    ]);
    expect(advanced.memory.lastActivityAt).toBe(1000 + RECENCY_THROTTLE_MS + 5);
  });

  it("seedRecencyGate: an exact target closes the gate; none/legacy/absent opens it", () => {
    expect(stepRecencyGate(seedRecencyGate(EXACT_TARGET)).live).toBe(false);
    expect(stepRecencyGate(seedRecencyGate({ kind: "none" })).live).toBe(true);
    expect(stepRecencyGate(seedRecencyGate(undefined)).live).toBe(true);
  });

  it("stepRecencyGate: a closed gate opens after one step (only the FIRST obs is held)", () => {
    const first = stepRecencyGate(seedRecencyGate(EXACT_TARGET));
    expect(first.live).toBe(false);
    expect(stepRecencyGate(first.gate).live).toBe(true);
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
