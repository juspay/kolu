/**
 * What the ONE ports section shows — the merge of what used to be two.
 *
 * Field feedback, screenshot-grounded: the Inspector stacked a PORTS group and a
 * FORWARDED PORTS group, and a forwarded port appeared in BOTH — once as a chip
 * with a `⇄ :5173` badge, again as a row reading `naiveintent:5173 → :5173`. Two
 * renderings of one fact, which is confusing in exactly the way duplicated state
 * always is: it invites the reader to look for the difference.
 *
 * The merge has to keep the reason the second group existed, though, and that
 * reason is real: **a forward is a fact about the HOST, not about a terminal.** A
 * ⌘K manual forward belongs to no tile at all, and an `auto` forward outlives the
 * listener that earned it (by up to a reap interval) and the tile that opened it.
 * Those must stay visible and cancellable — so they join the same section as a
 * subdued trailing group rather than vanishing with the titled one.
 *
 * This file pins the JOIN that produces the rows. The rendering reads it.
 */

import type { KoluForward, PortInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { portRows } from "./portRows";

const LOCAL = { kind: "local" as const };
const ZEST = { kind: "remote" as const, target: "zest" };

const port = (p: number, name = "node"): PortInfo => ({
  port: p,
  name,
  scope: "loopback",
  family: "v4",
});

const forward = (
  remotePort: number,
  localPort: number,
  origin: "auto" | "manual" = "auto",
  host: KoluForward["host"] = LOCAL,
): KoluForward => ({
  key: `k:${remotePort}`,
  host,
  remotePort,
  localPort,
  origin,
  createdAt: 0,
});

describe("portRows", () => {
  it("renders a scanned port ONCE, carrying its forward inline", () => {
    // The defect the merge fixes: this used to be a chip in one group AND a row
    // in another. One port, one row, with the door's state on it.
    const rows = portRows({
      ports: [port(5173)],
      forwards: [forward(5173, 5173)],
      host: LOCAL,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "port",
      port: 5173,
      // The program name is the OBSERVATION's, read through `info` — the row
      // does not carry a second copy of a field the observation already has.
      info: expect.objectContaining({ name: "node" }),
      forward: expect.objectContaining({ localPort: 5173, origin: "auto" }),
    });
  });

  it("leaves a port with no forward carrying none", () => {
    const rows = portRows({ ports: [port(3000)], forwards: [], host: LOCAL });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "port", port: 3000 });
    expect(rows[0]?.forward).toBeUndefined();
  });

  it("keeps a HOST forward that matches no scanned port — as a trailing row", () => {
    // A ⌘K manual forward, or one whose listener has died but whose door is not
    // reaped yet. Dropping it would leave an open door with nothing anywhere to
    // cancel it from, which is the whole reason the second group existed.
    const rows = portRows({
      ports: [port(3000)],
      forwards: [forward(9229, 61000, "manual")],
      host: LOCAL,
    });

    expect(rows.map((r) => r.kind)).toEqual(["port", "orphan"]);
    expect(rows[1]).toMatchObject({
      kind: "orphan",
      port: 9229,
      forward: expect.objectContaining({ origin: "manual" }),
    });
  });

  it("puts every orphan AFTER every scanned port", () => {
    // Hierarchy: what this terminal is serving is the section's subject, and the
    // host's other doors are the footnote. Interleaving them by number would
    // bury the subject in the footnote.
    const rows = portRows({
      ports: [port(8080)],
      forwards: [forward(80, 61000, "manual"), forward(8080, 8080)],
      host: LOCAL,
    });

    expect(rows.map((r) => [r.kind, r.port])).toEqual([
      ["port", 8080],
      ["orphan", 80],
    ]);
  });

  it("ignores forwards belonging to another host", () => {
    // Forwards are host-scoped; a door to zest has no business appearing under a
    // terminal on the local host, matched port number or not.
    const rows = portRows({
      ports: [port(5173)],
      forwards: [forward(5173, 5173, "auto", ZEST)],
      host: LOCAL,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.forward).toBeUndefined();
  });

  it("sorts orphans by port, so the trailing group is stable", () => {
    // `<For>` keys by identity and the list re-derives on every forward change;
    // an unstable order would rebuild the rows' DOM on unrelated ticks.
    const rows = portRows({
      ports: [],
      forwards: [forward(9229, 1), forward(80, 2), forward(3000, 3)],
      host: LOCAL,
    });

    expect(rows.map((r) => r.port)).toEqual([80, 3000, 9229]);
  });

  it("is empty when there is nothing to say", () => {
    // The section renders nothing at all in that case — a heading over an empty
    // list would advertise a feature as broken rather than unused.
    expect(portRows({ ports: [], forwards: [], host: LOCAL })).toEqual([]);
  });
});
