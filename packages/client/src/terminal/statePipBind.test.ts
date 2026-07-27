/** The paint ⇄ count agreement contract.
 *
 *  Every attention COUNT (the host tab's triplet, the dock section header's)
 *  folds agent state through `agentBucket` — a terminal is "working" iff its
 *  agent is thinking / tool_use / running_background. Every PIP folds the same
 *  state through `agentPaintClass` → `pipVariant` → `PIP_BODY`. The two are
 *  separate folds over one fact, so nothing but a test stops them disagreeing —
 *  and when they disagree the user sees a rust "working" pip on a terminal no
 *  count includes, which is precisely the "one fact, four dialects" defect the
 *  attention vocabulary exists to kill.
 *
 *  The live case that motivated this file: two codex terminals, the host tab
 *  counting neither as working, one rendering the dim violet linger and the
 *  other rendering busy rust. The rust one had no live agent state on the
 *  client at all — it wore codex's brand mark from its persisted
 *  `restoreTarget` while `shellLive` painted it as an anonymous noisy shell. */

import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  activeArm,
} from "@kolu/padi/surface";
import { PIP_BODY, SHELL_LIVE_CLASS } from "@kolu/solid-statepip/pipVariant";
import { type AgentInfo, agentBucket } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { bindStatePip } from "./statePipBind";

/** `AgentInfo` is a per-kind discriminated union, so the fixture pins one kind
 *  (the paint folds read only `state`; identity is the orthogonal glyph axis,
 *  exercised through `restoreTarget` below). */
function makeAgent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/tmp",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: null,
    ...overrides,
  };
}

/** The rendered paint class for a bound pip — the exact expression `StatePip`
 *  evaluates (`shellLive ? SHELL_LIVE_CLASS : PIP_BODY[variant]`), so the test
 *  asserts what the user SEES, not an intermediate the leaf might override. */
function paintClass(bind: ReturnType<typeof bindStatePip>): string | null {
  if (bind.shellLive) return SHELL_LIVE_CLASS;
  return PIP_BODY[bind.variant]?.class ?? null;
}

/** Busy rust — the paint that means "this machine is in flight". */
const BUSY = PIP_BODY.working!.class;

