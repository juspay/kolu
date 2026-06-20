import type { PtyHostInventoryEvent, PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import { inventoryAdoptions } from "./inventoryReconcile.ts";

/** A live inventory entry for `id` (the daemon snapshot's shape). */
function entry(id: string): PtyHostListEntry {
  return { id, pid: 1000, cwd: "/tmp", lastActivity: 0 };
}

/** `isTracked` for a fixed set of already-registered ids. */
const tracked =
  (...ids: string[]) =>
  (id: string): boolean =>
    ids.includes(id);

describe("inventoryAdoptions — what a live inventory frame tells kolu to adopt", () => {
  it("adopts the UNKNOWN entries of a snapshot, skips the tracked ones", () => {
    const ev: PtyHostInventoryEvent = {
      kind: "snapshot",
      entries: [entry("a"), entry("b"), entry("c")],
    };
    // `a` is kolu's own (already registered); `b`/`c` are out-of-band creates.
    expect(inventoryAdoptions(ev, tracked("a")).map((e) => e.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("adopts a `created` for an id kolu does not track (the kaval-tui case)", () => {
    const ev: PtyHostInventoryEvent = { kind: "created", entry: entry("x") };
    expect(inventoryAdoptions(ev, tracked()).map((e) => e.id)).toEqual(["x"]);
  });

  it("skips a `created` for an id kolu already tracks (its own spawn echo)", () => {
    // `spawnPty` registers synchronously before the daemon's `created` arrives,
    // so the echo must be a no-op — no double-register, no double-wire.
    const ev: PtyHostInventoryEvent = { kind: "created", entry: entry("mine") };
    expect(inventoryAdoptions(ev, tracked("mine"))).toEqual([]);
  });

  it("never adopts on `exited` — the per-id exit tap is the authority", () => {
    const ev: PtyHostInventoryEvent = { kind: "exited", id: "gone" };
    // Untracked or tracked, an exit is never an adoption.
    expect(inventoryAdoptions(ev, tracked())).toEqual([]);
    expect(inventoryAdoptions(ev, tracked("gone"))).toEqual([]);
  });
});
