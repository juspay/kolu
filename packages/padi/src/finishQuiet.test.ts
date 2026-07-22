/**
 * EF2 finish-quiet feed + fold pins. Exercises the tracker realization without
 * a live kaval (standingSub: false): enter-waiting, edge re-arm, boot seed,
 * resubscribe restamp, leave, and awaiting→waiting demotion.
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
  return recomputeUrgency(terminals, (id) => finish.isLive(id));
}

describe("finishQuiet + recomputeUrgency (EF2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enter waiting + quiet ≥ QUIET → in finishedIds", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    const terms = terminalsMap([[A, "waiting"]]);
    // Just entered — window open → not finished yet.
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });
    expect(finish.isLive(A)).toBe(true);

    vi.advanceTimersByTime(QUIET);
    expect(finish.isLive(A)).toBe(false);
    // Steady re-sync (no re-enter) + pure fold after quiet.
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [A],
    });
    finish.dispose();
  });

  it("edge mid-window resets; not finished until QUIET after last edge", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);

    vi.advanceTimersByTime(QUIET - 10);
    finish.noteEdge(A); // real output mid-window
    vi.advanceTimersByTime(QUIET - 10);
    expect(finish.isLive(A)).toBe(true);
    expect(fold(finish, terms).finishedIds).toEqual([]);

    vi.advanceTimersByTime(10);
    expect(finish.isLive(A)).toBe(false);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("boot seed: already-waiting at start → window starts (no transition edge)", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    // First sync is the boot seed — already-waiting must NOT immediate-finish.
    const terms = terminalsMap([
      [A, "waiting"],
      [B, "thinking"],
    ]);
    expect(fold(finish, terms)).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });
    expect(finish.isLive(A)).toBe(true);
    expect(finish.waitingSnapshot()).toEqual([A]);

    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("resubscribe restamp: gap > QUIET while noisy + restamp → not early finish", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);

    // Simulate a recycle gap longer than QUIET with no edges (tracker ages out).
    vi.advanceTimersByTime(QUIET + 50);
    expect(finish.isLive(A)).toBe(false);
    // Without restamp, fold would early-finish while the PTY is still noisy.
    expect(fold(finish, terms).finishedIds).toEqual([A]);

    // Successful (re)subscribe restamps all waiting ids → delay, not early finish.
    finish.restampWaiting();
    expect(finish.isLive(A)).toBe(true);
    expect(fold(finish, terms).finishedIds).toEqual([]);

    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
    finish.dispose();
  });

  it("leave waiting / leave pool → forget; re-entry earns a fresh window", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    fold(finish, terminalsMap([[A, "waiting"]]));
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);

    // Leave waiting (back to work) — forget.
    fold(finish, terminalsMap([[A, "thinking"]]));
    expect(finish.isLive(A)).toBe(false);
    expect(finish.waitingSnapshot()).toEqual([]);

    // Re-enter waiting — fresh window, not immediately finished.
    expect(fold(finish, terminalsMap([[A, "waiting"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });
    expect(finish.isLive(A)).toBe(true);
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);
    finish.dispose();
  });

  it("awaiting_user → waiting demotion restamps the window", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    // Asking is ungated — no finish membership while awaiting.
    expect(fold(finish, terminalsMap([[A, "awaiting_user"]]))).toEqual({
      awaitingIds: [A],
      finishedIds: [],
    });
    expect(finish.isLive(A)).toBe(false);

    // Demotion to waiting starts a quiet window (enter-waiting noteOutput).
    expect(fold(finish, terminalsMap([[A, "waiting"]]))).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });
    expect(finish.isLive(A)).toBe(true);
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terminalsMap([[A, "waiting"]])).finishedIds).toEqual([
      A,
    ]);
    finish.dispose();
  });

  it("mid-waiting edge un-finishes then re-quiets (re-chime product path)", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    const terms = terminalsMap([[A, "waiting"]]);
    fold(finish, terms);
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);

    // Real work resumes while still waiting → leave finishedIds.
    finish.noteEdge(A);
    expect(fold(finish, terms).finishedIds).toEqual([]);

    // Quiet again → re-enter finishedIds (attention re-chimes on this edge).
    vi.advanceTimersByTime(QUIET);
    expect(fold(finish, terms).finishedIds).toEqual([A]);
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
