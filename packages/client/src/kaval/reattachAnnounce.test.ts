import type { DaemonState, DaemonStatus } from "@kolu/padi-client/surface";
import { describe, expect, it, vi } from "vitest";
import { persistedPref } from "../persistedPref";
import {
  announceReattach,
  announceRepair,
  reattachToAnnounce,
} from "./reattachAnnounce";

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

describe("announceReattach — the persisted high-water mark", () => {
  it("commits the adoptedAt before it notifies, then stays silent on a re-emit", () => {
    const storage = fakeStorage();
    const [mark, setMark] = persistedMark(storage);
    const notify = vi.fn();

    const [m0, set0] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(1000), m0, set0, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(3);
    expect(mark().local).toBe(1000);
    expect(storage.getItem("kolu.kaval.reattachAnnouncedAt")).toBe(
      '{"local":1000}',
    );

    const [m1, set1] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(1000), m1, set1, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a fresh context replays the same adoption (the reload bug)", () => {
    const storage = fakeStorage();
    {
      const [mark, setMark] = persistedMark(storage);
      const [m, s] = markFor(mark, setMark, "local");
      announceReattach(adoptedStatus(1000), m, s, vi.fn());
    }

    const [mark, setMark] = persistedMark(storage);
    expect(mark().local).toBe(1000);
    const notify = vi.fn();
    const [m, s] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(1000), m, s, notify);
    expect(notify).not.toHaveBeenCalled();

    const [m2, s2] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(2000), m2, s2, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mark().local).toBe(2000);
  });

  it("is PER-HOST: a remote ahead-clock toast does NOT suppress a later local re-adoption on switch-back (re-run #6)", () => {
    const storage = fakeStorage();
    const [mark, setMark] = persistedMark(storage);
    const notify = vi.fn();

    const [mz, sz] = markFor(mark, setMark, "srid@zest");
    announceReattach(adoptedStatus(10_000), mz, sz, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mark()).toEqual({ "srid@zest": 10_000 });

    const [ml, sl] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(5_000), ml, sl, notify);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(mark()).toEqual({ "srid@zest": 10_000, local: 5_000 });

    const [ml2, sl2] = markFor(mark, setMark, "local");
    announceReattach(adoptedStatus(5_000), ml2, sl2, notify);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe("announceRepair('autoRecoveredAt') — one toast per PROVEN automatic repair (#2101 N1)", () => {
  const connected = (autoRecoveredAt?: number) =>
    ({ state: "connected", autoRecoveredAt }) as const;

  it("announces a stamp newer than the mark, committing BEFORE notifying", () => {
    const order: string[] = [];
    announceRepair(
      "autoRecoveredAt",
      connected(1_700),
      0,
      (at) => order.push(`commit:${at}`),
      () => order.push("notify"),
    );
    expect(order).toEqual(["commit:1700", "notify"]);
  });

  it("stays silent on a REPLAY of the same stamp — the #1365 rule, inherited", () => {
    const notify = vi.fn();
    announceRepair("autoRecoveredAt", connected(1_700), 1_700, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent when nothing was auto-repaired", () => {
    const notify = vi.fn();
    announceRepair("autoRecoveredAt", connected(undefined), 0, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent on a non-connected snapshot, however it is stamped", () => {
    const notify = vi.fn();
    announceRepair(
      "autoRecoveredAt",
      { state: "degraded" } as Parameters<typeof announceRepair>[1],
      0,
      vi.fn(),
      notify,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("announceRepair('linkRestoredAt') — one toast per re-made link (#2184)", () => {
  const connected = (linkRestoredAt?: number) =>
    ({ state: "connected", linkRestoredAt }) as const;

  it("announces a stamp newer than the mark, committing BEFORE notifying", () => {
    const order: string[] = [];
    announceRepair(
      "linkRestoredAt",
      connected(2_400),
      0,
      (at) => order.push(`commit:${at}`),
      () => order.push("notify"),
    );
    expect(order).toEqual(["commit:2400", "notify"]);
  });

  it("stays silent on a REPLAY of the same stamp — the #1365 rule, inherited", () => {
    const notify = vi.fn();
    announceRepair("linkRestoredAt", connected(2_400), 2_400, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent on a stamp OLDER than the mark", () => {
    const notify = vi.fn();
    announceRepair("linkRestoredAt", connected(1_000), 2_400, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent when no link was lost and re-made", () => {
    const notify = vi.fn();
    announceRepair("linkRestoredAt", connected(undefined), 0, vi.fn(), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent on a non-connected snapshot, however it is stamped", () => {
    const notify = vi.fn();
    announceRepair(
      "linkRestoredAt",
      { state: "degraded" } as Parameters<typeof announceRepair>[1],
      0,
      vi.fn(),
      notify,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("the three announcements are independent (#2184)", () => {
  it("a link restore does not suppress an auto-recovery or a reattach on the same snapshot", () => {
    const status = {
      state: "connected",
      contractVersion: "5.0",
      startedAt: 1,
      adopted: 3,
      adoptedAt: 5_000,
      autoRecoveredAt: 5_000,
      linkRestoredAt: 5_000,
    } as DaemonStatus;
    const marks = { reattach: 0, recovery: 0, link: 0 };
    const reattachNotify = vi.fn();
    const recoveryNotify = vi.fn();
    const linkNotify = vi.fn();

    announceRepair(
      "linkRestoredAt",
      status,
      marks.link,
      (at) => (marks.link = at),
      linkNotify,
    );
    announceRepair(
      "autoRecoveredAt",
      status,
      marks.recovery,
      (at) => (marks.recovery = at),
      recoveryNotify,
    );
    announceReattach(
      status,
      marks.reattach,
      (at) => (marks.reattach = at),
      reattachNotify,
    );

    expect(linkNotify).toHaveBeenCalledTimes(1);
    expect(recoveryNotify).toHaveBeenCalledTimes(1);
    expect(reattachNotify).toHaveBeenCalledTimes(1);
  });

  it("an auto-recovery already announced does not suppress a LATER link restore, and each still dedupes itself", () => {
    const recoveryNotify = vi.fn();
    const linkNotify = vi.fn();
    let recoveryMark = 0;
    let linkMark = 0;
    announceRepair(
      "autoRecoveredAt",
      { state: "connected", autoRecoveredAt: 1_000 } as DaemonStatus,
      recoveryMark,
      (at) => (recoveryMark = at),
      recoveryNotify,
    );
    expect(recoveryMark).toBe(1_000);

    const after = {
      state: "connected",
      autoRecoveredAt: 1_000,
      linkRestoredAt: 2_000,
    } as DaemonStatus;
    announceRepair(
      "linkRestoredAt",
      after,
      linkMark,
      (at) => (linkMark = at),
      linkNotify,
    );
    announceRepair(
      "autoRecoveredAt",
      after,
      recoveryMark,
      (at) => (recoveryMark = at),
      recoveryNotify,
    );
    expect(linkNotify).toHaveBeenCalledTimes(1);
    expect(recoveryNotify).toHaveBeenCalledTimes(1);

    announceRepair(
      "linkRestoredAt",
      after,
      linkMark,
      (at) => (linkMark = at),
      linkNotify,
    );
    announceRepair(
      "autoRecoveredAt",
      after,
      recoveryMark,
      (at) => (recoveryMark = at),
      recoveryNotify,
    );
    expect(linkNotify).toHaveBeenCalledTimes(1);
    expect(recoveryNotify).toHaveBeenCalledTimes(1);
  });
});
