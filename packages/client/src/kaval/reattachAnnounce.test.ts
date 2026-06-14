/** The B3.3 reattach-toast dedupe truth table — when the "N terminals
 *  reattached" confirmation fires.
 *
 *  Mirrors `kavalCurrency.test.ts`: the falsifiable proof the toast fires ONCE
 *  per real adoption and — the regression this locks — NOT again when the SAME
 *  adoption snapshot is replayed to a fresh client context (a page reload /
 *  mobile-Safari tab eviction). Imports the pure module only — no daemonStatus
 *  subscription, no DOM. See juspay/kolu#1365. */

import type { DaemonState, DaemonStatus } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { persistedPref } from "../persistedPref";
import { announceReattach, reattachToAnnounce } from "./reattachAnnounce";

/** A synchronous in-memory `Storage`, so the persistence-wiring tests below run
 *  the SAME `persistedPref` path the app uses (parse + write) without a DOM. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** The persisted high-water-mark signal exactly as `useDaemonStatus` builds it —
 *  same key, fallback, and `parse` — over an injected `storage`, so a future
 *  mis-key or dropped persist of `setReattachAnnouncedAt` fails a test here. */
function persistedMark(storage: Storage) {
  return persistedPref<number>({
    name: "kolu.kaval.reattachAnnouncedAt",
    fallback: 0,
    storage,
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`non-numeric: ${raw}`);
      return n;
    },
  });
}

const adoptedStatus = (adoptedAt: number): DaemonStatus => ({
  state: "connected",
  adopted: 3,
  adoptedAt,
});

describe("reattachToAnnounce — the B3.3 one-shot dedupe", () => {
  it.each([
    {
      state: "connected" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 0,
      result: { count: 3, at: 1000 },
      why: "first adoption (nothing announced yet) → announce",
    },
    {
      // THE BUG (juspay/kolu#1365): the same adoption snapshot is replayed to a
      // fresh JS context on reconnect/reload; `lastAnnouncedAt` persisted across
      // the reload equals this `adoptedAt`, so it must STAY SILENT.
      state: "connected" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 1000,
      result: null,
      why: "same adoptedAt already announced (reload replay) → silent",
    },
    {
      state: "connected" as DaemonState,
      adopted: 2,
      adoptedAt: 2000,
      lastAnnouncedAt: 1000,
      result: { count: 2, at: 2000 },
      why: "a genuinely newer adoption (later update) → announce again",
    },
    {
      state: "connected" as DaemonState,
      adopted: 2,
      adoptedAt: 1000,
      lastAnnouncedAt: 2000,
      result: null,
      why: "a stale/older replay below the high-water mark → never re-fire",
    },
    {
      state: "connected" as DaemonState,
      adopted: 0,
      adoptedAt: undefined,
      lastAnnouncedAt: 0,
      result: null,
      why: "cold boot (no adoption) carries no adoptedAt → silent",
    },
    {
      state: "connected" as DaemonState,
      adopted: 2,
      adoptedAt: undefined,
      lastAnnouncedAt: 0,
      result: null,
      why: "a count with no identity → never announce without an adoptedAt",
    },
    {
      state: "connecting" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 0,
      result: null,
      why: "not yet connected → silent (the snapshot isn't authoritative)",
    },
    {
      state: "degraded" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 0,
      result: null,
      why: "daemon down → silent",
    },
  ])("$why", ({ state, adopted, adoptedAt, lastAnnouncedAt, result }) => {
    expect(
      reattachToAnnounce(state, adopted, adoptedAt, lastAnnouncedAt),
    ).toEqual(result);
  });
});

/** The persistence WIRING — the half the truth table can't see: that
 *  `announceReattach` commits the proven `adoptedAt` to the localStorage-backed
 *  high-water mark BEFORE it toasts, that a re-run on the same snapshot is
 *  therefore silent, and — the reload regression itself — that a FRESH signal
 *  built over the same storage (a new JS context) replays the same snapshot in
 *  silence. Runs the real `persistedPref` over a fake `Storage`, so a dropped or
 *  mis-keyed persist breaks a test rather than passing unnoticed. */
describe("announceReattach — the persisted high-water mark", () => {
  it("commits the adoptedAt before it notifies, then stays silent on a re-emit", () => {
    const storage = fakeStorage();
    const [mark, setMark] = persistedMark(storage);
    const notify = vi.fn();

    // First adoption: announces once and persists the mark.
    announceReattach(adoptedStatus(1000), mark(), setMark, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(3);
    expect(mark()).toBe(1000);
    // It was written THROUGH to storage under the app's key — a mis-key fails here.
    expect(storage.getItem("kolu.kaval.reattachAnnouncedAt")).toBe("1000");

    // `localDaemonStatus()` re-emits on every transition; the same snapshot must
    // not re-toast — the mark now equals adoptedAt, so the decision is null.
    announceReattach(adoptedStatus(1000), mark(), setMark, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a fresh context replays the same adoption (the reload bug)", () => {
    const storage = fakeStorage();
    // The pre-reload context announced adoptedAt=1000 and persisted it.
    {
      const [mark, setMark] = persistedMark(storage);
      announceReattach(adoptedStatus(1000), mark(), setMark, vi.fn());
    }

    // The reload: a BRAND-NEW signal reads the surviving mark from storage, and
    // the server replays the SAME sticky snapshot. The old module boolean reset
    // here and re-fired (juspay/kolu#1365); the persisted mark keeps it silent.
    const [mark, setMark] = persistedMark(storage);
    expect(mark()).toBe(1000);
    const notify = vi.fn();
    announceReattach(adoptedStatus(1000), mark(), setMark, notify);
    expect(notify).not.toHaveBeenCalled();

    // …but a genuinely newer adoption after the reload still announces.
    announceReattach(adoptedStatus(2000), mark(), setMark, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mark()).toBe(2000);
  });
});
