/**
 * The effective-finish gate's debounce core — with the transport injected (a fake
 * registry view + fake byte tap) so the timer logic is exercised directly:
 *   - a just-flipped-to-`waiting` terminal is HELD unsettled (default-excluded)
 *     and settles only after the quiet window elapses with no output;
 *   - output inside the window re-arms the debounce;
 *   - leaving `waiting` (or teardown) drops the terminal from the settled set.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishGate, type FinishGate } from "./finishGate.ts";

const QUIET = 200;
const RECONCILE = 50;
const A = "fin-a" as TerminalId;
const B = "fin-b" as TerminalId;

const noopLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

describe("createFinishGate", () => {
  let waiting: Map<TerminalId, string>;
  let outputHandlers: Map<TerminalId, () => void>;
  let closes: Map<TerminalId, () => void>;
  let gate: FinishGate;

  beforeEach(() => {
    vi.useFakeTimers();
    waiting = new Map();
    outputHandlers = new Map();
    closes = new Map();
    gate = createFinishGate<string>({
      log: noopLog,
      quietMs: QUIET,
      reconcileMs: RECONCILE,
      listWaiting: () => new Map(waiting),
      openTap: (id, _location, onOutput) => {
        outputHandlers.set(id, onOutput);
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

  it("closes every tap on dispose", () => {
    waiting.set(A, "loc-a");
    waiting.set(B, "loc-b");
    reconcileTick();
    gate.dispose();
    expect(closes.get(A)).toHaveBeenCalledTimes(1);
    expect(closes.get(B)).toHaveBeenCalledTimes(1);
  });
});
