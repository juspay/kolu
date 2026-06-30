/**
 * The PR-3 "local awareness is byte-identical" proof.
 *
 * PR-3 lifts kolu's local emit closure (the inline recency-baseline + `live`
 * computation + fold, `local.ts` ~766–824) out into the framer (phase/seq) plus
 * this shared CONSUMER ARM (the durable baseline + `live` decision). The HARD BAR
 * is no behavioural change: the "last active" recency must bump / not-bump exactly
 * as before. This is a DIFFERENTIAL test — it runs the SAME event streams through
 *
 *   (a) `reference`, an inline transcription of the PRE-refactor rule, and
 *   (b) the POST-refactor path (`createFramer().delta` → `createConsumerArm`),
 *
 * and asserts the folded `TerminalState` sequence is identical. Then it pins the
 * three recency cases the bar names explicitly: a fresh spawn BUMPS, and an adopt
 * / sleep-wake does NOT (the adopt guard — `adoptedSnapshot` seeds `agent: null`,
 * so only the seeded baseline keeps the re-resolved agent's delta from bumping).
 */

import { describe, expect, it } from "vitest";
import { type ConsumerSeed, createConsumerArm } from "./consume.ts";
import { createFramer } from "./framer.ts";
import { agentIdentityChanged, fold } from "./fold.ts";
import {
  type AgentIdentity,
  type AgentInfo,
  type TerminalEvent,
  type TerminalState,
  seedSnapshot,
} from "./schema.ts";

function claude(sessionId: string): AgentInfo {
  return {
    kind: "claude-code",
    state: "thinking",
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

const gitInfo = {
  repoRoot: "/r",
  repoName: "r",
  worktreePath: "/r",
  branch: "main",
  isWorktree: false,
  mainRepoRoot: "/r",
  remoteUrl: null,
};

const agentObs = (agent: AgentInfo | null): TerminalEvent => ({
  kind: "agent",
  agent: { value: agent },
});

const identityOf = (a: AgentInfo): AgentIdentity => ({
  kind: a.kind,
  sessionId: a.sessionId,
});

/** A deterministic clock — `at` = 1000, 2000, … — so both paths stamp recency
 *  with the same value when they each call it once per event. */
const makeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 1000);
};

/** The PRE-refactor rule, inline — the exact emit-closure logic PR-3 replaces:
 *  seed `current` + `recencyBaseline`, decide `live` from the durable baseline,
 *  re-seat on a change, fold with kolu's clock. Returns the state after each
 *  event so the post-refactor path can be diffed against it tick by tick. */
function reference(
  seed: ConsumerSeed,
  events: TerminalEvent[],
  clock: () => number,
): TerminalState[] {
  let current: TerminalState = { snapshot: seed.snapshot, memory: seed.memory };
  let recencyBaseline: AgentIdentity | null = seed.baseline;
  const out: TerminalState[] = [];
  for (const o of events) {
    let live = false;
    if (o.kind === "agent" && o.agent !== "unknown") {
      const next = o.agent.value;
      live = agentIdentityChanged(recencyBaseline, next);
      if (live)
        recencyBaseline = next
          ? { kind: next.kind, sessionId: next.sessionId }
          : null;
    }
    current = fold(current, o, { live, at: clock() });
    out.push(current);
  }
  return out;
}

/** The POST-refactor path: each event framed as a local `delta` and folded
 *  through the consumer arm. Mirrors `local.ts`'s rewired emit closure. */
function viaArm(
  seed: ConsumerSeed,
  events: TerminalEvent[],
  clock: () => number,
): TerminalState[] {
  const arm = createConsumerArm(seed, { clock });
  const framer = createFramer();
  const out: TerminalState[] = [];
  for (const o of events) {
    arm.consume(framer.delta([o]), () => {});
    out.push(arm.state);
  }
  return out;
}

const freshSeed = (): ConsumerSeed => ({
  snapshot: seedSnapshot("/work/repo"),
  memory: { lastActivityAt: 0 },
  baseline: null,
});

/** An ADOPT / sleep-wake seed: the live agent half is reset to null (the producer
 *  re-resolves it), saved recency stands, and the baseline is the resume identity
 *  riding the durable restore target. */
const adoptSeed = (agent: AgentInfo, savedRecency: number): ConsumerSeed => ({
  snapshot: { ...seedSnapshot("/work/repo"), agent: null },
  memory: { lastActivityAt: savedRecency, lastAgentCommand: "claude" },
  baseline: identityOf(agent),
});

