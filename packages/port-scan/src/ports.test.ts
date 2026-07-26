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
  type PortFamily,
  type PortScope,
  preferredFamily,
  samePortList,
  widerScope,
} from "./ports.ts";

const p = (
  port: number,
  scope: PortScope = "any",
  name = "node",
  family: PortFamily = "v4",
): PortInfo => ({
  port,
  name,
  scope,
  family,
});

describe("widerScope", () => {
  it("ranks any > loopback > interface, in either argument order", () => {
    // The fold's whole ordering, asserted directly: a total order stated once
    // here is what makes `foldPorts` independent of the order it observed its
    // rows in — which is not a nicety, since `samePortList` reads the result and
    // an order-dependent fold would republish a "change" on every pass forever.
    const scopes: PortScope[] = ["any", "interface", "loopback"];
    for (const a of scopes) {
      for (const b of scopes) {
        expect(widerScope(a, b)).toBe(widerScope(b, a));
      }
    }
    expect(widerScope("interface", "any")).toBe("any");
    expect(widerScope("loopback", "any")).toBe("any");
    expect(widerScope("loopback", "loopback")).toBe("loopback");
  });

  it("prefers a LOOPBACK bind over an interface one — it is the one kolu can open", () => {
    // The ordering is about what kolu can DO with the bind, not about how many
    // machines could reach it unaided. `interface` reads as reachable-from-more-
    // places, and that is true of a person on the LAN — but it is the ONE scope
    // no mechanism serves: both a relay and `ssh -L` dial the far side's
    // LOOPBACK, so an interface-bound port is the "not reachable" row.
    //
    // A server bound to BOTH `192.168.1.5:5173` and `127.0.0.1:5173` therefore
    // has a door — through the loopback bind. Folding it to `interface` would
    // report "no forward can reach it" about a port a forward reaches fine.
    expect(widerScope("loopback", "interface")).toBe("loopback");
  });
});

describe("foldPorts — scope and family are folded TOGETHER", () => {
  it("takes the family from the bind whose scope WON, not from the other one", () => {
    // The trap: fold the two fields independently and they can come from
    // different rows. A server on `192.168.1.5:5173` (v4) and `[::1]:5173` (v6)
    // folds to scope=loopback — right, the doorable bind wins — and family=v4,
    // because v4 beats v6 on its own axis. The door then dials `127.0.0.1:5173`,
    // where nothing is listening: it opens, reports success, and serves nothing.
    //
    // That is the SAME failure `family` was added to stop, recreated one level
    // up at the fold. The family is a property OF a bind, so it can only be read
    // off the binds that survived the scope decision.
    expect(
      foldPorts([
        p(5173, "interface", "node", "v4"),
        p(5173, "loopback", "node", "v6"),
      ]),
    ).toEqual([p(5173, "loopback", "node", "v6")]);
    // …and order-independent, like every other property of this fold.
    expect(
      foldPorts([
        p(5173, "loopback", "node", "v6"),
        p(5173, "interface", "node", "v4"),
      ]),
    ).toEqual([p(5173, "loopback", "node", "v6")]);
  });

  it("still prefers v4 when BOTH binds are the winning scope", () => {
    // Within one scope the old rule is exactly right: a v4 dial reaches a v4
    // listener and a dual-stack one, so a port answering on both loopbacks
    // dials v4.
    expect(
      foldPorts([
        p(5173, "loopback", "node", "v6"),
        p(5173, "loopback", "node", "v4"),
      ]),
    ).toEqual([p(5173, "loopback", "node", "v4")]);
  });
});

describe("preferredFamily", () => {
  it("prefers v4 when a port is bound on both, in either order", () => {
    // A v4 dial reaches a v4 listener and a dual-stack one; a v6 dial reaches
    // neither half of a v4-only pair. So when a port answers on both, v4 is the
    // dial that cannot be wrong.
    expect(preferredFamily("v4", "v6")).toBe("v4");
    expect(preferredFamily("v6", "v4")).toBe("v4");
    expect(preferredFamily("v4", "v4")).toBe("v4");
  });

  it("keeps v6 when that is the only family bound", () => {
    // The case the whole field exists for: a `[::1]`-only dev server. Folding
    // this to v4 is what opened a door onto an address with no listener.
    expect(preferredFamily("v6", "v6")).toBe("v6");
  });
});