describe("paint ⇄ count agreement — a pip may only read busy when a count reads working", () => {
  // THE REPRODUCTION (juspay/kolu#2019 review — "3 agents working, tab shows 2").
  //
  // A codex terminal rendered a RUST (busy) brand mark while the host tab
  // counted it as not-working. Pixel-sampled from the report: every other
  // `waiting` agent's pip was blue-shifted violet; this one was warm rust.
  //
  // The state that produces it: the client holds NO live agent for the
  // terminal (its `rowSubline` fell through to the foreground title, which
  // only happens when `arm.agent` is absent) — but the pip still wears codex's
  // brand mark, because `pipGlyphFor` falls back to the persisted
  // `restoreTarget` identity. So the identity axis says "codex drives this"
  // while the paint axis takes `shellLive`, whose whole meaning is "an
  // ANONYMOUS shell is producing bytes".
  //
  // The two axes contradict each other, and the user reads the result exactly
  // as it looks: an agent, working. No count agrees, because no count can see
  // an agent state that isn't there.
  it("a terminal wearing an agent's brand mark never paints busy without a live agent", () => {
    const bind = bindStatePip({
      meta: makeMeta({
        agent: null, // the client has no live agent state for it
        foreground: { name: "codex", title: "drishti-osfacts" },
        lastActivityAt: 1,
        restoreTarget: {
          kind: "exact",
          command: "codex --yolo",
          agent: { kind: "codex", sessionId: "s1" },
        },
      }),
      isLive: true, // …and its pty is still printing
      isFinished: false,
      unread: false,
    });

    // The identity axis resolves to codex — that part is correct and stays.
    expect(bind.glyph).toBe("codex");
    // …so the paint axis must NOT claim "anonymous shell, live output".
    expect(bind.shellLive).toBe(false);
    expect(paintClass(bind)).not.toBe(BUSY);
  });

  // The same fact stated as the invariant it protects: busy paint requires
  // EITHER a live agent a count reads as working, OR the plain shell mark.
  // Nothing else may paint busy — that is the whole disagreement class.
  it("busy paint implies a working agent or the shell glyph — never a third case", () => {
    const cases: Array<{ label: string; glyph: "codex" | "claude-code" }> = [
      { label: "codex identity, no live agent, live pty", glyph: "codex" },
      {
        label: "claude identity, no live agent, live pty",
        glyph: "claude-code",
      },
    ];
    for (const c of cases) {
      const bind = bindStatePip({
        meta: makeMeta({
          agent: null,
          lastActivityAt: 1,
          restoreTarget: {
            kind: "exact",
            command: "x",
            agent: { kind: c.glyph, sessionId: "s1" },
          },
        }),
        isLive: true,
        isFinished: false,
        unread: false,
      });
      const paintsBusy = paintClass(bind) === BUSY;
      const isShell = bind.glyph === "shell";
      expect(
        paintsBusy && !isShell,
        `${c.label} paints busy as a non-shell`,
      ).toBe(false);
    }
  });

  // A live agent in the post-turn lull: `waiting` lands in `finishedIds`,
  // never `workingIds`, and live PTY bytes are orthogonal — a finished agent
  // whose terminal is still printing is still finished.
  it("a `waiting` agent still emitting output paints linger, never busy", () => {
    const meta = makeMeta({ agent: makeAgent("waiting") });
    const bind = bindStatePip({
      meta,
      isLive: true,
      isFinished: true,
      unread: false,
    });

    expect(agentBucket(activeArm(meta)!.agent!.state)).toBe("waiting");
    expect(paintClass(bind)).not.toBe(BUSY);
    expect(bind.variant).toBe("linger");
    expect(bind.shellLive).toBe(false);
  });

  // Same agent state, no live output. Pinned beside its twin so a future
  // change can't fix one and skew the other.
  it("a quiet `waiting` agent paints the same linger as a noisy one", () => {
    const noisy = bindStatePip({
      meta: makeMeta({ agent: makeAgent("waiting") }),
      isLive: true,
      isFinished: true,
      unread: false,
    });
    const quiet = bindStatePip({
      meta: makeMeta({ agent: makeAgent("waiting") }),
      isLive: false,
      isFinished: true,
      unread: false,
    });
    expect(paintClass(noisy)).toBe(paintClass(quiet));
  });

  // The differential, stated over the whole closed state set: the busy paint
  // and the working count are one fact, so they agree for every agent state.
  const STATES: AgentInfo["state"][] = [
    "thinking",
    "tool_use",
    "running_background",
    "awaiting_user",
    "waiting",
  ];

  for (const state of STATES) {
    for (const isLive of [false, true]) {
      it(`${state}${isLive ? " (live output)" : ""}: busy paint ⇔ counted working`, () => {
        const bind = bindStatePip({
          meta: makeMeta({ agent: makeAgent(state) }),
          isLive,
          isFinished: true,
          unread: false,
        });
        const countsWorking = agentBucket(state) === "working";
        expect(paintClass(bind) === BUSY).toBe(countsWorking);
      });
    }
  }

  // The escape hatch itself, kept honest: an AGENTLESS terminal with live
  // output is exactly what `shellLive` is for (a shell running `btop`), and it
  // is counted by no attention count — the one sanctioned busy-without-a-count
  // case, because no agent identity is being described.
  it("an agentless live shell keeps its busy paint (the one sanctioned case)", () => {
    const bind = bindStatePip({
      meta: makeMeta({ agent: null, lastActivityAt: 1 }),
      isLive: true,
      isFinished: false,
      unread: false,
    });
    expect(bind.shellLive).toBe(true);
    expect(paintClass(bind)).toBe(BUSY);
    // …and it wears the shell prompt, not an agent's brand mark, so it cannot
    // read as "some agent is working".
    expect(bind.glyph).toBe("shell");
  });
});
