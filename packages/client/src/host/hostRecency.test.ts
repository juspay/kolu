import type { HostKey } from "kolu-common/hostKey";
import { type Accessor, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => {
  return { setActive: (_h: HostKey) => {} };
});

vi.mock("../wire", async () => {
  const { createSignal, createMemo, createRoot } = await import("solid-js");
  const { encodeHostKey } = await import("kolu-common/hostKey");
  const [active, setActive] = createSignal<HostKey>({ kind: "local" });
  bag.setActive = (h: HostKey) => setActive(h);
  return {
    encActiveHost: createRoot(() => createMemo(() => encodeHostKey(active()))),
  };
});

import {
  createHostRecency,
  HOST_MRU_CAP,
  type HostVisit,
  parseHostMru,
  promoteHostOrSame,
} from "./hostRecency";

const LOCAL: HostKey = { kind: "local" };
const GPU: HostKey = { kind: "remote", target: "gpu-box" };
const BUILDER: HostKey = { kind: "remote", target: "builder" };

const visit = (hostKey: string, switchedAt: number): HostVisit => ({
  hostKey,
  switchedAt,
});
const keys = (trail: readonly HostVisit[]): string[] =>
  trail.map((e) => e.hostKey);

describe("promoteHostOrSame", () => {
  const TRAIL = [visit("a", 300), visit("b", 200), visit("c", 100)];

  it("moves the host to the front", () => {
    expect(keys(promoteHostOrSame(TRAIL, "c", 400))).toEqual(["c", "a", "b"]);
  });

  it("returns the very same list when the host is already at the front", () => {
    expect(promoteHostOrSame(TRAIL, "a", 400)).toBe(TRAIL);
  });

  it("dedupes rather than growing a second entry", () => {
    expect(keys(promoteHostOrSame(TRAIL, "a", 400))).toEqual(["a", "b", "c"]);
  });

  it("seeds an empty trail", () => {
    expect(promoteHostOrSame([], "a", 400)).toEqual([visit("a", 400)]);
  });

  it("caps the trail, dropping the least recent", () => {
    expect(keys(promoteHostOrSame(TRAIL, "d", 400, 3))).toEqual([
      "d",
      "a",
      "b",
    ]);
  });

  it("forces the stamp strictly monotonic so same-ms switches still order", () => {
    const next = promoteHostOrSame(TRAIL, "c", 300);
    expect(next[0]?.switchedAt).toBeGreaterThan(TRAIL[0]!.switchedAt);
  });
});

describe("parseHostMru", () => {
  const NOW = 1_700_000_000_000;

  it("keeps well-formed entries in order", () => {
    const stored = [
      visit("local", NOW - 10),
      visit("remote:gpu-box", NOW - 20),
    ];
    expect(parseHostMru(JSON.stringify(stored), NOW)).toEqual(stored);
  });

  it("drops corrupt entries and duplicates without losing the good ones", () => {
    const raw = JSON.stringify([
      visit("local", NOW - 10),
      7,
      { hostKey: "not a host key!", switchedAt: NOW },
      { hostKey: "remote:gpu-box", switchedAt: "soon" },
      visit("local", NOW - 5),
    ]);
    expect(parseHostMru(raw, NOW)).toEqual([visit("local", NOW - 10)]);
  });

  it("caps a long stored trail", () => {
    const long = Array.from({ length: HOST_MRU_CAP + 5 }, (_, i) =>
      visit(i === 0 ? "local" : `remote:h${i}`, NOW - i),
    );
    expect(parseHostMru(JSON.stringify(long), NOW)).toHaveLength(HOST_MRU_CAP);
  });

  it("throws (so the pref falls back) when the stored value is not an array", () => {
    expect(() => parseHostMru(JSON.stringify({ local: 1 }))).toThrow();
  });
});

describe("createHostRecency — recording", () => {
  let dispose: (() => void) | undefined;

  function freshTrail(): Accessor<readonly HostVisit[]> {
    sessionStorage.clear();
    return createRoot((d) => {
      dispose = d;
      return createHostRecency();
    });
  }

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("records every switch off the active-host pref, newest first", () => {
    bag.setActive(LOCAL);
    const recency = freshTrail();
    expect(keys(recency())).toEqual(["local"]);

    bag.setActive(GPU);
    expect(keys(recency())).toEqual(["remote:gpu-box", "local"]);

    bag.setActive(BUILDER);
    expect(keys(recency())).toEqual([
      "remote:builder",
      "remote:gpu-box",
      "local",
    ]);

    bag.setActive(GPU);
    expect(keys(recency())).toEqual([
      "remote:gpu-box",
      "remote:builder",
      "local",
    ]);
  });

  it("ignores a re-assertion of the host already at the head", () => {
    bag.setActive(LOCAL);
    const recency = freshTrail();
    bag.setActive(GPU);
    const before = recency();
    bag.setActive({ kind: "remote", target: "gpu-box" });
    expect(recency()).toBe(before);
  });
});
