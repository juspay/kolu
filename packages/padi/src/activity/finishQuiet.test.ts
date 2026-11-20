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
import type { Logger } from "pino";
import { agentPresence } from "kolu-agents/vocab";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishQuiet, waitingIdsOf } from "./finishQuiet.ts";

const QUIET = 100;
const A = "fin-a" as TerminalId;
const B = "fin-b" as TerminalId;

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

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

function activeTerminal(agent: AgentInfo | null): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: { kind: "none" },
    pr: { kind: "pending" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
  };
  return composeTerminalMetadata(
    {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
    },
    snapshot,
  );
}

function terminalsMap(
  entries: Array<[TerminalId, AgentInfo["state"] | null]>,
): Map<TerminalId, PadiTerminal> {
  return new Map(
    entries.map(([id, state]) => [
      id,
      activeTerminal(state === null ? null : makeAgent(state)),
    ]),
  );
}

function fold(
  finish: ReturnType<typeof createFinishQuiet>,
  terminals: Map<TerminalId, PadiTerminal>,
) {
  return finish.project(terminals);
}

function afterBootEmpty(finish: ReturnType<typeof createFinishQuiet>): void {
  fold(finish, terminalsMap([[B, "thinking"]]));
}

describe("finishQuiet + recomputeUrgency (EF2 sticky-per-episode)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enter waiting + quiet ≥ QUIET → in finishedIds", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    const terms = terminalsMap([[A, "waiting"]]);
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [],
      workingIds: [],
      lingerIds: [A],
      settled: true,
    });

    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [A],
      workingIds: [],
      lingerIds: [],
      settled: true,
    });
    expect(finish.stickySnapshot()).toEqual([A]);
    expect(finish.episodeSnapshot()).toEqual([[A, "finished"]]);
    finish.dispose();
  });

  it("edge mid-window resets; not finished until QUIET after last edge", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);

    vi.advanceTimersByTime(QUIET - 10);
    finish.noteEdge(A);
    vi.advanceTimersByTime(QUIET - 10);
    expect(fold(finish, terms).finishedIds).toEqual([]);

    vi.advanceTimersByTime(10);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("boot seed: already-waiting at start → immediately sticky-finished (discovery)", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    const terms = terminalsMap([
      [A, "waiting"],
      [B, "thinking"],
    ]);
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [A],
      workingIds: [B],
      lingerIds: [],
      settled: true,
    });
    expect(finish.stickySnapshot()).toEqual([A]);
    expect(finish.waitingSnapshot()).toEqual([A]);
    finish.dispose();
  });

  it("mid-waiting edge after finish does NOT un-finish (sticky-per-episode)", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);

    finish.noteEdge(A);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("feed-down during debounce cannot promote; reconnect restamp restarts window", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);

    vi.advanceTimersByTime(QUIET - 10);
    finish.setFeedLive(false);
    vi.advanceTimersByTime(QUIET + 50);
    expect(fold(finish, terms).finishedIds).toEqual([]);
    expect(finish.episodeSnapshot()).toEqual([[A, "debouncing"]]);

    finish.setFeedLive(true);
    expect(fold(finish, terms).finishedIds).toEqual([]);
    vi.advanceTimersByTime(QUIET - 10);
    expect(fold(finish, terms).finishedIds).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("leave during debounce does not promote then delete", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    fold(finish, terminalsMap([[A, "waiting"]]));
    expect(fold(finish, terminalsMap([[A, "thinking"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
      workingIds: [A],
      lingerIds: [],
      settled: true,
    });
    expect(finish.episodeSnapshot()).toEqual([]);
    finish.dispose();
  });

  it("noteEdge on finished episode does not re-arm the tracker", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);
    vi.advanceTimersByTime(QUIET);
    fold(finish, terms);
    expect(finish.episodeSnapshot()).toEqual([[A, "finished"]]);

    finish.noteEdge(A);
    expect(finish.isEpisodeFinished(A)).toBe(true);
    expect(finish.episodeSnapshot()).toEqual([[A, "finished"]]);
    finish.dispose();
  });

  it("resubscribe restamp during debounce delays finish; after sticky does not un-finish", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);

    vi.advanceTimersByTime(QUIET - 10);
    finish.restampWaiting();
    vi.advanceTimersByTime(QUIET - 10);
    expect(fold(finish, terms).finishedIds).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(fold(finish, terms).finishedIds).toEqual([A]);

    finish.restampWaiting();
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("leave waiting / leave pool clears sticky; re-entry earns a fresh window", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    fold(finish, terminalsMap([[A, "waiting"]]));
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);

    fold(finish, terminalsMap([[A, "thinking"]]));
    expect(finish.stickySnapshot()).toEqual([]);
    expect(finish.waitingSnapshot()).toEqual([]);

    expect(fold(finish, terminalsMap([[A, "waiting"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
      workingIds: [],
      lingerIds: [A],
      settled: true,
    });
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);
    finish.dispose();
  });

  it("awaiting_user → waiting demotion starts a quiet window (not sticky yet)", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    afterBootEmpty(finish);
    expect(fold(finish, terminalsMap([[A, "awaiting_user"]]))).toEqual({
      awaitingIds: [A],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
      settled: true,
    });

    expect(fold(finish, terminalsMap([[A, "waiting"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
      workingIds: [],
      lingerIds: [A],
      settled: true,
    });
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);
    finish.dispose();
  });
});

