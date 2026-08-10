/** The host switch trail behind ⌘⇧H's default highlight.
 *
 *  Two halves: the pure list moves (front-promote with a monotonic stamp,
 *  dedupe, cap, and the tolerant parse of a persisted trail), and the ONE wiring
 *  claim that makes the feature true — that merely OBSERVING `activeHost`
 *  records every switch, whichever surface made it (palette row, selector strip,
 *  mobile chip, the membership reconcile's bounce to local). The `./wire` mock
 *  is a bare signal standing in for that pref, so the test drives switches the
 *  same way the app does: by writing the active host. */

import type { HostKey } from "kolu-common/hostKey";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => {
  // Set inside the mock factory (hoisted above the imports it needs).
  return { setActive: (_h: HostKey) => {} };
});

vi.mock("../wire", async () => {
  const { createSignal: signal } = await import("solid-js");
  const [active, setActive] = signal<HostKey>({ kind: "local" });
  bag.setActive = (h: HostKey) => setActive(h);
  return { activeHost: active };
});

import {
  createHostRecency,
  HOST_MRU_CAP,
  type HostRecencyApi,
  type HostVisit,
  parseHostMru,
  promoteHost,
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

describe("promoteHost", () => {
  const TRAIL = [visit("a", 300), visit("b", 200), visit("c", 100)];

  it("moves the host to the front", () => {
    expect(keys(promoteHost(TRAIL, "c", 400))).toEqual(["c", "a", "b"]);
  });

  it("dedupes rather than growing a second entry", () => {
    expect(keys(promoteHost(TRAIL, "a", 400))).toEqual(["a", "b", "c"]);
  });

  it("seeds an empty trail", () => {
    expect(promoteHost([], "a", 400)).toEqual([visit("a", 400)]);
  });

  it("caps the trail, dropping the least recent", () => {
    expect(keys(promoteHost(TRAIL, "d", 400, 3))).toEqual(["d", "a", "b"]);
  });

  it("forces the stamp strictly monotonic so same-ms switches still order", () => {
    const next = promoteHost(TRAIL, "c", 300);
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

  /** A FRESH trail per case — `createHostRecency` is exported apart from the
   *  app-lifetime instance precisely so no case inherits another's residue.
   *  Built in its own root and RETURNED, so the switches a case drives land
   *  outside that root's update cycle and each effect run flushes at once. */
  function freshTrail(): HostRecencyApi {
    // The trail is a per-TAB pref; wipe the tab so the case boots from [].
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
    // The boot host is the trail's first entry (the effect runs immediately).
    expect(keys(recency.mru())).toEqual(["local"]);

    bag.setActive(GPU);
    expect(keys(recency.mru())).toEqual(["remote:gpu-box", "local"]);

    bag.setActive(BUILDER);
    expect(keys(recency.mru())).toEqual([
      "remote:builder",
      "remote:gpu-box",
      "local",
    ]);

    // Switching back re-promotes rather than appending a duplicate.
    bag.setActive(GPU);
    expect(keys(recency.mru())).toEqual([
      "remote:gpu-box",
      "remote:builder",
      "local",
    ]);
  });

  it("stamps the host you came from above the rest — the ⌘⇧H toggle target", () => {
    bag.setActive(LOCAL);
    const recency = freshTrail();
    bag.setActive(BUILDER);
    bag.setActive(GPU);
    // Active is GPU; BUILDER is where the user came from.
    const stamp = (hostKey: string) =>
      recency.mru().find((e) => e.hostKey === hostKey)?.switchedAt ?? 0;
    expect(stamp("remote:builder")).toBeGreaterThan(stamp("local"));
    expect(stamp("remote:gpu-box")).toBeGreaterThan(stamp("remote:builder"));
  });
});
