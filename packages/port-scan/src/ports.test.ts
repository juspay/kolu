/**
 * The two operations that define what a `PortInfo` SET means — the collapse and
 * the list equality — tested beside them rather than in either consumer, because
 * both ends of the wire depend on them and one of them (`samePortList`) is what
 * keeps a seconds-cadence scanner from thrashing its readers.
 *
 * These cases were once in padi's `portScan.test.ts`, then in the terminal
 * vocabulary; they follow the code, which now lives here. The cases that stayed
 * behind in `terminal-vocab/src/ports.test.ts` are the ones about a terminal
 * SNAPSHOT (`portsEqual`'s status flip, `portReach`), which are not port facts.
 */

import { describe, expect, it } from "vitest";
import {
  foldPorts,
  type PortInfo,
  PortInfoSchema,
  samePortList,
} from "./ports.ts";

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
    // Load-bearing for the churn guard: `samePortList` is order-sensitive, so an
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

  it("folds a TILE's panes as readily as one subtree's sockets", () => {
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

  it("folds the same SET to the same row whatever order it was observed in", () => {
    // Two programs on one port is a legitimate configuration (`127.0.0.1:8080`
    // and `192.168.1.5:8080`), and the scanner's pid-iteration order is no stable
    // function of the host's state — on linux it descends from `readdir("/proc")`.
    // A first-wins name would therefore flip between passes, and `samePortList`
    // reads the name, so every flip would republish "a change" forever.
    const rows = [p(8080, false, "python"), p(8080, false, "node")];
    expect(samePortList(foldPorts(rows), foldPorts([...rows].reverse()))).toBe(
      true,
    );
    expect(foldPorts(rows)).toEqual([p(8080, false, "node")]);
  });
});

describe("samePortList", () => {
  it("accepts an unchanged list, so an idle scan emits nothing", () => {
    expect(samePortList([p(8080), p(9229)], [p(8080), p(9229)])).toBe(true);
    expect(samePortList([], [])).toBe(true);
  });

  it("notices a port appearing or dying", () => {
    expect(samePortList([p(8080)], [p(8080), p(9229)])).toBe(false);
    expect(samePortList([p(8080)], [])).toBe(false);
  });

  it("notices a BIND change on the same port", () => {
    // A dev server restarted with `--host` keeps its number but stops needing a
    // forward. A port-number-only comparison would leave the chip inert forever.
    expect(samePortList([p(5173, false)], [p(5173, true)])).toBe(false);
  });

  it("notices a NAME change on the same port", () => {
    expect(samePortList([p(3000)], [p(3000, true, "workerd")])).toBe(false);
  });

  it("compares EVERY schema field, not a hand-listed subset", () => {
    // The reason the key list is read off `PortInfoSchema.shape`: a field added to
    // `PortInfo` without a matching edit here would be a field whose changes are
    // silently swallowed by the dedup gate. Asserting the derivation directly
    // means adding a field cannot quietly go uncompared — this fails the moment
    // the schema grows a key the comparison does not read.
    const differing: Array<[PortInfo, PortInfo]> = [
      [p(1000), { ...p(1000), port: 1001 }],
      [p(1000), { ...p(1000), name: "other" }],
      [p(1000), { ...p(1000), wildcard: false }],
    ];
    // Counted against the SCHEMA, not a literal: adding a field to `PortInfo`
    // reds this line until a pair covering it is added, which is the whole point.
    expect(differing).toHaveLength(Object.keys(PortInfoSchema.shape).length);
    for (const [a, b] of differing) {
      expect(samePortList([a], [b])).toBe(false);
    }
  });
});
