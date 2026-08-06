/** The B3.3 reattach-toast dedupe truth table — when the "N terminals
 *  reattached" confirmation fires.
 *
 *  Mirrors `kavalCurrency.test.ts`: the falsifiable proof the toast fires ONCE
 *  per real adoption and — the regression this locks — NOT again when the SAME
 *  adoption snapshot is replayed to a fresh client context (a page reload /
 *  mobile-Safari tab eviction). Imports the pure module only — no daemonStatus
 *  subscription, no DOM. See juspay/kolu#1365. */

import type { DaemonState, DaemonStatus } from "@kolu/padi/surface";
import { describe, expect, it, vi } from "vitest";
import { persistedPref } from "../persistedPref";
import {
  announceAutoRecovery,
  announceReattach,
  reattachToAnnounce,
} from "./reattachAnnounce";

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
  return persistedPref<Record<string, number>>({
    name: "kolu.kaval.reattachAnnouncedAt",
    fallback: {},
    storage,
    parse: (raw) => {
      const v: unknown = JSON.parse(raw);
      if (v === null || typeof v !== "object" || Array.isArray(v))
        throw new Error(`not a per-host record: ${raw}`);
      for (const n of Object.values(v as Record<string, unknown>))
        if (typeof n !== "number" || !Number.isFinite(n))
          throw new Error(`non-numeric mark in ${raw}`);
      return v as Record<string, number>;
    },
  });
}

/** The per-ACTIVE-host projection `useDaemonStatus`'s effect applies over the record:
 *  read `record[host] ?? 0`, commit `{ ...prev, [host]: mark }`. Recompute per call (each
 *  effect run reads the mark fresh), so it mirrors the app exactly. */
function markFor(
  mark: () => Record<string, number>,
  setMark: (
    fn: (prev: Record<string, number>) => Record<string, number>,
  ) => void,
  host: string,
): [number, (m: number) => void] {
  return [
    mark()[host] ?? 0,
    (m) => setMark((prev) => ({ ...prev, [host]: m })),
  ];
}

const adoptedStatus = (adoptedAt: number): DaemonStatus => ({
  state: "connected",
  contractVersion: "5.0",
  startedAt: 1,
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

    // First adoption on the active host (local): announces once and persists the mark.
    const [m0, set0] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(1000), m0, set0, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(3);
    expect(mark().local).toBe(1000);
    // Written THROUGH to storage under the app's key, HOST-KEYED — a mis-key fails here.
    expect(storage.getItem("kolu.kaval.reattachAnnouncedAt")).toBe(
      '{"local":1000}',
    );

    // `localDaemonStatus()` re-emits on every transition; the same snapshot must not
    // re-toast — the (recomputed) mark now equals adoptedAt, so the decision is null.
    const [m1, set1] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(1000), m1, set1, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a fresh context replays the same adoption (the reload bug)", () => {
    const storage = fakeStorage();
    // The pre-reload context announced adoptedAt=1000 on local and persisted it.
    {
      const [mark, setMark] = persistedMark(storage);
      const [m, s] = markFor(mark, setMark, "local");
      announceReattach(adoptedStatus(1000), m, s, vi.fn());
    }

    // The reload: a BRAND-NEW signal reads the surviving mark from storage, and the
    // server replays the SAME sticky snapshot. The old module boolean reset here and
    // re-fired (juspay/kolu#1365); the persisted per-host mark keeps it silent.
    const [mark, setMark] = persistedMark(storage);
    expect(mark().local).toBe(1000);
    const notify = vi.fn();
    const [m, s] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(1000), m, s, notify);
    expect(notify).not.toHaveBeenCalled();

    // …but a genuinely newer adoption after the reload still announces.
    const [m2, s2] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(2000), m2, s2, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mark().local).toBe(2000);
  });

  it("is PER-HOST: a remote ahead-clock toast does NOT suppress a later local re-adoption on switch-back (re-run #6)", () => {
    // adoptedAt is a RAW foreign epoch on each host's OWN clock (deliberately unreprojected — a
    // monotonic dedup key, never compared to the browser). Per-host clocks are not mutually
    // monotonic, so the mark is a per-HOST record: one shared scalar would let a remote
    // ahead-clock adoption raise the bar above a genuine later LOCAL re-adoption and swallow it.
    const storage = fakeStorage();
    const [mark, setMark] = persistedMark(storage);
    const notify = vi.fn();

    // Remote "srid@zest" (clock way AHEAD) adopts at 10_000 → toast; only zest's mark advances.
    const [mz, sz] = markFor(mark, setMark, "srid@zest");
    announceReattach(adoptedStatus(10_000), mz, sz, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mark()).toEqual({ "srid@zest": 10_000 });

    // Switch back to local; local re-adopts at 5_000 (< zest's 10_000, but its OWN clock) →
    // STILL toasts, because local's own mark is 0. A shared scalar (10_000) would suppress it.
    const [ml, sl] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(5_000), ml, sl, notify);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(mark()).toEqual({ "srid@zest": 10_000, local: 5_000 });

    // Re-run local on the same snapshot → silent (5_000 not > local's OWN 5_000).
    const [ml2, sl2] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(5_000), ml2, sl2, notify);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe("announceAutoRecovery — one toast per PROVEN automatic repair (#2101 N1)", () => {
  const connected = (autoRecoveredAt?: number) =>
    ({ state: "connected", autoRecoveredAt }) as const;

  it("announces a stamp newer than the mark, committing BEFORE notifying", () => {
    const order: string[] = [];
    announceAutoRecovery(
      connected(1_700),
      0,
      (at) => order.push(`commit:${at}`),
      () => order.push("notify"),
    );
    expect(order).toEqual(["commit:1700", "notify"]);
  });

  it("stays silent on a REPLAY of the same stamp — the #1365 rule, inherited", () => {
    const notify = vi.fn();
    announceAutoRecovery(connected(1_700), 1_700, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent when nothing was auto-repaired", () => {
    const notify = vi.fn();
    announceAutoRecovery(connected(undefined), 0, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent on a non-connected snapshot, however it is stamped", () => {
    const notify = vi.fn();
    announceAutoRecovery(
      { state: "degraded" } as Parameters<typeof announceAutoRecovery>[0],
      0,
      vi.fn(),
      notify,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});
