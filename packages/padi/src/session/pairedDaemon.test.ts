/**
 * `isReplacedDaemon` — the pure replacement discriminant the boot reconcile gates
 * the session converge on. Replacement detection is what stops an adopted-but-empty
 * REPLACED kaval from erasing the saved session (the zest incident), while still
 * letting a genuine survivor's converge prune + clear.
 *
 * The primary signal is the terminals' own ids (a live PTY matching a saved ACTIVE
 * proves the daemon is ours); `startedAt` is only the tiebreak for the empty-live
 * case (our survivor whose actives all exited vs a replaced empty daemon).
 */

import type { PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import {
  LOCAL_LOCATION,
  type SavedActiveTerminal,
  type SavedSession,
  type SavedTerminal,
} from "../vocab.ts";
import { isReplacedDaemon, type PairedDaemon } from "./pairedDaemon.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const base = {
  git: null,
  pr: { kind: "absent" } as const,
  location: LOCAL_LOCATION,
};

function activeRecord(id: string): SavedActiveTerminal {
  return {
    ...base,
    id,
    state: "active",
    cwd: "/x",
    lastActivityAt: 1,
    restoreTarget: { kind: "none" },
  };
}
function session(terminals: SavedTerminal[]): SavedSession {
  return { terminals, activeTerminalId: null, savedAt: 1 };
}
function live(id: string): PtyHostListEntry {
  return { id, pid: 1, cwd: "/x", lastActivity: 0 };
}

const paired = (startedAt: number): PairedDaemon => ({ startedAt });

describe("isReplacedDaemon", () => {
  it("no saved actives → never replaced (nothing to protect; normal converge)", () => {
    const sleeper: SavedTerminal = {
      ...base,
      id: A,
      state: "sleeping",
      sleptAt: 1,
      cwd: "/x",
      lastActivityAt: 1,
    };
    expect(
      isReplacedDaemon({
        currentStartedAt: 2,
        lastPaired: paired(1),
        live: [],
        saved: session([sleeper]),
      }),
    ).toBe(false);
  });

  it("a live PTY matching a saved active → NOT replaced, EVEN with a mismatched pairing (the robust id signal)", () => {
    // A survivor still holding our terminal `A`, but the persisted pairing went stale
    // (a supervised restart / restore re-homed the session). The id match must win, so
    // the live terminal is adopted, never re-parked out from under its live scrollback.
    expect(
      isReplacedDaemon({
        currentStartedAt: 999,
        lastPaired: paired(1),
        live: [live(A)],
        saved: session([activeRecord(A), activeRecord(B)]),
      }),
    ).toBe(false);
  });

  it("empty daemon + active saved + NO prior pairing → replaced (the zest incident, fail-safe preserve)", () => {
    expect(
      isReplacedDaemon({
        currentStartedAt: undefined,
        lastPaired: null,
        live: [],
        saved: session([activeRecord(A)]),
      }),
    ).toBe(true);
  });

  it("empty daemon + active saved + startedAt MISMATCH → replaced (restarted out-of-band)", () => {
    expect(
      isReplacedDaemon({
        currentStartedAt: 2000,
        lastPaired: paired(1000),
        live: [],
        saved: session([activeRecord(A)]),
      }),
    ).toBe(true);
  });

  it("empty daemon + active saved + startedAt MATCH → NOT replaced (our survivor, actives exited — 2b clear)", () => {
    expect(
      isReplacedDaemon({
        currentStartedAt: 1000,
        lastPaired: paired(1000),
        live: [],
        saved: session([activeRecord(A)]),
      }),
    ).toBe(false);
  });

  it("a foreign non-empty daemon (live PTYs, none ours) + active saved → replaced", () => {
    expect(
      isReplacedDaemon({
        currentStartedAt: 2000,
        lastPaired: paired(1000),
        live: [live("cccccccc-cccc-4ccc-8ccc-cccccccccccc")],
        saved: session([activeRecord(A)]),
      }),
    ).toBe(true);
  });
});
