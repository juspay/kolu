import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  frame,
  makeAgent,
  silentLogger,
} from "../attention/attentionFixture.testlib.ts";
import { createFleetGate } from "../attention/fleetGate.ts";
import { createFinishQuiet } from "./finishQuiet.ts";
import { EMPTY_URGENCY } from "./urgency.ts";

const QUIET = 100;
const T = "survivor" as TerminalId;

function redeployedPadi() {
  const gate = createFleetGate();
  const finish = createFinishQuiet({
    log: silentLogger,
    idleAfterMs: QUIET,
    standingSub: false,
  });
  const published: PadiUrgency[] = [];
  const fold = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): PadiUrgency => {
    const next = gate.admit(terminals)
      ? finish.project(terminals)
      : EMPTY_URGENCY;
    published.push(next);
    return next;
  };
  return {
    gate,
    fold,
    published,
    dispose() {
      finish.dispose();
      gate.dispose();
    },
  };
}

describe("a redeploy at the fold — a survivor already idle is not news", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a survivor already idle, whatever it was doing when kolu went down, is finished in the first settled frame, never lingering", () => {
    const padi = redeployedPadi();
    try {
      padi.fold(frame());
      padi.gate.awaitFirstRead(T);
      expect(padi.fold(frame({ [T]: { agent: null } }))).toEqual(EMPTY_URGENCY);
      const read = frame({ [T]: { agent: makeAgent("waiting") } });
      expect(padi.fold(read).settled).toBe(false);
      padi.gate.firstRead(T);
      expect(padi.fold(read)).toEqual({
        awaitingIds: [],
        finishedIds: [T],
        workingIds: [],
        lingerIds: [],
        settled: true,
      });
      vi.advanceTimersByTime(QUIET * 3);
      expect(padi.fold(read).finishedIds).toEqual([T]);
      expect(padi.published.some((u) => u.lingerIds.includes(T))).toBe(false);
    } finally {
      padi.dispose();
    }
  });

  it("a survivor whose agent quit while kolu was down is in no list, and the fleet still settles", () => {
    const padi = redeployedPadi();
    try {
      padi.fold(frame());
      padi.gate.awaitFirstRead(T);
      const shell = frame({ [T]: { agent: null } });
      expect(padi.fold(shell).settled).toBe(false);
      padi.gate.firstRead(T);
      expect(padi.fold(shell)).toEqual({
        ...EMPTY_URGENCY,
        settled: true,
      });
    } finally {
      padi.dispose();
    }
  });

  it("a survivor asking on screen is asking in the first settled frame, never working", () => {
    const padi = redeployedPadi();
    try {
      padi.fold(frame());
      padi.gate.awaitFirstRead(T);
      padi.fold(frame({ [T]: { agent: null } }));
      padi.fold(frame({ [T]: { agent: makeAgent("tool_use") } }));
      const asking = frame({ [T]: { agent: makeAgent("awaiting_user") } });
      padi.fold(asking);
      padi.gate.firstRead(T);
      expect(padi.fold(asking)).toEqual({
        awaitingIds: [T],
        finishedIds: [],
        workingIds: [],
        lingerIds: [],
        settled: true,
      });
      expect(padi.published.some((u) => u.workingIds.includes(T))).toBe(false);
    } finally {
      padi.dispose();
    }
  });
});
