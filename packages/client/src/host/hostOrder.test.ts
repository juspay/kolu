/** The host-tab arrangement rule — the stored order as an OVERLAY on pool
 *  membership, never a second membership authority. Pure-function tests, the
 *  convention this directory already follows (`hostOverflow.test.ts`). */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { moveHostKey, orderHostKeys, reorderableHostKeys } from "./hostOrder";

const LOCAL: HostKey = { kind: "local" };
const remote = (target: string): HostKey => ({ kind: "remote", target });
const ZEST = remote("zest");
const BUILDER = remote("srid@builder");
const PU = remote("pu-dev");

const keys = (hosts: readonly HostKey[]): string[] => hosts.map(encodeHostKey);

describe("orderHostKeys", () => {
  it("keeps pool order when nothing is stored", () => {
    expect(keys(orderHostKeys([LOCAL, ZEST, BUILDER], []))).toEqual([
      "local",
      "remote:zest",
      "remote:srid@builder",
    ]);
  });

  it("arranges members by the stored order", () => {
    expect(
      keys(
        orderHostKeys(
          [LOCAL, ZEST, BUILDER, PU],
          ["remote:pu-dev", "remote:srid@builder", "remote:zest"],
        ),
      ),
    ).toEqual(["local", "remote:pu-dev", "remote:srid@builder", "remote:zest"]);
  });

  it("pins LOCAL first even when the stored order names it elsewhere", () => {
    // A hand-edited store (or a future spelling) cannot push local off the
    // front — it is the pool's unremovable default and the escape hatch.
    expect(
      keys(orderHostKeys([LOCAL, ZEST], ["remote:zest", "local"])),
    ).toEqual(["local", "remote:zest"]);
  });

  it("lands a host the stored order never named at the END, in pool order", () => {
    // The newly-added-host case: `builder` joins a pool whose arrangement
    // predates it, and does not jump the queue.
    expect(
      keys(orderHostKeys([LOCAL, ZEST, BUILDER, PU], ["remote:pu-dev"])),
    ).toEqual(["local", "remote:pu-dev", "remote:zest", "remote:srid@builder"]);
  });

  it("ignores a stored key that is no longer a member — no hole", () => {
    expect(
      keys(
        orderHostKeys(
          [LOCAL, ZEST],
          ["remote:gone", "remote:zest", "remote:also-gone"],
        ),
      ),
    ).toEqual(["local", "remote:zest"]);
  });

  it("never lists a host twice when the stored order repeats a key", () => {
    expect(
      keys(orderHostKeys([LOCAL, ZEST, PU], ["remote:zest", "remote:zest"])),
    ).toEqual(["local", "remote:zest", "remote:pu-dev"]);
  });

  it("is membership-driven: a stored order over an empty pool lists nothing", () => {
    // The pre-snapshot warming window — the overlay must not invent members.
    expect(orderHostKeys([], ["remote:zest"])).toEqual([]);
  });
});

describe("reorderableHostKeys", () => {
  it("drops the pinned local host — it is never stored, never dragged", () => {
    expect(reorderableHostKeys([LOCAL, ZEST, PU])).toEqual([
      "remote:zest",
      "remote:pu-dev",
    ]);
  });
});

describe("moveHostKey", () => {
  const all = ["remote:a", "remote:b", "remote:c", "remote:d"];

  it("moves a host onto the target's slot, shifting the rest", () => {
    expect(moveHostKey(all, "remote:d", "remote:b")).toEqual([
      "remote:a",
      "remote:d",
      "remote:b",
      "remote:c",
    ]);
  });

  it("moves forward as well as back", () => {
    expect(moveHostKey(all, "remote:a", "remote:c")).toEqual([
      "remote:b",
      "remote:c",
      "remote:a",
      "remote:d",
    ]);
  });

  it("keeps an OVERFLOWED host's relative slot through a drag it took no part in", () => {
    // `c` and `d` are folded into the "⋯ +N" menu; dragging `b` before `a`
    // must leave the overflowed pair exactly where they were.
    expect(moveHostKey(all, "remote:b", "remote:a")).toEqual([
      "remote:b",
      "remote:a",
      "remote:c",
      "remote:d",
    ]);
  });

  it("drops onto the TARGET HOST's slot in the arrangement, not the seat it is borrowing", () => {
    // The active host is kept visible at every width: when it was overflowed,
    // `computeVisibleHosts` seats it LAST on the strip while its slot in the
    // arrangement stays put (here `d`, seated beside `a`). Dropping `a` onto it
    // therefore lands `a` at `d`'s index in the arrangement — inside the
    // overflow — rather than beside `a`'s own visible neighbours. The
    // arrangement is what the gesture edits; a borrowed seat is a width
    // accident, not an order the user set.
    expect(moveHostKey(all, "remote:a", "remote:d")).toEqual([
      "remote:b",
      "remote:c",
      "remote:d",
      "remote:a",
    ]);
  });

  it("is a no-op for an unknown id (a host that left mid-gesture)", () => {
    expect(moveHostKey(all, "remote:gone", "remote:b")).toEqual(all);
    expect(moveHostKey(all, "remote:b", "remote:gone")).toEqual(all);
  });

  it("is a no-op when a host is dropped on itself", () => {
    expect(moveHostKey(all, "remote:c", "remote:c")).toEqual(all);
  });
});
