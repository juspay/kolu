import {
  type ActivityFeed,
  composeTerminalMetadata,
  createAuthoredActive,
  LOCAL_LOCATION,
  SavedTerminalSchema,
} from "@kolu/padi-client/surface";
import { inMemoryChannel } from "@kolu/surface/server";
import {
  seedMemory,
  seedSnapshot,
  type TerminalEvent,
  type TerminalGrid,
  type TerminalId,
  type TerminalPorts,
  type TerminalState,
} from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getActivityFeed, trackRecentAgent } from "../activity/activity.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  type FoldCtx,
  fold,
  restoreTargetEqual,
  stepRecencyBaseline,
} from "./fold.ts";
import { freshAgentEngineState, startAgentCommandSensor } from "./sensors.ts";

const log = pino({ level: "silent" });
const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const FORGED = "LD_PRELOAD=/x claude --settings '{}'";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const decodeSavedTerminal = Schema.decodeUnknownSync(SavedTerminalSchema);

function recordingActivityFeed(): { read: () => ActivityFeed } {
  let feed: ActivityFeed = { recentRepos: [], recentAgents: [] };
  const base = noopPadiSurfaceCtxForTest();
  setPadiSurfaceCtx({
    ...base,
    cells: new Proxy({} as never, {
      get: (_t, name) =>
        name === "activityFeed"
          ? {
              get: () => feed,
              set: (value: ActivityFeed) => {
                feed = value;
              },
              patch: () => {},
            }
          : (base.cells as Record<string, unknown>)[name as string],
    }),
  } as ReturnType<typeof noopPadiSurfaceCtxForTest>);
  return { read: () => feed };
}

beforeEach(() => {
  __resetPadiSurfaceCtxForTest();
});
afterEach(() => {
  __resetPadiSurfaceCtxForTest();
});

function foldThroughEndpoint(
  emitted: readonly TerminalEvent[],
  from?: TerminalState,
): TerminalState {
  let state: TerminalState = from ?? {
    snapshot: seedSnapshot("/work"),
    memory: seedMemory(),
    restoreTarget: { kind: "none" },
  };
  let baseline = null;
  for (const o of emitted) {
    const step = stepRecencyBaseline(baseline, o);
    baseline = step.baseline;
    const before = state;
    const ctx: FoldCtx = { live: step.live, at: 1, runStartedAt: 0 };
    state = fold(state, o, ctx);
    if (
      o.kind === "agent" &&
      o.agent !== "unknown" &&
      o.agent.value !== null &&
      !restoreTargetEqual(before.restoreTarget, state.restoreTarget)
    ) {
      const prev = before.restoreTarget;
      const next = state.restoreTarget;
      const replacePlaceholder =
        prev.kind === "exact" &&
        next.kind === "exact" &&
        prev.agent.sessionId === next.agent.sessionId &&
        prev.argv.length === 0 &&
        next.argv.length > 0;
      trackRecentAgent(o.agent.value.info.kind, o.agent.value.argv, {
        replacePlaceholder,
      });
    }
  }
  return state;
}

const claudeInfo = {
  kind: "claude-code" as const,
  state: "thinking" as const,
  sessionId: "11111111-1111-4111-8111-111111111111",
  model: null,
  summary: null,
  taskProgress: null,
  workflow: null,
  contextTokens: null,
  startedAt: null,
};

function encodeSavedTerminal(state: TerminalState): string {
  return JSON.stringify(
    Schema.encodeSync(SavedTerminalSchema)(
      decodeSavedTerminal({
        ...composeTerminalMetadata(
          {
            ...createAuthoredActive(LOCAL_LOCATION),
            ...state.memory,
            restoreTarget: state.restoreTarget,
          },
          state.snapshot,
        ),
        id: ID,
      }),
    ),
  );
}

describe("a forged 633;E mark", () => {
  it("produces no restore target, no MRU row, and no persisted payload", async () => {
    const feed = recordingActivityFeed();
    const engine = freshAgentEngineState();
    const emitted: TerminalEvent[] = [];
    const signals = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      ports: inMemoryChannel<TerminalPorts>(),
      grid: inMemoryChannel<TerminalGrid>(),
      screenSettled: inMemoryChannel<void>(),
      submitted: inMemoryChannel<void>(),
    };
    const stop = startAgentCommandSensor(
      engine,
      ID,
      signals,
      (o) => emitted.push(o),
      log,
    );

    signals.commandRun.publish(FORGED);
    await flush();
    stop();

    expect(emitted).toEqual([{ kind: "agent", agent: "unknown" }]);
    expect(engine.currentAgent).toBe("claude");

    const state = foldThroughEndpoint(emitted);
    expect(state.restoreTarget).toEqual({ kind: "none" });
    expect(state.memory).toEqual(seedMemory());
    expect(feed.read().recentAgents).toEqual([]);
    expect(getActivityFeed().recentAgents).toEqual([]);
    expect(encodeSavedTerminal(state)).not.toContain("LD_PRELOAD");
  });

  it("records the rich MRU row when the flags arrive after a flagless sample", () => {
    const feed = recordingActivityFeed();
    const state = foldThroughEndpoint([
      { kind: "agent", agent: { value: { info: claudeInfo, argv: [] } } },
      {
        kind: "agent",
        agent: {
          value: { info: claudeInfo, argv: ["--model", "sonnet"] },
        },
      },
    ]);
    expect(state.restoreTarget).toMatchObject({
      kind: "exact",
      argv: ["--model", "sonnet"],
    });
    expect(feed.read().recentAgents).toEqual([
      {
        kind: "claude-code",
        argv: ["--model", "sonnet"],
        lastSeen: expect.any(Number),
      },
    ]);
  });

  it("cannot resurrect a target after a genuine agent ended", async () => {
    const feed = recordingActivityFeed();
    const engine = freshAgentEngineState();
    const emitted: TerminalEvent[] = [];
    const signals = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      ports: inMemoryChannel<TerminalPorts>(),
      grid: inMemoryChannel<TerminalGrid>(),
      screenSettled: inMemoryChannel<void>(),
      submitted: inMemoryChannel<void>(),
    };
    const stop = startAgentCommandSensor(
      engine,
      ID,
      signals,
      (o) => emitted.push(o),
      log,
    );
    signals.commandRun.publish(FORGED);
    await flush();
    stop();

    const quit: TerminalState = {
      snapshot: { ...seedSnapshot("/work"), agent: null },
      memory: seedMemory(),
      restoreTarget: { kind: "none" },
    };
    const state = foldThroughEndpoint(emitted, quit);
    expect(state).toEqual(quit);
    expect(feed.read().recentAgents).toEqual([]);
  });
});
