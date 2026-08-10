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

/** A live terminal whose agent is BLOCKED on a person — the case where a human
 *  may be mid-answer at that same prompt. */
const awaitingAgentTerminal = (): PadiTerminal =>
  composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot(makeAgent("awaiting_user")),
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
function harness(
  parent: PadiTerminal | undefined,
  /** What the LIVE write path answers — false stands for "the supervisor stopped
   *  being an agent terminal between the observed frame and this deferred
   *  flush", the one guard that must hold at the instant bytes move. */
  writeLands = true,
) {
  const writes: Array<{ id: string; data: string }> = [];
  const warnings: unknown[] = [];
  const delivery = createSupervisionDelivery({
    write: (id, data) => {
      if (!writeLands) return false;
      writes.push({ id, data });
      return true;
    },
    log: {
      ...(silentLog as object),
      warn: (...args: unknown[]) => warnings.push(args),
    } as unknown as Parameters<typeof createSupervisionDelivery>[0]["log"],
  });
  const frame = new Map<TerminalId, PadiTerminal>();
  if (parent !== undefined) frame.set("supervisor-1" as TerminalId, parent);
  return {
    writes,
    warnings,
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
    const { writes, warnings, deliver } = harness(humanShell());
    deliver(event());
    expect(writes).toEqual([]);
    // A by-design skip over a LIVE terminal: the human has the canvas, the Dock
    // and an OS notification for this. Not a warning — it would fire constantly.
    expect(warnings).toEqual([]);
  });

  it("never writes into a dormant terminal — and REFUSES to do it quietly", () => {
    const { writes, warnings, deliver } = harness(sleepingTerminal());
    deliver(event());
    expect(writes).toEqual([]);
    // This skip loses the EDGE for good: there is no mailbox now and no second
    // chance on wake. The fact survives in `urgency` and in the standing
    // subscriptions, but an undeliverable supervision edge must never be
    // silent — silence is what this whole flow exists to remove.
    expect(warnings).toHaveLength(1);
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

  // THE INJECTION GUARD. `intent` is free-form multi-line markdown (the editor is
  // a <textarea>; the schema constrains only non-emptiness), and this module's
  // write is terminated by `\r`. Interpolating it raw does not merely render
  // badly — every embedded newline SUBMITS, so one nudge becomes several lines
  // entered at a supervisor's agent prompt, the tail of them chosen by whoever
  // wrote the intent.
  it("FLATTENS a multi-line intent — no interior submit can ride the nudge", () => {
    const { writes, deliver } = harness(agentTerminal());
    deliver(event({ intent: "fix the parser\nrm -rf /\rsudo reboot" }));
    expect(writes).toHaveLength(1);
    const data = writes[0]?.data ?? "";
    expect(data).not.toContain("\n");
    // Exactly one CR, and it is the final submit.
    expect(data.split("\r")).toHaveLength(2);
    expect(data.endsWith("\r")).toBe(true);
    // The text survives — flattened, not dropped.
    expect(data).toContain("fix the parser");
  });

  it("strips ESC so no control sequence can be smuggled through an intent", () => {
    const text = nudgeText([event({ intent: "[2J[1;1Hwiped" })]);
    expect(text).not.toContain("");
    expect(text).toContain("wiped");
  });

  it("caps a runaway intent rather than pasting a document into the mailbox", () => {
    const text = nudgeText([event({ intent: "x".repeat(500) })]);
    expect(text.length).toBeLessThan(250);
    expect(text).toContain("…");
  });

  it("never cuts a grapheme in half — intents are emoji-bearing by design", () => {
    // The intent editor ships an emoji quick-row and `🔧 parser refactor` is the
    // documented example, so a truncation that slices UTF-16 code units emits a
    // LONE SURROGATE onto the very PTY the sanitizer above just protected.
    const text = nudgeText([
      event({
        intent: `${"a".repeat(58)}🚀 and a long tail beyond the budget`,
      }),
    ]);
    expect(text).toContain("…");
    // No unpaired surrogate anywhere in what would be written.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)).toBe(false);
    // And a ZWJ cluster survives whole rather than losing its joiners.
    const zwj = nudgeText([
      event({ intent: `${"b".repeat(59)}👨‍👩‍👧 tail beyond the budget` }),
    ]);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(zwj)).toBe(false);
  });

  it("re-checks the human-shell guard at WRITE time, not just on the frame", () => {
    // The frame says agent; the live write path says the agent has since exited.
    // The deferred flush must believe the live state — a live PTY proves a
    // terminal exists, never that an agent still owns it.
    const { writes, deliver } = harness(agentTerminal(), false);
    deliver(event());
    expect(writes).toEqual([]);
  });

  it("DOES write into an agent terminal whose agent is awaiting a human — the accepted tradeoff", () => {
    // Deliberate and documented (website/src/content/docs/mcp.mdx): an agent
    // terminal is written to whatever it is doing. Skipping here would invent a
    // second silent drop, and a supervisor blocked on its own question is
    // exactly the one that needs to know a worker moved. The docs warn a human
    // composing an answer that the line will join their input.
    const { writes, deliver } = harness(awaitingAgentTerminal());
    deliver(event());
    expect(writes).toHaveLength(1);
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
      write: (id, data) => {
        writes.push({ id, data });
        return true;
      },
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