const presentTerminal = (
  state: "starting" | "fresh" | "prompted",
): PadiTerminal => activeTerminal(agentPresence("omp", state, null));

const QUIET_URGENCY = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
  settled: true,
};

describe("finishQuiet settles a screen padi is waiting on (starting/prompted → fresh)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports a starting agent settled after one quiet window — once — and never counts it", () => {
    const settled: TerminalId[] = [];
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
      onSettled: (id) => settled.push(id),
    });
    afterBootEmpty(finish);
    const terms = new Map([[A, presentTerminal("starting")]]);
    expect(fold(finish, terms)).toEqual(QUIET_URGENCY);
    vi.advanceTimersByTime(QUIET - 10);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(settled).toEqual([A]);
    expect(fold(finish, terms)).toEqual(QUIET_URGENCY);
    vi.advanceTimersByTime(QUIET * 3);
    expect(settled).toEqual([A]);
    fold(finish, new Map([[A, presentTerminal("fresh")]]));
    expect(finish.episodeSnapshot()).toEqual([]);
    finish.dispose();
  });

  it("output while the screen is still being drawn re-arms the settle", () => {
    const settled: TerminalId[] = [];
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
      onSettled: (id) => settled.push(id),
    });
    afterBootEmpty(finish);
    fold(finish, new Map([[A, presentTerminal("starting")]]));
    vi.advanceTimersByTime(QUIET - 10);
    finish.noteEdge(A);
    vi.advanceTimersByTime(QUIET - 10);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(settled).toEqual([A]);
    finish.dispose();
  });

  it("an agent whose transcript lands at `waiting` before it settled starts a FINISH window, not a settled one", () => {
    const settled: TerminalId[] = [];
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
      onSettled: (id) => settled.push(id),
    });
    afterBootEmpty(finish);
    fold(finish, new Map([[A, presentTerminal("starting")]]));
    vi.advanceTimersByTime(QUIET - 10);
    const waiting = terminalsMap([[A, "waiting"]]);
    expect(fold(finish, waiting).lingerIds).toEqual([A]);
    vi.advanceTimersByTime(QUIET - 10);
    expect(settled).toEqual([]);
    expect(fold(finish, waiting).finishedIds).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(fold(finish, waiting).finishedIds).toEqual([A]);
    expect(settled).toEqual([]);
    finish.dispose();
  });

  it("an agent already coming up when the first real fleet arrives is settled at once", () => {
    const settled: TerminalId[] = [];
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
      onSettled: (id) => settled.push(id),
    });
    fold(finish, new Map([[A, presentTerminal("starting")]]));
    expect(settled).toEqual([A]);
    finish.dispose();
  });

  it("a PROMPTED agent counts as working, and a screen that settles with no transcript is reported — once", () => {
    const settled: TerminalId[] = [];
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
      onSettled: (id) => settled.push(id),
    });
    afterBootEmpty(finish);
    fold(finish, new Map([[A, presentTerminal("fresh")]]));
    expect(finish.episodeSnapshot()).toEqual([]);
    const prompted = new Map([[A, presentTerminal("prompted")]]);
    expect(fold(finish, prompted).workingIds).toEqual([A]);
    vi.advanceTimersByTime(QUIET - 10);
    finish.noteEdge(A);
    vi.advanceTimersByTime(QUIET - 10);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(settled).toEqual([A]);
    vi.advanceTimersByTime(QUIET * 3);
    expect(settled).toEqual([A]);
    finish.dispose();
  });

  it("a transcript's own working state is not a settle — only padi's `prompted` is", () => {
    const settled: TerminalId[] = [];
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
      onSettled: (id) => settled.push(id),
    });
    afterBootEmpty(finish);
    fold(finish, new Map([[A, presentTerminal("prompted")]]));
    fold(finish, terminalsMap([[A, "thinking"]]));
    expect(finish.episodeSnapshot()).toEqual([]);
    vi.advanceTimersByTime(QUIET * 2);
    expect(settled).toEqual([]);
    finish.dispose();
  });
});

describe("waitingIdsOf", () => {
  it("collects only active waiting agents", () => {
    const map = terminalsMap([
      [A, "waiting"],
      [B, "awaiting_user"],
    ]);
    expect(waitingIdsOf(map)).toEqual([A]);
  });
});
