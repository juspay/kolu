/** The host switch trail behind ⌘⇧H's default highlight.
 *
 *  Two halves: the pure list moves (front-promote, dedupe, cap, rank, and the
 *  tolerant parse of a persisted trail), and the ONE wiring claim that makes
 *  the feature true — that merely OBSERVING `activeHost` records every switch,
 *  whichever surface made it (palette row, selector strip, mobile chip, the
 *  membership reconcile's bounce to local). The `./wire` mock is a bare signal
 *  standing in for that pref, so the test drives switches the same way the app
 *  does: by writing the active host. */

import type { HostKey } from "kolu-common/hostKey";
import { describe, expect, it, vi } from "vitest";

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
  HOST_MRU_CAP,
  hostVisitRank,
  parseHostMru,
  promoteHost,
  useHostRecency,
} from "./hostRecency";

const LOCAL: HostKey = { kind: "local" };
const GPU: HostKey = { kind: "remote", target: "gpu-box" };
const BUILDER: HostKey = { kind: "remote", target: "builder" };

describe("promoteHost", () => {
  it("moves the host to the front", () => {
    expect(promoteHost(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("dedupes rather than growing a second entry", () => {
    expect(promoteHost(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("seeds an empty trail", () => {
    expect(promoteHost([], "a")).toEqual(["a"]);
  });

  it("caps the trail, dropping the least recent", () => {
    expect(promoteHost(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("hostVisitRank", () => {
  it("ranks earlier entries higher", () => {
    const mru = ["a", "b", "c"];
    expect(hostVisitRank(mru, "a")).toBeGreaterThan(hostVisitRank(mru, "b"));
    expect(hostVisitRank(mru, "b")).toBeGreaterThan(hostVisitRank(mru, "c"));
  });

  it("ranks a never-visited host at 0, below every visited one", () => {
    const mru = ["a", "b"];
    expect(hostVisitRank(mru, "zzz")).toBe(0);
    expect(hostVisitRank(mru, "b")).toBeGreaterThan(0);
  });
});

describe("parseHostMru", () => {
  it("keeps well-formed keys in order", () => {
    expect(parseHostMru(JSON.stringify(["local", "remote:gpu-box"]))).toEqual([
      "local",
      "remote:gpu-box",
    ]);
  });

  it("drops corrupt entries and duplicates without losing the good ones", () => {
    expect(
      parseHostMru(JSON.stringify(["local", 7, "not a host key!", "local"])),
    ).toEqual(["local"]);
  });

  it("caps a long stored trail", () => {
    const long = Array.from({ length: HOST_MRU_CAP + 5 }, (_, i) =>
      i === 0 ? "local" : `remote:h${i}`,
    );
    expect(parseHostMru(JSON.stringify(long))).toHaveLength(HOST_MRU_CAP);
  });

  it("throws (so the pref falls back) when the stored value is not an array", () => {
    expect(() => parseHostMru(JSON.stringify({ local: 1 }))).toThrow();
  });
});

// One app-lifetime trail per module (`createSharedRoot`), so these two run
// against the SAME store — each drives the switches it asserts on rather than
// assuming a clean slate.
describe("useHostRecency — recording", () => {
  it("records every switch off the active-host pref, newest first", () => {
    const recency = useHostRecency();
    // The boot host is the trail's first entry (the effect runs immediately).
    expect(recency.mru()).toEqual(["local"]);

    bag.setActive(GPU);
    expect(recency.mru()).toEqual(["remote:gpu-box", "local"]);

    bag.setActive(BUILDER);
    expect(recency.mru()).toEqual([
      "remote:builder",
      "remote:gpu-box",
      "local",
    ]);

    // Switching back re-promotes rather than appending a duplicate.
    bag.setActive(GPU);
    expect(recency.mru()).toEqual([
      "remote:gpu-box",
      "remote:builder",
      "local",
    ]);
  });

  it("ranks the host you came from above the rest — the ⌘⇧H toggle target", () => {
    const recency = useHostRecency();
    bag.setActive(LOCAL);
    bag.setActive(BUILDER);
    bag.setActive(GPU);
    // Active is GPU; BUILDER is where the user came from.
    expect(recency.rankOf(BUILDER)).toBeGreaterThan(recency.rankOf(LOCAL));
    expect(recency.rankOf(GPU)).toBeGreaterThan(recency.rankOf(BUILDER));
  });
});
