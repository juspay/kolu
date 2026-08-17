/**
 * The one-call submit's DOCTRINE, pinned where it is decidable without a PTY:
 * the readiness predicate, and the four-step sequence around it.
 *
 * Every impure edge of `submitInput` is injected (the readiness view, the byte
 * write, the clock), so these are the real production functions — not a
 * re-implementation of them — driven against a stated world. What is NOT here is
 * the wiring (`openPromptWatch`'s kaval subscription and registry read); that is
 * proved end-to-end against a real padi and a real TUI in
 * `kolu-cli/src/submit.e2e.test.ts`, which is where it can be proved at all.
 */

import { describe, expect, it } from "vitest";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { EFFECTIVE_FINISH_QUIET_MS } from "./activity/finishQuiet.ts";
import { FIRST_MESSAGE_SETTLE_MS } from "./surface.ts";
import {
  isPromptIdle,
  type PromptObservation,
  type PromptWatch,
  submitInput,
} from "./submitInput.ts";

const IDLE: PromptObservation = {
  live: true,
  noisy: false,
  agent: undefined,
  feedLive: true,
};

const agent = (state: AgentInfo["state"]): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

describe("isPromptIdle — every unknown answers NOT idle", () => {
  it("a quiet live terminal with a live feed is idle", () => {
    expect(isPromptIdle(IDLE)).toBe(true);
  });

  it("output inside the quiet window is not idle", () => {
    expect(isPromptIdle({ ...IDLE, noisy: true })).toBe(false);
  });

  it("a dead terminal is never idle", () => {
    expect(isPromptIdle({ ...IDLE, live: false })).toBe(false);
  });

  it("a DOWN activity feed is silence, not quiet", () => {
    // The failure this closes: with the kaval subscription dropped, no edge ever
    // arrives, the quiet window elapses on its own, and a working agent reads as
    // an idle prompt — the exact reading that types a brief into a running turn.
    expect(isPromptIdle({ ...IDLE, feedLive: false })).toBe(false);
  });

  it("a WORKING agent is not idle however long it has been silent", () => {
    // The second conjunct's whole reason: output quiescence cannot see a
    // thinking pause that outlasts the window, and that pause is exactly when a
    // typed message gets wiped by the turn ending.
    for (const state of ["thinking", "tool_use", "running_background"] as const)
      expect(isPromptIdle({ ...IDLE, agent: agent(state) })).toBe(false);
  });

  it("an agent that is waiting or asking IS idle — it is at its prompt", () => {
    for (const state of ["waiting", "awaiting_user"] as const)
      expect(isPromptIdle({ ...IDLE, agent: agent(state) })).toBe(true);
  });

  it("no recognized agent leaves the quiet window to decide alone", () => {
    // A bare shell or a REPL has no turn to speak of, so `null` must not be read
    // as "an agent that is not working" NOR as a reason to refuse.
    expect(isPromptIdle({ ...IDLE, agent: null })).toBe(true);
    expect(isPromptIdle({ ...IDLE, agent: null, noisy: true })).toBe(false);
  });
});

/** A scripted readiness view: one observation per poll, the last repeating
 *  forever, plus a record of every `arm()` so the sequence's own restamping is
 *  visible to a test. */
function scriptedWatch(script: readonly PromptObservation[]): PromptWatch & {
  readonly arms: number[];
  polls(): number;
} {
  let poll = 0;
  const arms: number[] = [];
  return {
    arms,
    polls: () => poll,
    observe() {
      const at = Math.min(poll, script.length - 1);
      poll += 1;
      return script[at] as PromptObservation;
    },
    arm: () => arms.push(poll),
    close: () => {},
  };
}

/** A clock that advances a fixed step per read, so a bounded wait terminates
 *  without real time passing. */
const steppingClock = (stepMs: number): (() => number) => {
  let now = 0;
  return () => {
    const at = now;
    now += stepMs;
    return at;
  };
};

const BUSY: PromptObservation = { ...IDLE, noisy: true };

