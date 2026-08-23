/**
 * The terminal FRAME every attention test drives, built once.
 *
 * Four test files in this directory feed the same shape — a composed
 * `PadiTerminal` with an agent in a named state, wrapped in the map padi's
 * `urgency` cell hands the sources. Each had its own copy, so a change to
 * `TerminalSnapshot` or to the authored record was a four-file edit, and the one
 * rule the helper encodes (below) was remembered four times.
 *
 * {@link scopeOf} is here for the same reason and no other: three of those files
 * had a byte-identical copy of it.
 *
 * `.testlib.ts`, per the repo's convention for a fixture shared between test
 * files — it forks nothing and is never reachable from production code.
 */

import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { pino } from "pino";
import type { PadiTerminal } from "../surface.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "../vocab.ts";
import { createEdgeMemory } from "./edgeMemory.ts";
import { createEventSeq, type EventSeq } from "./eventSeq.ts";
import { type WatchScope, watchScopeOf } from "./watchScope.ts";
import {
  createStateWatchHub,
  type ScheduleTimer,
  type StateWatchHub,
} from "./stateWatch.ts";

/** A logger that says nothing — these modules log defensively (a throwing sink,
 *  a re-questioned subscription) and a test asserting on behaviour does not want
 *  the noise. */
export const silentLogger = pino({ level: "silent" });

export function makeAgent(state: AgentInfo["state"]): AgentInfo {
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

export interface TerminalFixture {
  agent?: AgentInfo | null;
  parentId?: string;
  intent?: string;
  /** The RECENCY stamp — the record field that actually churns under a
   *  repainting agent. padi's fold stamps it from a live agent observation and
   *  again, throttled, from a same-identity DETAIL tick (an agent producing
   *  OUTPUT), so a grok redrawing its prompt about once a second advances it
   *  while its adapter state never moves. Varying it is how a test says
   *  "the terminal is repainting" in the currency the `urgency` cell carries. */
  lastActivityAt?: number;
}

/** One composed ACTIVE record. `agent` defaults to none — a bare shell, which
 *  holds no bucket and is exactly the arm a level watch must skip. */
export function activeTerminal(opts: TerminalFixture): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent: opts.agent ?? null,
    foreground: null,
    ports: { status: "unknown" },
  };
  return composeTerminalMetadata(
    {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: opts.lastActivityAt ?? 0,
      ...(opts.parentId === undefined ? {} : { parentId: opts.parentId }),
      ...(opts.intent === undefined ? {} : { intent: opts.intent }),
    },
    snapshot,
  );
}

/** A terminals frame, exactly as `servePadi`'s urgency cell hands one over. */
export function frame(
  entries: Record<string, TerminalFixture> = {},
): ReadonlyMap<TerminalId, PadiTerminal> {
  return new Map(
    Object.entries(entries).map(([id, opts]) => [
      id as TerminalId,
      activeTerminal(opts),
    ]),
  );
}

/** A frame that always carries a constant, never-asked-about `anchor` terminal.
 *
 *  THE rule this file exists to remember once: an id that vanishes between two
 *  frames is a DEPARTURE, so a helper that dropped its own scaffolding between
 *  calls would manufacture `gone` events in every test that names a different
 *  terminal on the next line. Use {@link frame} when the frame's exact
 *  membership is the subject. */
export function anchored(
  entries: Record<string, TerminalFixture> = {},
): ReadonlyMap<TerminalId, PadiTerminal> {
  return frame({ anchor: {}, ...entries });
}

/** The hub, driven the way its PRODUCER drives it, on a clock a test owns.
 *
 *  Two things it single-sources. The ORDER — `servePadi`'s urgency cell feeds
 *  the one edge memory first and the hub second, so the hub can read a departed
 *  terminal's attribution — is a real contract, and a second copy of it is a
 *  second place to fix when the producer changes. And the CLOCK: `advance` moves
 *  the injected `now` and fires the armed one-shot only if its deadline has
 *  actually arrived, which is what proves the hub armed it at the right moment
 *  rather than polling. A harness that fired every pending timer regardless
 *  would pass against a hub that woke every millisecond.
 */
export function stateWatchHarness(): {
  hub: StateWatchHub;
  /** The daemon's ONE watch sequence — exposed because a test that wires this
   *  hub to a real `watchRegistry` must share it, exactly as `servePadi` does.
   *  Two counters would leave the queue's acknowledged watermark reading one
   *  source's numbers while its buffer carried the other's. */
  seq: EventSeq;
  observe(terminals: ReadonlyMap<TerminalId, PadiTerminal>): void;
  now(): number;
  armedAt(): number | undefined;
  advance(ms: number): void;
  set(at: number): void;
} {
  let clock = 10_000;
  let armed: { at: number; fire: () => void } | undefined;
  const schedule: ScheduleTimer = (delayMs, fire) => {
    const at = clock + delayMs;
    armed = { at, fire };
    return () => {
      if (armed?.fire === fire) armed = undefined;
    };
  };
  const edges = createEdgeMemory();
  const seq = createEventSeq();
  const hub = createStateWatchHub({
    log: silentLogger,
    seq,
    edges,
    now: () => clock,
    schedule,
  });
  return {
    hub,
    seq,
    observe(terminals) {
      edges.observe(terminals);
      hub.observe(terminals);
    },
    now: () => clock,
    armedAt: () => armed?.at,
    advance(ms) {
      clock += ms;
      while (armed !== undefined && armed.at <= clock) {
        const { fire } = armed;
        armed = undefined;
        fire();
      }
    },
    set(at) {
      clock = at;
    },
  };
}

/** Let the queued observe-flush run. The hub deliberately does NOT deliver on
 *  the derivation's stack, so nothing has arrived before this. */
export const settled = (): Promise<void> => Promise.resolve();

/** The scope a caller states, built through the ONE constructor — so a pin
 *  exercises the same value `servePadi` hands the registry, not a hand-shaped
 *  look-alike. The never-match refusals it raises are pinned in
 *  `watchScope.test.ts`, where the constructor lives; a test that gets one here
 *  meant to build a scope and did not, so it throws. */
export const scopeOf = (
  opts: Parameters<typeof watchScopeOf>[0],
): WatchScope => {
  const scope = watchScopeOf(opts);
  if (scope.kind === "error") throw new Error(scope.message);
  return scope.value;
};
