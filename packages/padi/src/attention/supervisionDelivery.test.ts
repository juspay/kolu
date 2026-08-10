/**
 * Pins the supervision-edge delivery — above all its GUARD. The feature writes
 * into somebody's terminal, so "who never gets written to" is the load-bearing
 * assertion here, not an edge case.
 */

import { pino } from "pino";
import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import type { PadiTerminal } from "../surface.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "../vocab.ts";
import type { SettleEvent } from "./settleEvents.ts";
import { createSupervisionDelivery, nudgeText } from "./supervisionDelivery.ts";

const silentLog = pino({ level: "silent" });

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

function snapshot(agent: AgentInfo | null): TerminalSnapshot {
  return {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
  };
}

/** A live terminal running an agent — a legitimate supervisor. */
const agentTerminal = (): PadiTerminal =>
  composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot(makeAgent("waiting")),
  );

/** A live terminal running NO agent — a person's shell. */
const humanShell = (): PadiTerminal =>
  composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot(null),
  );

/** A terminal whose PTY is released — dormant, nothing to write into. */
const sleepingTerminal = (): PadiTerminal =>
  composeTerminalMetadata(
    {
      state: "sleeping",
      sleptAt: 1_700_000_000_000,
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
    },
    snapshot(null),
  );

const event = (over: Partial<SettleEvent> = {}): SettleEvent => ({
  seq: 1,
  id: "worker-1" as TerminalId,
  kind: "finished",
  at: 1_700_000_000_000,
  parentId: "supervisor-1" as TerminalId,
  ...over,
});

/** Build a delivery over a fixed supervisor record, capturing what it wrote.
 *  `deliver` reads the supervisor out of the FRAME the events were computed
 *  from — the one the settle-event source hands its sinks — so the harness
 *  supplies that frame rather than a lookup function. */
function harness(parent: PadiTerminal | undefined) {
  const writes: Array<{ id: string; data: string }> = [];
  const delivery = createSupervisionDelivery({
    write: (id, data) => writes.push({ id, data }),
    log: silentLog,
  });
  const frame = new Map<TerminalId, PadiTerminal>();
  if (parent !== undefined) frame.set("supervisor-1" as TerminalId, parent);
  return {
    writes,
    deliver: (...events: SettleEvent[]) => delivery.deliver(events, frame),
  };
}

describe("supervision delivery", () => {
  it("writes into the SUPERVISOR's mailbox, not the worker's, and submits the line", () => {
    const { writes, deliver } = harness(agentTerminal());
    deliver(event());
    expect(writes).toHaveLength(1);
    expect(writes[0]?.id).toBe("supervisor-1");
    // The trailing CR is what re-invokes the supervisor. Without it the nudge
    // sits unsent in an input buffer — discovered, not delivered.
    expect(writes[0]?.data.endsWith("\r")).toBe(true);
    expect(writes[0]?.data).toContain("worker-1");
  });

  it("NEVER writes into a human's shell — the guard the whole feature rests on", () => {
    const { writes, deliver } = harness(humanShell());
    deliver(event());
    expect(writes).toEqual([]);
  });

  it("never writes into a sleeping/parked terminal (no live PTY behind it)", () => {
    const { writes, deliver } = harness(sleepingTerminal());
    deliver(event());
    expect(writes).toEqual([]);
  });

  it("a ROOT terminal's settle delivers nowhere — nobody spawned it", () => {
    const { writes, deliver } = harness(agentTerminal());
    const rootEvent: SettleEvent = {
      seq: 1,
      id: "root" as TerminalId,
      kind: "finished",
      at: 1,
    };
    deliver(rootEvent);
    expect(writes).toEqual([]);
  });

  it("a supervisor that has been killed is a quiet no-op, not a throw", () => {
    const { writes, deliver } = harness(undefined);
    expect(() => deliver(event())).not.toThrow();
    expect(writes).toEqual([]);
  });

  it("distinguishes asking from finished, and names the intent when there is one", () => {
    expect(nudgeText([event({ kind: "asking" })])).toContain(
      "asking for input",
    );
    expect(nudgeText([event({ kind: "finished" })])).toContain(
      "finished its turn",
    );
    expect(nudgeText([event({ intent: "fix the flaky test" })])).toContain(
      "(fix the flaky test)",
    );
  });

  it("tells a supervisor its worker is GONE rather than leaving it waiting", () => {
    const { writes, deliver } = harness(agentTerminal());
    deliver(event({ kind: "gone" }));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toContain("is gone");
    // Nothing to read — a departed terminal has no screen, so the nudge must not
    // send its supervisor to look for one.
    expect(writes[0]?.data).not.toContain("screen_text");
  });

  it("the nudge carries the id a supervisor needs to read the screen, and no transcript", () => {
    const text = nudgeText([event()]);
    expect(text).toContain("worker-1");
    expect(text).toContain("screen_text");
    // A single line — delivery must not paste another agent's output into the
    // supervisor's mailbox.
    expect(text).not.toContain("\n");
  });

  it("wakes a supervisor ONCE per frame, however many of its lanes moved", () => {
    const { writes, deliver } = harness(agentTerminal());
    // A kaval recycle retires every active id at once; `killAll` does the same.
    // That is ONE fact about the supervisor's campaign, so it is one submit into
    // its mailbox — not one per lane, which is what a per-event fan-out leaves.
    deliver(
      event({ id: "worker-1" as TerminalId, kind: "gone" }),
      event({ id: "worker-2" as TerminalId, kind: "gone" }),
      event({ id: "worker-3" as TerminalId, kind: "gone" }),
    );
    expect(writes).toHaveLength(1);
    for (const id of ["worker-1", "worker-2", "worker-3"]) {
      expect(writes[0]?.data).toContain(id);
    }
    // Still ONE line: a newline inside a PTY write would submit early.
    expect(writes[0]?.data.slice(0, -1)).not.toContain("\n");
    // And still one prefix, so the supervisor reads it as one kolu message.
    expect(writes[0]?.data.match(/\[kolu\]/g)).toHaveLength(1);
  });

  it("splits a frame BY supervisor — one worker's report never reaches another's boss", () => {
    const writes: Array<{ id: string; data: string }> = [];
    const delivery = createSupervisionDelivery({
      write: (id, data) => writes.push({ id, data }),
      log: silentLog,
    });
    const frame = new Map<TerminalId, PadiTerminal>([
      ["boss-a" as TerminalId, agentTerminal()],
      ["boss-b" as TerminalId, agentTerminal()],
    ]);
    delivery.deliver(
      [
        event({ id: "w1" as TerminalId, parentId: "boss-a" as TerminalId }),
        event({ id: "w2" as TerminalId, parentId: "boss-b" as TerminalId }),
      ],
      frame,
    );
    expect(writes.map((w) => w.id)).toEqual(["boss-a", "boss-b"]);
    expect(writes[0]?.data).toContain("w1");
    expect(writes[0]?.data).not.toContain("w2");
  });
});
