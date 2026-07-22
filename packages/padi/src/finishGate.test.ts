/**
 * The effective-finish gate's debounce core — with the transport injected (a fake
 * registry view + fake byte tap) so the timer logic is exercised directly:
 *   - a just-flipped-to-`waiting` terminal is HELD unsettled (default-excluded)
 *     and settles only after the quiet window elapses with no output;
 *   - output inside the window re-arms the debounce;
 *   - leaving `waiting` (or teardown) drops the terminal from the settled set.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishGate, type FinishGate } from "./finishGate.ts";

const QUIET = 200;
const RECONCILE = 50;
const A = "fin-a" as TerminalId;
const B = "fin-b" as TerminalId;

describe("createFinishGate", () => {
  let waiting: Map<TerminalId, string>;
  let outputHandlers: Map<TerminalId, () => void>;
  let closedHandlers: Map<TerminalId, () => void>;
  let closes: Map<TerminalId, () => void>;
  let gate: FinishGate;

  beforeEach(() => {
    vi.useFakeTimers();
    waiting = new Map();
    outputHandlers = new Map();
    closedHandlers = new Map();
    closes = new Map();
    gate = createFinishGate<string>({
      quietMs: QUIET,
      reconcileMs: RECONCILE,
      listWaiting: () => new Map(waiting),
      openTap: (id, _location, onOutput, onClosed) => {
        outputHandlers.set(id, onOutput);
        closedHandlers.set(id, onClosed);
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

  /** Drive the reconcile interval once so the gate re-reads `waiting`. */
  const reconcileTick = (): void => {
    vi.advanceTimersByTime(RECONCILE);
  };

  it("HOLDS a freshly-`waiting` terminal unsettled, then settles it after the quiet window", () => {
    waiting.set(A, "loc-a");
    reconcileTick(); // gate picks A up, seeds its quiet window
    expect(gate.settledFinished().has(A)).toBe(false);

    vi.advanceTimersByTime(QUIET);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("re-arms the debounce on output, so a still-noisy terminal never settles early", () => {
    waiting.set(A, "loc-a");
    reconcileTick();

    // Just shy of the window, a byte lands — the terminal is still working.
    vi.advanceTimersByTime(QUIET - 1);
    outputHandlers.get(A)?.();
    vi.advanceTimersByTime(QUIET - 1);
    expect(gate.settledFinished().has(A)).toBe(false);

    // Once it finally goes quiet for a full window, it settles.
    vi.advanceTimersByTime(1);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("drops a terminal from the settled set once it leaves `waiting`", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
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
    vi.advanceTimersByTime(QUIET); // A settles
    waiting.set(B, "loc-b");
    reconcileTick(); // B just picked up

    const settled = gate.settledFinished();
    expect(settled.has(A)).toBe(true);
    expect(settled.has(B)).toBe(false);

    vi.advanceTimersByTime(QUIET); // B settles too
    expect([...gate.settledFinished()].sort()).toEqual([A, B]);
  });

  it("does not settle a still-working terminal off a dead tap — re-taps with a fresh window", () => {
    // The failure the tap must NOT have: a transient kaval drop ends the byte tap
    // while the terminal is still `waiting` AND still live. If the gate believed it
    // was still watching, it would see no more output and settle the terminal after
    // the quiet window — a premature finish while background sub-agents keep working.
    waiting.set(A, "loc-a");
    reconcileTick(); // A tracked, seeded live (not yet settled)
    // The tap dies on its own (stream end / kaval drop) while A is still live.
    closedHandlers.get(A)?.();
    // A is dropped, not settled — a dead tap can't conclude quiet (default-excluded).
    expect(gate.settledFinished().has(A)).toBe(false);

    // The reconcile re-taps with a FRESH quiet window; A settles only after a full
    // window of real quiet on the NEW tap, never off the stale one.
    reconcileTick(); // re-tap (fresh seed)
    vi.advanceTimersByTime(QUIET - 1);
    expect(gate.settledFinished().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...gate.settledFinished()]).toEqual([A]);
  });

  it("keeps an already-settled terminal finished when its tap drops (the debounce is done)", () => {
    waiting.set(A, "loc-a");
    reconcileTick();
    vi.advanceTimersByTime(QUIET); // A settles — genuinely quiet for a full window
    expect(gate.settledFinished().has(A)).toBe(true);

    // A tap drop on an already-finished terminal must not un-finish it (no flicker).
    closedHandlers.get(A)?.();
    expect(gate.settledFinished().has(A)).toBe(true);
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
