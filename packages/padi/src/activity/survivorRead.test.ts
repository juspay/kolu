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
import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeTerminal,
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
  // the adopted record carries no agent (`adoptedSnapshot`), and the first
  // thing padi knows is what its sensors read now — so an agent that was
  // working when kolu went down and finished meanwhile is this same case.
  it("a survivor already idle, whatever it was doing when kolu went down, is finished in the first settled frame, never lingering", () => {
    const padi = redeployedPadi();
    try {
      // Serve time: nothing adopted.
      padi.fold(frame());
      // Adoption names the survivor, then registers it with no agent.
      padi.gate.awaitFirstRead(T);
      expect(padi.fold(frame({ [T]: { agent: null } }))).toEqual(EMPTY_URGENCY);
      // The detectors read the agent; the record moves before the last of
      // them reports, so this frame is still unread.
      const read = frame({ [T]: { agent: makeAgent("waiting") } });
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

  it("a survivor asking on screen is asking in the first settled frame, never working", () => {
    // Its transcript says `tool_use`; the question is on the screen, and the
    // detector's first pass waits for that read (`startAgentSensor`). Every
    // frame before the report is unsettled, so no reader sees it working.
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

/** A saved terminal the boot puts back asleep: registered, never adopted. */
function sleepingTerminal(): PadiTerminal {
  return composeTerminalMetadata(
    {
      state: "sleeping",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      sleptAt: 0,
    },
    {
      cwd: "/tmp",
      git: { kind: "none" },
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
    },
  );
}

/** The boot's registrations, one fold each, in the order the boot makes them
 *  (`adoptSurvivingSession` walks the saved session in its saved order): a
 *  sleeping record is registered with no word to the gate
 *  (`seedSleepingTerminal`); a survivor is announced to the gate
 *  (`markAwaitingFirstRead`) and then registered with no agent. */
type BootStep =
  | { readonly kind: "sleep"; readonly id: TerminalId }
  | { readonly kind: "adopt"; readonly id: TerminalId };

const SLEEPER = "sleeper" as TerminalId;
const A = "agent-a" as TerminalId;
const B = "agent-b" as TerminalId;

describe("a redeploy at the fold — the saved session's order does not matter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each<[string, readonly BootStep[]]>([
    [
      "no sleeping terminal",
      [
        { kind: "adopt", id: A },
        { kind: "adopt", id: B },
      ],
    ],
    [
      "a sleeping terminal registered first",
      [
        { kind: "sleep", id: SLEEPER },
        { kind: "adopt", id: A },
        { kind: "adopt", id: B },
      ],
    ],
    [
      "a sleeping terminal registered second",
      [
        { kind: "adopt", id: A },
        { kind: "sleep", id: SLEEPER },
        { kind: "adopt", id: B },
      ],
    ],
  ])("%s: every settled frame has both idle survivors finished", (_, boot) => {
    const padi = redeployedPadi();
    const registry = new Map<TerminalId, PadiTerminal>();
    const fold = (): PadiUrgency => padi.fold(new Map(registry));
    try {
      // Serve time: nothing registered.
      fold();
      for (const step of boot) {
        if (step.kind === "adopt") padi.gate.awaitFirstRead(step.id);
        registry.set(
          step.id,
          step.kind === "sleep"
            ? sleepingTerminal()
            : activeTerminal({ agent: null }),
        );
        fold();
      }
      // The boot says adoption is finished.
      padi.gate.establish();
      fold();
      // The sensors read each idle agent, then report their first pass.
      for (const id of [A, B]) {
        registry.set(id, activeTerminal({ agent: makeAgent("waiting") }));
        fold();
        padi.gate.firstRead(id);
        fold();
      }
      vi.advanceTimersByTime(QUIET * 3);
      fold();

      const settled = padi.published.filter((u) => u.settled);
      expect(settled.length).toBeGreaterThan(0);
      for (const u of settled) {
        expect(u).toEqual({
          awaitingIds: [],
          finishedIds: [A, B],
          workingIds: [],
          lingerIds: [],
          settled: true,
        });
      }
    } finally {
      padi.dispose();
    }
  });
});