describe("consumer arm — byte-identical to the pre-refactor local emit rule", () => {
  // One representative stream per seed, covering every event kind, the agent
  // firehose (same-identity ticks), an `unknown`, a session swap, and a quit.
  const streams: Array<{ name: string; events: TerminalEvent[] }> = [
    {
      name: "fresh spawn → first agent → detail churn → new session → quit",
      events: [
        { kind: "cwd", cwd: "/work/repo/sub" },
        { kind: "git", git: gitInfo },
        { kind: "pr", pr: { kind: "absent" } },
        { kind: "foreground", foreground: { name: "vim", title: null } },
        agentObs(claude("A")), // first agent — a genuine bump
        { kind: "agent", agent: "unknown" }, // mid-resolution — keep, no bump
        agentObs({ ...claude("A"), state: "awaiting_user" }), // detail tick — same id, no bump
        {
          kind: "commandRun",
          command: "claude --model sonnet",
          replayed: false,
        },
        agentObs(claude("B")), // new session — a bump
        agentObs(null), // quit to shell — a bump (identity → null)
      ],
    },
  ];

  for (const { name, events } of streams) {
    it(`fresh-spawn stream: ${name}`, () => {
      expect(viaArm(freshSeed(), events, makeClock())).toEqual(
        reference(freshSeed(), events, makeClock()),
      );
    });

    it(`adopt stream (baseline seeded): ${name}`, () => {
      const seed = (): ConsumerSeed => adoptSeed(claude("A"), 5000);
      expect(viaArm(seed(), events, makeClock())).toEqual(
        reference(seed(), events, makeClock()),
      );
    });
  }
});

describe("consumer arm — the recency bar (fresh-spawn bumps; adopt / sleep-wake do not)", () => {
  it("FRESH SPAWN: the first agent identity bumps lastActivityAt off the seed 0", () => {
    const arm = createConsumerArm(freshSeed(), { clock: makeClock() });
    arm.consume(createFramer().delta([agentObs(claude("A"))]), () => {});
    expect(arm.state.memory.lastActivityAt).toBe(1000); // bumped (clock's first tick)
  });

  it("ADOPT: a re-resolved agent matching the seeded baseline does NOT bump (the adopt guard)", () => {
    // adoptedSnapshot seeds agent:null, so agentIdentityChanged(snapshot.agent, A)
    // is true — ONLY the seeded baseline (the resume identity) keeps it from bumping.
    const arm = createConsumerArm(adoptSeed(claude("A"), 5000), {
      clock: makeClock(),
    });
    arm.consume(createFramer().delta([agentObs(claude("A"))]), () => {});
    expect(arm.state.memory.lastActivityAt).toBe(5000); // saved recency stands
    expect(arm.state.snapshot.agent).toEqual(claude("A")); // but the live agent IS applied
  });

  it("ADOPT GUARD removed → the bug returns: with baseline null, the same re-resolve bumps", () => {
    // Pin WHY the baseline is load-bearing: drop it (baseline:null) and the adopt
    // re-resolve spuriously bumps — the exact regression the seeded baseline prevents.
    const seed: ConsumerSeed = {
      ...adoptSeed(claude("A"), 5000),
      baseline: null,
    };
    const arm = createConsumerArm(seed, { clock: makeClock() });
    arm.consume(createFramer().delta([agentObs(claude("A"))]), () => {});
    expect(arm.state.memory.lastActivityAt).toBe(1000); // spurious bump (no guard)
  });

  it("SLEEP-WAKE: a quit-then-relaunch of the same session resumes without a bump, a NEW session bumps", () => {
    const arm = createConsumerArm(adoptSeed(claude("A"), 5000), {
      clock: makeClock(),
    });
    // Wake re-resolves the saved session A → no bump.
    arm.consume(createFramer().delta([agentObs(claude("A"))]), () => {});
    expect(arm.state.memory.lastActivityAt).toBe(5000);
    // A genuinely new session B → a real bump (clock's next tick).
    arm.consume(createFramer().delta([agentObs(claude("B"))]), () => {});
    expect(arm.state.memory.lastActivityAt).toBe(2000);
  });
});

describe("consumer arm — phase decides liveness; gap re-snapshots", () => {
  it("a SNAPSHOT frame never bumps recency (a re-observation), a DELTA frame does", () => {
    // Same new identity, two phases: snapshot (live=false) keeps recency; delta bumps.
    const snap = createConsumerArm(freshSeed(), { clock: makeClock() });
    snap.consume(
      { phase: "snapshot", events: [agentObs(claude("A"))] },
      () => {},
    );
    expect(snap.state.memory.lastActivityAt).toBe(0); // re-observation — no bump
    expect(snap.state.snapshot.agent).toEqual(claude("A")); // but the value IS applied

    const dlt = createConsumerArm(freshSeed(), { clock: makeClock() });
    dlt.consume(
      { phase: "delta", seq: 1, events: [agentObs(claude("A"))] },
      () => {},
    );
    expect(dlt.state.memory.lastActivityAt).toBe(1000); // live change — bump
  });

  it("a GAP frame re-snapshots from the configured reseed source (never a silent diverge)", () => {
    const fresh = freshSeed();
    const reseeded: ConsumerSeed = {
      snapshot: { ...seedSnapshot("/elsewhere"), agent: claude("Z") },
      memory: { lastActivityAt: 9000, lastAgentCommand: "claude" },
      baseline: identityOf(claude("Z")),
    };
    const arm = createConsumerArm(fresh, { reseed: () => reseeded });
    arm.consume({ phase: "gap", afterSeq: 7 }, () => {});
    expect(arm.state).toEqual({
      snapshot: reseeded.snapshot,
      memory: reseeded.memory,
    });
  });

  it("a GAP frame with no reseed source throws (fail-fast, never a silent empty)", () => {
    const arm = createConsumerArm(freshSeed());
    expect(() => arm.consume({ phase: "gap", afterSeq: 1 }, () => {})).toThrow(
      /gap frame/,
    );
  });
});
