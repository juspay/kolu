import type { PadiTerminal } from "@kolu/padi-client/surface";
import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "@kolu/padi-client/surface";
import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { pino } from "pino";
import { createEdgeMemory } from "./edgeMemory.ts";
import { createEventSeq, type EventSeq } from "./eventSeq.ts";
import {
  createStateWatchHub,
  type ScheduleTimer,
  type StateWatchHub,
} from "./stateWatch.ts";

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
  lastActivityAt?: number;
}

export function activeTerminal(opts: TerminalFixture): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: { kind: "none" },
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
      promptedAt: null,
      ...(opts.parentId === undefined ? {} : { parentId: opts.parentId }),
      ...(opts.intent === undefined ? {} : { intent: opts.intent }),
    },
    snapshot,
  );
}

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

export function anchored(
  entries: Record<string, TerminalFixture> = {},
): ReadonlyMap<TerminalId, PadiTerminal> {
  return frame({ anchor: {}, ...entries });
}

export function stateWatchHarness(): {
  hub: StateWatchHub;
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

export const settled = (): Promise<void> => Promise.resolve();

export { scopeOf } from "@kolu/padi-client/watchScope.testlib";