describe("submitInput — the four steps", () => {
  it("types then submits, and reports both waits separately", async () => {
    const writes: string[] = [];
    const watch = scriptedWatch([IDLE]);
    const outcome = await submitInput({
      watch,
      write: (d) => writes.push(d),
      data: "review this PR",
      timeoutMs: 5_000,
      clock: steppingClock(10),
    });

    expect(outcome).toMatchObject({ kind: "submitted" });
    // The text goes first and the Enter is its OWN write — the same two writes a
    // caller doing it by hand would issue, in the same order, with padi's
    // observation in the gap instead of the caller's.
    expect(writes).toEqual(["review this PR", "\r"]);
  });

  it("re-arms the quiet window AFTER typing, before waiting for the settle", async () => {
    // Without this the settle wait reads the quiet it just measured in step 1 —
    // the terminal has not seen a byte yet — and Enter races the paste debounce,
    // which is the whole failure the three-call ritual existed to avoid.
    const watch = scriptedWatch([IDLE]);
    await submitInput({
      watch,
      write: () => {},
      data: "hi",
      timeoutMs: 5_000,
      clock: steppingClock(10),
    });
    expect(watch.arms.length).toBe(1);
  });

  it("REFUSES a mid-turn target having typed NOTHING", async () => {
    // The mid-turn doctrine, stated as a test: the message is not queued, not
    // typed-and-hoped-for, not partially delivered. Nothing was written, so the
    // caller can retry freely.
    const writes: string[] = [];
    const outcome = await submitInput({
      watch: scriptedWatch([BUSY]),
      write: (d) => writes.push(d),
      data: "review this PR",
      timeoutMs: 50,
      clock: steppingClock(10),
    });

    expect(outcome).toMatchObject({
      kind: "refused",
      phase: "ready",
      reason: "busy",
    });
    expect(writes).toEqual([]);
  });

  it("a target that goes busy AFTER the text lands refuses at `settle` — text typed, Enter NOT sent", async () => {
    // The one refusal that leaves state behind, and the reason `phase` is data:
    // recovery here is an Enter (or an Escape), never a blind re-send.
    const writes: string[] = [];
    const outcome = await submitInput({
      watch: scriptedWatch([IDLE, BUSY]),
      write: (d) => writes.push(d),
      data: "brief",
      timeoutMs: 50,
      clock: steppingClock(10),
    });

    expect(outcome).toMatchObject({
      kind: "refused",
      phase: "settle",
      reason: "busy",
    });
    expect(writes).toEqual(["brief"]);
  });

  it("a terminal that dies mid-wait refuses AT ONCE, not at the bound", async () => {
    // Waiting out a 60-second bound on a PTY that no longer exists is time spent
    // learning nothing, and `gone` is never worth a retry where `busy` is.
    const clock = steppingClock(10);
    const outcome = await submitInput({
      watch: scriptedWatch([BUSY, { ...IDLE, live: false }]),
      write: () => {},
      data: "brief",
      timeoutMs: 60_000,
      clock,
    });

    expect(outcome).toMatchObject({
      kind: "refused",
      phase: "ready",
      reason: "gone",
    });
    // Two polls, not six thousand: the bound never came into it.
    expect((outcome as { waitedMs: number }).waitedMs).toBeLessThan(100);
  });

  it("waits out a busy target that becomes idle inside the bound", async () => {
    const writes: string[] = [];
    const outcome = await submitInput({
      watch: scriptedWatch([BUSY, BUSY, BUSY, IDLE]),
      write: (d) => writes.push(d),
      data: "brief",
      timeoutMs: 5_000,
      clock: steppingClock(10),
    });

    expect(outcome.kind).toBe("submitted");
    expect(writes).toEqual(["brief", "\r"]);
  });

  it("an aborted request refuses rather than pressing Enter into the abort", async () => {
    const abort = new AbortController();
    abort.abort();
    const writes: string[] = [];
    const outcome = await submitInput({
      watch: scriptedWatch([BUSY]),
      write: (d) => writes.push(d),
      data: "brief",
      timeoutMs: 60_000,
      clock: steppingClock(10),
      signal: abort.signal,
    });

    expect(outcome).toMatchObject({ kind: "refused", phase: "ready" });
    expect(writes).toEqual([]);
  });
});

describe("submitInput — an aborted request must not leave residue", () => {
  // The claim the module's own doc makes: "it stops polling, and it stops
  // BEFORE the next write, so an abandoned submit leaves the terminal exactly
  // where the last completed step left it."
  //
  // The earlier abort test only ever exercised a BUSY target, where the abort is
  // read on the same branch as the timeout. The case that matters is the other
  // one — and it is the common one, since a caller usually cancels a submit that
  // is about to succeed.
  it("types NOTHING when the target is ALREADY IDLE and the request is aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const writes: string[] = [];

    const outcome = await submitInput({
      watch: scriptedWatch([IDLE]),
      write: (d) => writes.push(d),
      data: "brief",
      timeoutMs: 60_000,
      clock: steppingClock(10),
      signal: abort.signal,
    });

    // The whole point: an abandoned submit must not stage text in a terminal
    // nobody is left watching — that is the residue the mid-turn doctrine exists
    // to prevent, arrived at from the other direction.
    expect(writes).toEqual([]);
    expect(outcome).toMatchObject({ kind: "refused", phase: "ready" });
  });
});

describe("the first message's quiet window is DERIVED, not invented", () => {
  it("equals padi's effective-finish quiet window", () => {
    // Both answer one question — "is this agent's silence real, or a gap?" — so
    // they take one answer. Pinned here rather than left to a comment because
    // the two constants live in different modules (one browser-safe, one not) and
    // cannot import each other: without this, tuning the finish window would
    // silently leave the first-message window behind, and a brief would start
    // landing in a booting agent again with nothing to say why.
    expect(FIRST_MESSAGE_SETTLE_MS).toBe(EFFECTIVE_FINISH_QUIET_MS);
  });
});

