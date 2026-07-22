/**
 * The effective-finish gate's debounce core — transport injected (a fake registry
 * view + fake byte tap) so the timer/state logic is exercised directly:
 *   - a `waiting` terminal settles only after its attach is READY and a full quiet
 *     window then elapses (it can't settle while the attach is still pending);
 *   - output inside the window re-arms the debounce, and output AFTER settling
 *     un-settles it (resumed background work);
 *   - a tap that drops is re-opened at the next reconcile — a still-working terminal
 *     is never settled off a dead tap, and an already-settled terminal keeps its
 *     level across the gap (no flicker) while still re-observing resumed output;
 *   - leaving `waiting` (or teardown) drops the terminal from the settled set.
 */

import { computed, derived } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishGate, type FinishGate } from "./finishGate.ts";

const QUIET = 200;
const RECONCILE = 50;
const A = "fin-a" as TerminalId;
const B = "fin-b" as TerminalId;

describe("createFinishGate", () => {
  let waiting: Map<TerminalId, string>;
  let ready: Map<TerminalId, () => void>;
  let output: Map<TerminalId, () => void>;
  let closed: Map<TerminalId, () => void>;
  let closes: Map<TerminalId, () => void>;
  let observe: (id: TerminalId, isWaiting: boolean) => void;
  let gate: FinishGate;

  beforeEach(() => {
    vi.useFakeTimers();
    waiting = new Map();
    ready = new Map();
    output = new Map();
    closed = new Map();
    closes = new Map();
    let observer: ((id: TerminalId, isWaiting: boolean) => void) | null = null;
    observe = (id, isWaiting) => observer?.(id, isWaiting);
    gate = createFinishGate<string>({
      quietMs: QUIET,
      reconcileMs: RECONCILE,
      listWaiting: () => new Map(waiting),
      subscribeAgentObservations: (cb) => {
        observer = cb;
        return () => {
          observer = null;
        };
      },
      openTap: (id, _location, handlers) => {
        // Latest tap wins (a re-tap replaces the handlers for this id).
        ready.set(id, handlers.onReady);
        output.set(id, handlers.onOutput);
        closed.set(id, handlers.onClosed);
        const close = vi.fn();
        closes.set(id, close);
        return close;
      },
    });
  });

  afterEach(() => {
    gate.dispose();
    vi.useRealTimers();
  });

  /** Drive the reconcile interval once so the gate re-reads `waiting` (and re-taps
   *  any dropped tap). */
  const reconcileTick = (): void => {
    vi.advanceTimersByTime(RECONCILE);
  };
  /** Simulate the terminal's attach establishing (a live observer exists). */
  const attach = (id: TerminalId): void => ready.get(id)?.();

  it("settles a `waiting` terminal only after attach is ready AND a full quiet window", () => {
    waiting.set(A, "loc-a");
    reconcileTick(); // A tracked, tap opening — attach not yet ready
    expect(gate.settledFinished().has(A)).toBe(false);

    attach(A); // attach established — the quiet window starts here
    vi.advanceTimersByTime(QUIET - 1);
    expect(gate.settledFinished().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("does NOT settle while the attach is still pending (never ready)", () => {
    waiting.set(A, "loc-a");
    reconcileTick(); // tap opening, onReady never fires — a slow/wedged attach
    vi.advanceTimersByTime(QUIET * 3);
    expect(gate.settledFinished().has(A)).toBe(false);

    attach(A); // once it finally attaches, the window starts
    vi.advanceTimersByTime(QUIET);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("re-arms the debounce on output, so a still-noisy terminal never settles early", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A);

    vi.advanceTimersByTime(QUIET - 1);
    output.get(A)?.(); // a byte lands — still working
    vi.advanceTimersByTime(QUIET - 1);
    expect(gate.settledFinished().has(A)).toBe(false);

    vi.advanceTimersByTime(1);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("does not settle a still-working terminal off a dead tap — re-taps and re-observes", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A); // live, not yet settled

    closed.get(A)?.(); // the tap dies mid-window (transient kaval drop)
    // A is not-yet-settled and its quiet timer was dropped — it can't settle off a
    // dead tap.
    vi.advanceTimersByTime(QUIET * 2);
    expect(gate.settledFinished().has(A)).toBe(false);

    reconcileTick(); // reconcile re-opens the tap
    attach(A); // the new attach establishes — window restarts
    vi.advanceTimersByTime(QUIET);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("keeps an already-settled terminal across a tap drop (no flicker) and un-settles it on resumed output", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A);
    vi.advanceTimersByTime(QUIET); // A settles — genuinely quiet for a full window
    expect(gate.settledFinished().has(A)).toBe(true);

    closed.get(A)?.(); // tap drops on an already-finished terminal
    expect(gate.settledFinished().has(A)).toBe(true); // sticky — no flicker

    reconcileTick(); // re-tap
    attach(A);
    expect(gate.settledFinished().has(A)).toBe(true); // still finished after re-attach

    output.get(A)?.(); // background sub-agents resume — real output un-settles it
    expect(gate.settledFinished().has(A)).toBe(false);
  });

  it("drops a terminal from the settled set once it leaves `waiting`", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A);
    vi.advanceTimersByTime(QUIET);
    expect(gate.settledFinished().has(A)).toBe(true);

    waiting.delete(A); // agent moved on (working / awaiting / gone)
    reconcileTick();
    expect(gate.settledFinished().has(A)).toBe(false);
    expect(closes.get(A)).toHaveBeenCalledTimes(1);
  });

  it("debounces each terminal independently", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A);
    vi.advanceTimersByTime(QUIET); // A settles
    waiting.set(B, "loc-b");
    reconcileTick();
    attach(B); // B just attached

    const s = gate.settledFinished();
    expect(s.has(A)).toBe(true);
    expect(s.has(B)).toBe(false);

    vi.advanceTimersByTime(QUIET); // B settles too
    expect([...gate.settledFinished()].sort()).toEqual([A, B]);
  });

  it("makes a NEW waiting episode earn a fresh window — a settled turn does not carry over a poll-missed working blip", () => {
    // F1: A settles on turn 1. Its agent then cycles waiting → working → waiting
    // FASTER than one reconcile poll, so `waiting` (the poll's view) never drops A.
    // The agent-observation edge (the commit firehose) catches the blip: it must
    // drop the stale settle on leave and re-arm a fresh window on re-entry, so the
    // second turn cannot fire a premature finish (the exact background-sub-agent case).
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A);
    vi.advanceTimersByTime(QUIET);
    expect(gate.settledFinished().has(A)).toBe(true); // turn 1 finished

    observe(A, false); // agent left waiting (working) — poll misses it
    expect(gate.settledFinished().has(A)).toBe(false); // stale settle dropped at once
    observe(A, true); // agent back to waiting (turn 2, background work launched)
    // Must NOT immediately re-settle off turn 1 — a fresh window is required.
    expect(gate.settledFinished().has(A)).toBe(false);
    vi.advanceTimersByTime(QUIET - 1);
    expect(gate.settledFinished().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...gate.settledFinished()]).toEqual([A]); // settles only after the fresh window
  });

  it("fences a stale tap's late onReady from a newer tap generation", () => {
    // F3: a pending attach (T1) is aborted when the terminal leaves waiting, then the
    // same id re-enters and opens a new pending attach (T2). T1's attach can still
    // resolve late and call its onReady — it must NOT ready T2's generation.
    waiting.set(A, "loc-a");
    reconcileTick(); // opens T1 (pending — no attach yet)
    const staleReady = ready.get(A); // capture T1's onReady before it's replaced

    waiting.delete(A);
    reconcileTick(); // A leaves waiting → T1 aborted, A untracked
    waiting.set(A, "loc-a");
    reconcileTick(); // A re-enters → opens T2 (pending); ready.get(A) is now T2's onReady

    staleReady?.(); // T1's late onReady — must be fenced (wrong generation)
    vi.advanceTimersByTime(QUIET * 2);
    expect(gate.settledFinished().has(A)).toBe(false); // T2 never became ready

    attach(A); // T2's real onReady
    vi.advanceTimersByTime(QUIET);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("does not manufacture readiness on re-entry when the tap is still PENDING", () => {
    // F3 (round 3): a poll-missed episode blip must NOT let a re-entry start a quiet
    // window on a tap that has never attached — that would settle with no observer.
    waiting.set(A, "loc-a");
    reconcileTick(); // T1 opened, PENDING — attach() deliberately not called
    observe(A, false); // leave waiting
    observe(A, true); // re-enter (before reconcile) — tap still pending

    vi.advanceTimersByTime(QUIET * 2);
    expect(gate.settledFinished().has(A)).toBe(false); // never attached → never settles

    attach(A); // the pending tap finally establishes — window starts here
    vi.advanceTimersByTime(QUIET);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("does not settle across a poll-missed episode blip when the tap has CLOSED", () => {
    // F3 (round 3): the same must hold when the observer is gone (tap dropped) — a
    // re-entry must wait for the replacement tap to attach, not settle on the dead one.
    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A);
    closed.get(A)?.(); // tap drops (attached cleared) while still tracked
    observe(A, false); // leave waiting
    observe(A, true); // re-enter — the tap is gone, so no observer

    vi.advanceTimersByTime(QUIET * 2);
    expect(gate.settledFinished().has(A)).toBe(false); // not attached → not settled

    reconcileTick(); // reconcile re-taps
    attach(A); // replacement tap attaches — fresh window
    vi.advanceTimersByTime(QUIET);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("publishes NO transient finish when an attached terminal leaves waiting mid-window", () => {
    // F5 (round 4): leaving waiting must fence the settle listener BEFORE dropping the
    // quiet timer — `tracker.forget` notifies synchronously, so if `awaitingRearm` isn't
    // set first, the settle loop briefly sees an attached, not-yet-fenced, now-quiet
    // terminal and emits a transient false finish. Record EVERY emitted frame (an eager
    // reactor effect over the gate's settled level) and assert A never appears.
    const frames: TerminalId[][] = [];
    const observed = derived.cell(computed(() => [...gate.settledFinished()]));
    const stop = observed.connect({
      set: (v) => frames.push(v as TerminalId[]),
    });

    waiting.set(A, "loc-a");
    reconcileTick();
    attach(A); // A is attached and live — its quiet window is running
    vi.advanceTimersByTime(QUIET / 2); // partway through the window (not settled)
    expect(gate.settledFinished().has(A)).toBe(false);

    observe(A, false); // agent leaves waiting mid-window
    // No frame — transient or final — may ever contain A.
    expect(frames.every((f) => !f.includes(A))).toBe(true);
    expect(gate.settledFinished().has(A)).toBe(false);

    if (typeof stop === "function") stop();
  });

  it("closes every tap on dispose", () => {
    waiting.set(A, "loc-a");
    waiting.set(B, "loc-b");
    reconcileTick();
    gate.dispose();
    expect(closes.get(A)).toHaveBeenCalledTimes(1);
    expect(closes.get(B)).toHaveBeenCalledTimes(1);
  });
});
