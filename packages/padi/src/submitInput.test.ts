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
      typedBytes: 14,
      timeoutMs: 5_000,
      clock: steppingClock(10),
    });

    expect(outcome).toMatchObject({ kind: "submitted", typedBytes: 14 });
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
      typedBytes: 2,
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
      typedBytes: 14,
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
      typedBytes: 5,
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
      typedBytes: 5,
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
      typedBytes: 5,
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
      typedBytes: 5,
      timeoutMs: 60_000,
      clock: steppingClock(10),
      signal: abort.signal,
    });

    expect(outcome).toMatchObject({ kind: "refused", phase: "ready" });
    expect(writes).toEqual([]);
  });
});
