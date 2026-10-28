/**
 * The forgery fence at the sensor seam: a shell's `OSC 633;E` mark is a SENSOR.
 *
 * Anyone whose text the user displays (`cat` a file, curl, an ssh banner) can
 * emit the mark while the shell is idle, so it must never become a command kolu
 * types. Here a forged mark — `LD_PRELOAD=/x claude --settings '{}'`, the exact
 * shape the old normalizer would have kept and replayed on wake — is published
 * on the terminal's `commandRun` channel and the outcome is asserted through the
 * producer's command sensor, the fold, and the endpoint's ONE recent-agents arm:
 *
 *   - the only thing emitted is the "an agent may be launching, re-sample the
 *     foreground" signal, which carries no text;
 *   - the folded restore target stays `none` (a bare shell on restore), the
 *     memory is untouched, and the encoded `SavedTerminal` contains no trace of
 *     the payload;
 *   - the activity feed gains no row.
 */

import { inMemoryChannel } from "@kolu/surface/server";
import {
  type ActivityFeed,
  composeTerminalMetadata,
  createAuthoredActive,
  LOCAL_LOCATION,
  SavedTerminalSchema,
} from "@kolu/padi-client/surface";
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
import { type FoldCtx, fold, stepRecencyBaseline } from "./fold.ts";
import {
  type CommandRunSample,
  freshAgentEngineState,
  startAgentCommandSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });
const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const FORGED = "LD_PRELOAD=/x claude --settings '{}'";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const decodeSavedTerminal = Schema.decodeUnknownSync(SavedTerminalSchema);

/** A padi ctx whose `activityFeed` cell is a live in-memory feed, so the test
 *  observes the REAL MRU writer rather than a mirror of it. */
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

/** Drive the endpoint's emit loop in miniature over the sensor's emissions:
 *  fold each event, and take the ONE recent-agents arm `local.ts` has. Returns
 *  the final folded state. */
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
    const ctx: FoldCtx = { live: step.live, at: 1, runStartedAt: 0 };
    state = fold(state, o, ctx);
    if (
      o.kind === "agent" &&
      o.agent !== "unknown" &&
      o.agent.value !== null &&
      step.live
    ) {
      trackRecentAgent(o.agent.value.info.kind, o.agent.value.argv);
    }
  }
  return state;
}

/** The terminal's on-disk record, composed and encoded exactly as the autosave
 *  does it. */
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
      commandRun: inMemoryChannel<CommandRunSample>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      ports: inMemoryChannel<TerminalPorts>(),
      grid: inMemoryChannel<TerminalGrid>(),
    };
    const stop = startAgentCommandSensor(
      engine,
      ID,
      signals,
      (o) => emitted.push(o),
      log,
    );

    signals.commandRun.publish({ command: FORGED });
    await flush();
    stop();

    // The mark's ONLY effect is a foreground re-sample hint. There is no event
    // carrying its text — `commandRun` does not exist on `TerminalEvent` — so the
    // fold never sees it.
    expect(emitted).toEqual([{ kind: "agent", agent: "unknown" }]);
    expect(engine.currentAgent).toBe("claude"); // a basename hint, nothing more

    const state = foldThroughEndpoint(emitted);
    expect(state.restoreTarget).toEqual({ kind: "none" });
    expect(state.memory).toEqual(seedMemory());
    expect(feed.read().recentAgents).toEqual([]);
    expect(getActivityFeed().recentAgents).toEqual([]);
    expect(encodeSavedTerminal(state)).not.toContain("LD_PRELOAD");
  });

  it("cannot resurrect a target after a genuine agent ended", async () => {
    // A terminal that ran an agent and quit to a shell: the fold cleared the
    // target. A later forged mark (printed by `cat`, say) must not bring one back.
    const feed = recordingActivityFeed();
    const engine = freshAgentEngineState();
    const emitted: TerminalEvent[] = [];
    const signals = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<CommandRunSample>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      ports: inMemoryChannel<TerminalPorts>(),
      grid: inMemoryChannel<TerminalGrid>(),
    };
    const stop = startAgentCommandSensor(
      engine,
      ID,
      signals,
      (o) => emitted.push(o),
      log,
    );
    signals.commandRun.publish({ command: FORGED });
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
