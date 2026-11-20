import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PtyHostListEntry } from "kaval";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchInventoryFrame,
  type InventoryCreationFrame,
  inventoryAdoptions,
} from "./inventoryReconcile.ts";

const A = "550e8400-e29b-41d4-a716-446655440000";
const B = "123e4567-e89b-12d3-a456-426614174000";
const C = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const X = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const MINE = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
const GONE = "6ba7b814-9dad-11d1-80b4-00c04fd430c8";

function entry(id: string): PtyHostListEntry {
  return { id, pid: 1000, cwd: "/tmp", lastActivity: 0 };
}

const tracked =
  (...ids: string[]) =>
  (id: TerminalId): boolean =>
    (ids as string[]).includes(id);

const noInvalid = (): void => {};

describe("inventoryAdoptions — what a live inventory frame tells kolu to adopt", () => {
  it("adopts the UNKNOWN entries of a snapshot, skips the tracked ones", () => {
    const ev: InventoryCreationFrame = {
      kind: "snapshot",
      entries: [entry(A), entry(B), entry(C)],
    };
    expect(
      inventoryAdoptions(ev, tracked(A), noInvalid).map((a) => a.id),
    ).toEqual([B, C]);
  });

  it("adopts a `created` for an id kolu does not track (the kaval-tui case)", () => {
    const ev: InventoryCreationFrame = { kind: "created", entry: entry(X) };
    expect(
      inventoryAdoptions(ev, tracked(), noInvalid).map((a) => a.id),
    ).toEqual([X]);
  });

  it("skips a `created` for an id kolu already tracks (its own spawn echo)", () => {
    const ev: InventoryCreationFrame = { kind: "created", entry: entry(MINE) };
    expect(inventoryAdoptions(ev, tracked(MINE), noInvalid)).toEqual([]);
  });

  it("routes a frame entry whose id fails TerminalIdSchema to onInvalid — never adopted (F1)", () => {
    const ev: InventoryCreationFrame = {
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

describe("dispatchInventoryFrame — every adopted PTY reaches the adopt fn once (F2)", () => {
  it("dispatches each untracked `created` entry to adopt (the persisting path)", () => {
    const adopt = vi.fn();
    const onInvalid = vi.fn();
    dispatchInventoryFrame(
      { kind: "created", entry: entry(X) },
      tracked(),
      onInvalid,
      adopt,
    );
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt).toHaveBeenCalledWith(X, expect.objectContaining({ id: X }));
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("dispatches only the UNTRACKED entries of a snapshot (skips kolu's own)", () => {
    const adopt = vi.fn();
    dispatchInventoryFrame(
      { kind: "snapshot", entries: [entry(A), entry(B), entry(C)] },
      tracked(A),
      vi.fn(),
      adopt,
    );
    expect(adopt.mock.calls.map((c) => c[0])).toEqual([B, C]);
  });

  it("does not adopt on `exited` — the per-id exit tap is the authority", () => {
    const adopt = vi.fn();
    dispatchInventoryFrame(
      { kind: "exited", id: GONE },
      tracked(GONE),
      vi.fn(),
      adopt,
    );
    expect(adopt).not.toHaveBeenCalled();
  });

  it("routes a malformed id to onInvalid, never to adopt (F1)", () => {
    const adopt = vi.fn();
    const onInvalid = vi.fn();
    dispatchInventoryFrame(
      { kind: "snapshot", entries: [entry("not-a-uuid"), entry(A)] },
      tracked(),
      onInvalid,
      adopt,
    );
    expect(onInvalid).toHaveBeenCalledWith("not-a-uuid");
    expect(adopt.mock.calls.map((c) => c[0])).toEqual([A]);
  });
});
