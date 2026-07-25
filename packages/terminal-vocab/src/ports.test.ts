/**
 * The two operations that define what a `PortInfo` set MEANS — the collapse and
 * the equality — tested here rather than in either consumer, because both ends of
 * the wire depend on them and one of them (`portsEqual`) is what keeps a
 * seconds-cadence scanner from thrashing the client.
 *
 * These cases moved out of padi's `portScan.test.ts` when the fold moved into the
 * vocabulary: the client had grown a second implementation of the same algebra
 * (its tile merge), so the rule was stated twice with only one copy tested.
 */

import { describe, expect, it } from "vitest";
import { foldPorts, type PortInfo, portsEqual } from "./schema.ts";

const p = (port: number, wildcard = true, name = "node"): PortInfo => ({
  port,
  name,
  wildcard,
});

describe("foldPorts", () => {
  it("collapses a fork-inherited socket seen on several pids", () => {
    // One listener, several processes holding the same fd. Without the collapse
    // the Inspector shows the same port three times.
    expect(foldPorts([p(3000), p(3000), p(3000)])).toEqual([p(3000)]);
  });

  it("treats a port reachable on ANY of its binds as reachable", () => {
    // A server bound to both 127.0.0.1 and 0.0.0.0 contributes two rows for one
    // port. It IS reachable, so offering a forward for it would be wrong — and
    // picking whichever row came first would make the answer depend on fd order.
    expect(foldPorts([p(5173, false), p(5173, true)])).toEqual([p(5173, true)]);
    // …and the OR is order-independent, which is the whole point.
    expect(foldPorts([p(5173, true), p(5173, false)])).toEqual([p(5173, true)]);
  });

  it("keeps a port whose every bind is loopback as needing a forward", () => {
    expect(
      foldPorts([p(5432, false, "postgres"), p(5432, false, "postgres")]),
    ).toEqual([p(5432, false, "postgres")]);
  });

  it("sorts by port, so an unchanged host produces an identical sample", () => {
    // Load-bearing for the churn guard: `portsEqual` is order-sensitive, so an
    // unsorted fold would emit a "change" on iteration order alone, forever.
    expect(
      foldPorts([p(9229), p(3000), p(61922, true, "workerd")]).map(
        (x) => x.port,
      ),
    ).toEqual([3000, 9229, 61922]);
  });

  it("does not mutate its input", () => {
    // The fold copies before OR-ing `wildcard`; folding a caller's live snapshot
    // must not rewrite it (the client folds arrays that came off a reactive store).
    const rows = [p(80, false), p(80, true)];
    foldPorts(rows);
    expect(rows[0]).toEqual(p(80, false));
  });

  it("folds a TILE's panes as readily as one terminal's sockets", () => {
    // The client's use: several already-folded pane sets flattened into one tile.
    // Same algebra, which is why there is only one implementation.
    const main = [p(3000, false)];
    const split = [p(5173, true), p(3000, true)];
    expect(foldPorts([...main, ...split])).toEqual([
      p(3000, true),
      p(5173, true),
    ]);
  });

  it("is empty for no sockets", () => {
    expect(foldPorts([])).toEqual([]);
  });
});

describe("portsEqual", () => {
  it("accepts an unchanged sample, so an idle scan emits nothing", () => {
    expect(portsEqual([p(8080), p(9229)], [p(8080), p(9229)])).toBe(true);
    expect(portsEqual([], [])).toBe(true);
  });

  it("notices a port appearing or dying", () => {
    expect(portsEqual([p(8080)], [p(8080), p(9229)])).toBe(false);
    expect(portsEqual([p(8080)], [])).toBe(false);
  });

  it("notices a BIND change on the same port", () => {
    // A dev server restarted with `--host` keeps its number but stops needing a
    // forward. A port-number-only comparison would leave the chip inert forever.
    expect(portsEqual([p(5173, false)], [p(5173, true)])).toBe(false);
  });

  it("notices a NAME change on the same port", () => {
    expect(portsEqual([p(3000)], [p(3000, true, "workerd")])).toBe(false);
  });
});
