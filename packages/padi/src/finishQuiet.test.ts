/**
 * EF2 finish-quiet feed + fold pins. Exercises sticky-per-episode without a
 * live kaval (standingSub: false): enter-waiting first-finish debounce, boot
 * seed → sticky, mid-waiting edges do not un-finish, leave re-arms, demotion.
 */

import type { AgentInfo, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishQuiet, waitingIdsOf } from "./finishQuiet.ts";
import type { PadiTerminal } from "./surface.ts";
import { recomputeUrgency } from "./urgency.ts";
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

/** Fold after syncing the finish feed — the production urgency path shape. */
function fold(
  finish: ReturnType<typeof createFinishQuiet>,
  terminals: Map<TerminalId, PadiTerminal>,
) {
  finish.syncWaiting(terminals);
  return recomputeUrgency(terminals, (id) => finish.isEpisodeFinished(id));
}

/**
 * Production-shaped harness: first sync is empty (boot seed of nothing), so a
 * later enter-waiting exercises the first-finish quiet window rather than the
 * boot-seed sticky path.
 */
function afterBootEmpty(finish: ReturnType<typeof createFinishQuiet>): void {
  fold(finish, terminalsMap([]));
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
    // Just entered — window open → not finished yet.
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
    finish.noteEdge(A); // real output mid-window (pre-finish)
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
    // First sync is the boot seed — already-waiting is a discovery, not a
    // transition: sticky-finished at once (no 5s window, no mass-chime later).
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

    // Idle TUI noise / "real" mid-episode output — must stay finished.
    finish.noteEdge(A);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
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

    // Mid-debounce restamp re-opens the window (pre-finish).
    vi.advanceTimersByTime(QUIET - 10);
    finish.restampWaiting();
    vi.advanceTimersByTime(QUIET - 10);
    expect(fold(finish, terms).finishedIds).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(fold(finish, terms).finishedIds).toEqual([A]);

    // After sticky, restamp must not un-finish (recycle under idle TUI noise).
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

    // Leave waiting (back to work) — sticky cleared.
    fold(finish, terminalsMap([[A, "thinking"]]));
    expect(finish.stickySnapshot()).toEqual([]);
    expect(finish.waitingSnapshot()).toEqual([]);

    // Re-enter waiting — fresh window, not immediately finished.
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
    // Asking is ungated — no finish membership while awaiting.
    expect(fold(finish, terminalsMap([[A, "awaiting_user"]]))).toEqual({
      awaitingIds: [A],
      finishedIds: [],
    });

    // Demotion to waiting starts a quiet window (enter-waiting noteOutput).
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
