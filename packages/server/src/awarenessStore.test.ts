/**
 * The awareness store leaf — set/remove lockstep, the identity/aliasing contract
 * `record.meta` relies on, and the late-write-after-remove drop.
 */

import type { AwarenessValue } from "kolu-common/surface";
import { afterEach, describe, expect, it } from "vitest";
import {
  awarenessFor,
  awarenessReadAll,
  mutateAwarenessLive,
  mutateAwarenessPersisted,
  removeAwareness,
  setAwareness,
} from "./awarenessStore.ts";

const ID = "store-test-id";

function value(): AwarenessValue {
  return {
    cwd: "/x",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
  };
}

afterEach(() => {
  removeAwareness(ID);
});

describe("awarenessStore", () => {
  it("set/get round-trips the SAME object (identity — record.meta aliases it)", () => {
    const v = value();
    setAwareness(ID, v);
    // Not a copy: the sensor record holds this exact object and mutates it in place.
    expect(awarenessFor(ID)).toBe(v);
  });

  it("remove drops the entry and reports prior presence", () => {
    setAwareness(ID, value());
    expect(removeAwareness(ID)).toBe(true);
    expect(awarenessFor(ID)).toBeUndefined();
    expect(removeAwareness(ID)).toBe(false);
  });

  it("readAll exposes the live map (same object identity)", () => {
    const v = value();
    setAwareness(ID, v);
    expect(awarenessReadAll().get(ID)).toBe(v);
  });

  it("mutateAwarenessPersisted mutates in place and returns the same object", () => {
    const v = value();
    setAwareness(ID, v);
    const ret = mutateAwarenessPersisted(ID, (m) => {
      m.cwd = "/new";
    });
    expect(ret).toBe(v);
    expect(awarenessFor(ID)?.cwd).toBe("/new");
  });

  it("mutateAwarenessLive mutates in place and returns the same object", () => {
    const v = value();
    setAwareness(ID, v);
    const ret = mutateAwarenessLive(ID, (m) => {
      m.foreground = { name: "vim", title: null };
    });
    expect(ret).toBe(v);
    expect(awarenessFor(ID)?.foreground).toEqual({ name: "vim", title: null });
  });

  it("a late write after removal is DROPPED (returns undefined, no resurrection)", () => {
    setAwareness(ID, value());
    removeAwareness(ID);
    const ret = mutateAwarenessPersisted(ID, (m) => {
      m.cwd = "/zombie";
    });
    expect(ret).toBeUndefined();
    // The store entry is NOT resurrected by a post-removal mutate.
    expect(awarenessFor(ID)).toBeUndefined();
  });
});
