import type { PtyHostInventoryEvent, PtyHostListEntry } from "kaval";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { inventoryAdoptions } from "./inventoryReconcile.ts";

// Ids are validated against `TerminalIdSchema` (z.string().uuid()) at the
// inventory boundary, so the fixtures must be real RFC-4122 UUIDs (zod 4 checks
// the version/variant nibbles) — a non-UUID would be dropped before the
// tracked/untracked routing under test even runs.
const A = "550e8400-e29b-41d4-a716-446655440000";
const B = "123e4567-e89b-12d3-a456-426614174000";
const C = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const X = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const MINE = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
const GONE = "6ba7b814-9dad-11d1-80b4-00c04fd430c8";

/** A live inventory entry for `id` (the daemon snapshot's shape). */
function entry(id: string): PtyHostListEntry {
  return { id, pid: 1000, cwd: "/tmp", lastActivity: 0 };
}

/** `isTracked` for a fixed set of already-registered ids. */
const tracked =
  (...ids: string[]) =>
  (id: TerminalId): boolean =>
    (ids as string[]).includes(id);

/** `onInvalid` no-op — used by the cases where every fixture id parses. */
const noInvalid = (): void => {};

describe("inventoryAdoptions — what a live inventory frame tells kolu to adopt", () => {
  it("adopts the UNKNOWN entries of a snapshot, skips the tracked ones", () => {
    const ev: PtyHostInventoryEvent = {
      kind: "snapshot",
      entries: [entry(A), entry(B), entry(C)],
    };
    // `A` is kolu's own (already registered); `B`/`C` are out-of-band creates.
    expect(
      inventoryAdoptions(ev, tracked(A), noInvalid).map((a) => a.id),
    ).toEqual([B, C]);
  });

  it("adopts a `created` for an id kolu does not track (the kaval-tui case)", () => {
    const ev: PtyHostInventoryEvent = { kind: "created", entry: entry(X) };
    expect(
      inventoryAdoptions(ev, tracked(), noInvalid).map((a) => a.id),
    ).toEqual([X]);
  });

  it("skips a `created` for an id kolu already tracks (its own spawn echo)", () => {
    // `spawnPty` registers synchronously before the daemon's `created` arrives,
    // so the echo must be a no-op — no double-register, no double-wire.
    const ev: PtyHostInventoryEvent = { kind: "created", entry: entry(MINE) };
    expect(inventoryAdoptions(ev, tracked(MINE), noInvalid)).toEqual([]);
  });

  it("never adopts on `exited` — the per-id exit tap is the authority", () => {
    const ev: PtyHostInventoryEvent = { kind: "exited", id: GONE };
    // Untracked or tracked, an exit is never an adoption.
    expect(inventoryAdoptions(ev, tracked(), noInvalid)).toEqual([]);
    expect(inventoryAdoptions(ev, tracked(GONE), noInvalid)).toEqual([]);
  });

  it("drops a frame entry whose id fails TerminalIdSchema — never adopted", () => {
    // A malformed out-of-band id is reported to `onInvalid` and excluded from the
    // adoptions, so it never reaches `adoptLocalOrphan` as a branded id. A
    // non-UUID string is not a valid TerminalId.
    const ev: PtyHostInventoryEvent = {
      kind: "snapshot",
      entries: [entry("not-a-uuid"), entry(A)],
    };
    const invalid: string[] = [];
    const adoptions = inventoryAdoptions(ev, tracked(), (raw) =>
      invalid.push(raw),
    );
    expect(adoptions.map((a) => a.id)).toEqual([A]);
    expect(invalid).toEqual(["not-a-uuid"]);
  });
});