describe('readiness: "agent" — the boot gap that lost a brief', () => {
  // The field failure, 2026-08-18: `lifecycle_create { run: "claude …", message }`
  // answered `briefed` and the brief never reached the agent. The terminal was
  // quiet for the whole window because nothing had painted yet — the shell had
  // not finished exec'ing claude — and `"quiet"` reads that as an idle prompt.
  //
  // These cases are the two readings of ONE observation, side by side: the same
  // silent, unrecognized terminal is idle under `"quiet"` and not idle under
  // `"agent"`. That difference is the whole fix.

  it("an unrecognized agent is idle under quiet and NOT under agent", () => {
    expect(isPromptIdle(IDLE, "quiet")).toBe(true);
    expect(isPromptIdle(IDLE, "agent")).toBe(false);
    // `null` is the same unknown wearing the other spelling — a fold that
    // answered them differently would be a coin toss on which one padi stored.
    expect(isPromptIdle({ ...IDLE, agent: null }, "agent")).toBe(false);
  });

  it("quiet remains the DEFAULT — an ordinary submit is untouched", () => {
    // The field report confirms the ordinary dispatch path works against real
    // claude, including into a bare shell that has no agent at all. Requiring an
    // agent there would break every non-agent terminal.
    expect(isPromptIdle(IDLE)).toBe(true);
  });

  it("a recognized agent at rest is idle under BOTH", () => {
    for (const state of ["waiting", "awaiting_user"] as const) {
      expect(isPromptIdle({ ...IDLE, agent: agent(state) }, "agent")).toBe(
        true,
      );
      expect(isPromptIdle({ ...IDLE, agent: agent(state) }, "quiet")).toBe(
        true,
      );
    }
  });

  it("a recognized agent that is WORKING is not idle under either", () => {
    for (const state of [
      "thinking",
      "tool_use",
      "running_background",
    ] as const) {
      expect(isPromptIdle({ ...IDLE, agent: agent(state) }, "agent")).toBe(
        false,
      );
      expect(isPromptIdle({ ...IDLE, agent: agent(state) }, "quiet")).toBe(
        false,
      );
    }
  });

  it("a recognized agent still has to be QUIET — recognition is not a bypass", () => {
    // Both conjuncts, not either: an agent that reports `waiting` while its
    // screen is still repainting is mid-paint, and typing into that is the same
    // loss by a different route.
    expect(
      isPromptIdle({ ...IDLE, agent: agent("waiting"), noisy: true }, "agent"),
    ).toBe(false);
  });
});

describe("submitInput under readiness: agent — the boot brief", () => {
  it("REFUSES a terminal that never presents an agent, having typed NOTHING", async () => {
    // The reported loss, at the sequence level. The observation is exactly what
    // padi saw in the field: live, quiet, feed up — and no agent, because the
    // shell had not finished exec'ing claude. Under the old rule this typed the
    // brief into that gap and pressed Enter into a TUI that then initialized and
    // discarded it, while the call reported success.
    const writes: string[] = [];
    const watch = scriptedWatch([IDLE]);
    const outcome = await submitInput({
      watch,
      write: (d) => writes.push(d),
      data: "read /tmp/brief.md and take it end-to-end",
      timeoutMs: 500,
      clock: steppingClock(100),
      readiness: "agent",
    });

    // The refusal names WHY, because "busy" would send the caller to wait for a
    // turn that is not running and retry into the same bound.
    expect(outcome).toMatchObject({
      kind: "refused",
      phase: "ready",
      reason: "unrecognized",
    });
    // The assertion the bug is about: nothing reached the terminal. A brief that
    // is refused costs a retry; a brief that is typed into a booting TUI is gone
    // and the caller is told it landed.
    expect(writes).toEqual([]);
  });

  it("delivers as soon as the agent IS recognized — the wait is not a refusal", async () => {
    // The other half, and the one that would make this fix useless if it failed:
    // an agent that shows up a few polls into boot is briefed normally.
    const writes: string[] = [];
    const watch = scriptedWatch([
      IDLE, // booting: quiet, nobody home
      IDLE,
      { ...IDLE, agent: agent("waiting") }, // claude registered, at its prompt
    ]);
    const outcome = await submitInput({
      watch,
      write: (d) => writes.push(d),
      data: "carry out the plan",
      timeoutMs: 5_000,
      clock: steppingClock(10),
      readiness: "agent",
    });

    expect(outcome).toMatchObject({ kind: "submitted" });
    expect(writes).toEqual(["carry out the plan", "\r"]);
  });

  it("a busy agent is still `busy`, not `unrecognized`", async () => {
    // The two refusals must stay distinguishable: this one really does mean
    // "wait for the turn to end and dispatch again".
    const watch = scriptedWatch([{ ...IDLE, agent: agent("thinking") }]);
    const outcome = await submitInput({
      watch,
      write: () => {},
      data: "brief",
      timeoutMs: 300,
      clock: steppingClock(100),
      readiness: "agent",
    });

    expect(outcome).toMatchObject({ phase: "ready", reason: "busy" });
  });
});