describe("foldPorts", () => {
  it("collapses a fork-inherited socket seen on several pids", () => {
    // One listener, several processes holding the same fd. Without the collapse
    // the Inspector shows the same port three times.
    expect(foldPorts([p(3000), p(3000), p(3000)])).toEqual([p(3000)]);
  });

  it("folds a port to its WIDEST bind", () => {
    // A server bound to both 127.0.0.1 and 0.0.0.0 contributes two rows for one
    // port. It IS reachable, so offering a forward for it would be wrong — and
    // picking whichever row came first would make the answer depend on fd order.
    expect(foldPorts([p(5173, "loopback"), p(5173, "any")])).toEqual([
      p(5173, "any"),
    ]);
    // …and the widening is order-independent, which is the whole point.
    expect(foldPorts([p(5173, "any"), p(5173, "loopback")])).toEqual([
      p(5173, "any"),
    ]);
    // The three-way's own case, and the one pair where "reaches more machines"
    // and "kolu can do more with it" disagree: an interface bind answers
    // somewhere off-box, but it is the ONE scope no mechanism serves, while the
    // loopback bind beside it has a door. The fold keeps the door.
    expect(foldPorts([p(4000, "loopback"), p(4000, "interface")])).toEqual([
      p(4000, "loopback"),
    ]);
    expect(foldPorts([p(4000, "interface"), p(4000, "any")])).toEqual([
      p(4000, "any"),
    ]);
  });

  it("keeps a port whose every bind is loopback as needing a forward", () => {
    expect(
      foldPorts([
        p(5432, "loopback", "postgres"),
        p(5432, "loopback", "postgres"),
      ]),
    ).toEqual([p(5432, "loopback", "postgres")]);
  });

  it("sorts by port, so an unchanged host produces an identical sample", () => {
    // Load-bearing for the churn guard: `samePortList` is order-sensitive, so an
    // unsorted fold would emit a "change" on iteration order alone, forever.
    expect(
      foldPorts([p(9229), p(3000), p(61922, "any", "workerd")]).map(
        (x) => x.port,
      ),
    ).toEqual([3000, 9229, 61922]);
  });

  it("does not mutate its input", () => {
    // The fold copies before widening `scope`; folding a caller's live snapshot
    // must not rewrite it (the client folds arrays that came off a reactive store).
    const rows = [p(80, "loopback"), p(80, "any")];
    foldPorts(rows);
    expect(rows[0]).toEqual(p(80, "loopback"));
  });

  it("folds a TILE's panes as readily as one subtree's sockets", () => {
    // The client's use: several already-folded pane sets flattened into one tile.
    // Same algebra, which is why there is only one implementation.
    const main = [p(3000, "loopback")];
    const split = [p(5173, "any"), p(3000, "any")];
    expect(foldPorts([...main, ...split])).toEqual([
      p(3000, "any"),
      p(5173, "any"),
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
    const rows = [p(8080, "loopback", "python"), p(8080, "loopback", "node")];
    expect(samePortList(foldPorts(rows), foldPorts([...rows].reverse()))).toBe(
      true,
    );
    expect(foldPorts(rows)).toEqual([p(8080, "loopback", "node")]);
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
    expect(samePortList([p(5173, "loopback")], [p(5173, "any")])).toBe(false);
  });

  it("notices a NAME change on the same port", () => {
    expect(samePortList([p(3000)], [p(3000, "any", "workerd")])).toBe(false);
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
      [p(1000), { ...p(1000), scope: "loopback" }],
      [p(1000), { ...p(1000), family: "v6" }],
    ];
    // Counted against the SCHEMA, not a literal: adding a field to `PortInfo`
    // reds this line until a pair covering it is added, which is the whole point.
    expect(differing).toHaveLength(Object.keys(PortInfoSchema.shape).length);
    for (const [a, b] of differing) {
      expect(samePortList([a], [b])).toBe(false);
    }
  });
});
