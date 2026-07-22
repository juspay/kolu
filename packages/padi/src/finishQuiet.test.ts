/**
 * EF2 finish-quiet feed + fold pins. Sticky-per-episode via one episode map
 * (debouncing | finished); no sticky-on-read.
 */

import type { AgentInfo, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishQuiet, waitingIdsOf } from "./finishQuiet.ts";
import type { PadiTerminal } from "./surface.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "./vocab.ts";

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
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
  };
  return composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
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
  // Empty serve-time seed does not arm bootstrap; non-waiting inventory does.
  fold(finish, terminalsMap([]));
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
    });

    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [A],
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
    // Empty serve-time seed must not arm bootstrap.
    expect(fold(finish, terminalsMap([]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });
    // First non-empty inventory with waiting → discovery sticky, not debounce.
    const terms = terminalsMap([
      [A, "waiting"],
      [B, "thinking"],
    ]);
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [A],
    });
    expect(finish.stickySnapshot()).toEqual([A]);
    expect(finish.waitingSnapshot()).toEqual([A]);
    finish.dispose();
  });

  it("empty serve-time seed then later waiting still sticky-discovers", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    fold(finish, terminalsMap([]));
    // Production boot: surfaces seed empty, then registry fills with waiting.
    expect(fold(finish, terminalsMap([[A, "waiting"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [A],
    });
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

    // Nearly expired, then activity feed drops (kaval recycle).
    vi.advanceTimersByTime(QUIET - 10);
    finish.setFeedLive(false);
    vi.advanceTimersByTime(QUIET + 50);
    // Timer fired while feed-down — must NOT sticky-finish.
    expect(fold(finish, terms).finishedIds).toEqual([]);
    expect(finish.episodeSnapshot()).toEqual([[A, "debouncing"]]);

    // Reconnect restamps debouncing — full quiet window from reconnect.
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
    // Leave while still debouncing — must not flash through finished.
    expect(fold(finish, terminalsMap([[A, "thinking"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
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

    // Edge after finish must no-op on the tracker (not re-open debouncing).
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
    });

    expect(fold(finish, terminalsMap([[A, "waiting"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);
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
