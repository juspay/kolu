/**
 * Pins the supervision-edge delivery — above all its GUARD. The feature writes
 * into somebody's terminal, so "who never gets written to" is the load-bearing
 * assertion here, not an edge case.
 */

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

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof createSupervisionDelivery>[0]["log"];

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

/** Build a delivery over a fixed parent record, capturing what it wrote. */
function harness(parent: PadiTerminal | undefined) {
  const writes: Array<{ id: string; data: string }> = [];
  const delivery = createSupervisionDelivery({
    lookup: () => parent,
    write: (id, data) => writes.push({ id, data }),
    log: silentLog,
  });
  return { writes, delivery };
}

describe("supervision delivery", () => {
  it("writes into the SUPERVISOR's mailbox, not the worker's, and submits the line", () => {
    const { writes, delivery } = harness(agentTerminal());
    delivery.deliver(event());
    expect(writes).toHaveLength(1);
    expect(writes[0]?.id).toBe("supervisor-1");
    // The trailing CR is what re-invokes the supervisor. Without it the nudge
    // sits unsent in an input buffer — discovered, not delivered.
    expect(writes[0]?.data.endsWith("\r")).toBe(true);
    expect(writes[0]?.data).toContain("worker-1");
  });

  it("NEVER writes into a human's shell — the guard the whole feature rests on", () => {
    const { writes, delivery } = harness(humanShell());
    delivery.deliver(event());
    expect(writes).toEqual([]);
  });

  it("never writes into a sleeping/parked terminal (no live PTY behind it)", () => {
    const { writes, delivery } = harness(sleepingTerminal());
    delivery.deliver(event());
    expect(writes).toEqual([]);
  });

  it("a ROOT terminal's settle delivers nowhere — nobody spawned it", () => {
    const { writes, delivery } = harness(agentTerminal());
    const rootEvent: SettleEvent = {
      seq: 1,
      id: "root" as TerminalId,
      kind: "finished",
      at: 1,
    };
    delivery.deliver(rootEvent);
    expect(writes).toEqual([]);
  });

  it("a supervisor that has been killed is a quiet no-op, not a throw", () => {
    const { writes, delivery } = harness(undefined);
    expect(() => delivery.deliver(event())).not.toThrow();
    expect(writes).toEqual([]);
  });

  it("distinguishes asking from finished, and names the intent when there is one", () => {
    expect(nudgeText(event({ kind: "asking" }))).toContain("asking for input");
    expect(nudgeText(event({ kind: "finished" }))).toContain(
      "finished its turn",
    );
    expect(nudgeText(event({ intent: "fix the flaky test" }))).toContain(
      "(fix the flaky test)",
    );
  });

  it("tells a supervisor its worker is GONE rather than leaving it waiting", () => {
    const { writes, delivery } = harness(agentTerminal());
    delivery.deliver(event({ kind: "gone" }));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toContain("is gone");
    // Nothing to read — a departed terminal has no screen, so the nudge must not
    // send its supervisor to look for one.
    expect(writes[0]?.data).not.toContain("screen_text");
  });

  it("the nudge carries the id a supervisor needs to read the screen, and no transcript", () => {
    const text = nudgeText(event());
    expect(text).toContain("worker-1");
    expect(text).toContain("screen_text");
    // A single line — delivery must not paste another agent's output into the
    // supervisor's mailbox.
    expect(text).not.toContain("\n");
  });
});
