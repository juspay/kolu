/**
 * Pins the push→pull bridge under the `watchStates` member — the seam between an
 * engine that CALLS you when something comes due and a surface stream that is
 * PULLED.
 *
 * Three properties, each of which is a silent failure if it breaks: the first
 * frame is the snapshot (a fence re-subscribe re-leads with fresh truth); a nag
 * that fires while nobody is pulling is still delivered on the next pull (a
 * supervisor mid-write must not lose the report); and ending the consumption
 * unsubscribes (a hung-up `kolu watch` must not leave the daemon holding a
 * timer for it).
 */

import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { Stream } from "effect";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { PadiStateEvent, PadiTerminal } from "../surface.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "../vocab.ts";
import { createEventSeq } from "./eventSeq.ts";
import { createStateWatchHub, type ScheduleTimer } from "./stateWatch.ts";
import { stateWatchSource } from "./stateWatchStream.ts";

const silentLogger = pino({ level: "silent" });

function waiting(): PadiTerminal {
  const agent: AgentInfo = {
    kind: "claude-code",
    state: "waiting",
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
  };
  return composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot,
  );
}

function harness() {
  let clock = 10_000;
  let armed: { at: number; fire: () => void } | undefined;
  const schedule: ScheduleTimer = (delayMs, fire) => {
    const at = clock + delayMs;
    armed = { at, fire };
    return () => {
      if (armed?.fire === fire) armed = undefined;
    };
  };
  const hub = createStateWatchHub({
    log: silentLogger,
    seq: createEventSeq(),
    now: () => clock,
    schedule,
  });
  hub.observe(new Map([["a" as TerminalId, waiting()]]));
  return {
    hub,
    armedAt: () => armed?.at,
    advance(ms: number) {
      clock += ms;
      while (armed !== undefined && armed.at <= clock) {
        const { fire } = armed;
        armed = undefined;
        fire();
      }
    },
  };
}

const NAG = {
  states: new Set(["waiting"] as const),
  heldForMs: 0,
  nagMs: 1_000,
};

function pull(hub: ReturnType<typeof harness>["hub"]) {
  const stream: Stream.Stream<readonly PadiStateEvent[]> = stateWatchSource(
    hub,
    NAG,
    silentLogger,
  );
  return Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
}

describe("stateWatchSource", () => {
  it("leads with the SNAPSHOT — the frame a re-subscribe re-seeds from", async () => {
    const h = harness();
    const it = pull(h.hub);
    const first = await it.next();
    expect(
      (first.value as readonly PadiStateEvent[]).map((e) => [e.kind, e.id]),
    ).toEqual([["snapshot", "a"]]);
    await it.return?.();
  });

  it("delivers a nag that fired while NOBODY was pulling", async () => {
    const h = harness();
    const it = pull(h.hub);
    await it.next();
    // The consumer is off writing to a slow pipe; the interval does not wait
    // for it, and the report must not be dropped on the floor.
    h.advance(1_000);
    h.advance(1_000);
    const a = await it.next();
    const b = await it.next();
    expect((a.value as readonly PadiStateEvent[])[0]?.kind).toBe("nag");
    expect((b.value as readonly PadiStateEvent[])[0]?.kind).toBe("nag");
    await it.return?.();
  });

  it("wakes a consumer that is already waiting when the nag fires", async () => {
    const h = harness();
    const it = pull(h.hub);
    await it.next();
    const pending = it.next();
    h.advance(1_000);
    expect(((await pending).value as readonly PadiStateEvent[])[0]?.kind).toBe(
      "nag",
    );
    await it.return?.();
  });

  it("UNSUBSCRIBES when the consumer ends — a hung-up watch stops holding the clock", async () => {
    const h = harness();
    const it = pull(h.hub);
    await it.next();
    expect(h.armedAt()).toBeDefined();
    await it.return?.();
    expect(h.armedAt()).toBeUndefined();
  });
});
