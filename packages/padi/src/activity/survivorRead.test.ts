/**
 * The redeploy, at the fold: padi's `urgency` value as `servePadi` derives it —
 * the fleet gate first, then `finishQuiet` — over the frames a redeploy really
 * produces. A fresh padi adopts kaval's surviving terminals with NO agent on
 * them, and its sensors read each agent a moment later.
 *
 * The reproduced bug: the agentless frame was admitted, `finishQuiet` spent its
 * "already idle on the first real frame is not news" rule on it, and every idle
 * agent then arrived as a brand-new turn — 5 s of `linger`, then a fresh
 * `finished` that every browser rang for. With the gate holding the attention
 * feed until each survivor has been read once, the first frame `finishQuiet`
 * sees has the agents in it, and its existing rule does the rest.
 */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
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

/** padi's urgency derivation, over a gate and a quiet tracker — the shape of
 *  `servePadi`'s `urgency` cell. Every value it produces is recorded. */
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

  // What the agent was doing when kolu went down does not reach the new padi:
  // the adopted record carries no agent either way (`adoptedSnapshot`), and the
  // first thing padi knows is what its sensors read now. Both are pinned so a
  // later change that DID carry the saved state across is made on purpose.
  it.each<[string, AgentInfo["state"]]>([
    ["already finished when kolu went down", "waiting"],
    ["working when kolu went down, finished while it was down", "waiting"],
  ])("%s: finished in the first settled frame, never lingering", (_, now) => {
    const padi = redeployedPadi();
    try {
      // Serve time: nothing adopted.
      padi.fold(frame());
      // Adoption names the survivor, then registers it with no agent.
      padi.gate.awaitFirstRead(T);
      expect(padi.fold(frame({ [T]: { agent: null } }))).toEqual(EMPTY_URGENCY);
      // The detectors read the agent; the record moves before the last of
      // them reports, so this frame is still unread.
      const read = frame({ [T]: { agent: makeAgent(now) } });
      expect(padi.fold(read).settled).toBe(false);
      // The last detector has looked.
      padi.gate.firstRead(T);
      expect(padi.fold(read)).toEqual({
        awaitingIds: [],
        finishedIds: [T],
        workingIds: [],
        lingerIds: [],
        settled: true,
      });
      // And it stays finished: no quiet window was ever opened for it.
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
      // The detectors find a shell and publish nothing; only the report says
      // they looked.
      padi.gate.firstRead(T);
      expect(padi.fold(shell)).toEqual({
        ...EMPTY_URGENCY,
        settled: true,
      });
    } finally {
      padi.dispose();
    }
  });
});
