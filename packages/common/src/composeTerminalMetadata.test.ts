/**
 * `composeTerminalMetadata` — the ONE producer of the wire `TerminalMetadata`
 * from the AUTHORED record + the AWARENESS store value (Design-S, R8).
 *
 * These pin the load-bearing sleeping-arm invariant: a sleeping terminal's `pr`
 * is sourced EXCLUSIVELY from the authored (frozen) record, never from the
 * store's live half — so a legacy sleeping record predating the frozen-pr field
 * stays pr-absent instead of leaking the store's `pr: pending`, and the live
 * half (`agent`/`foreground`) never reaches the sleeping wire.
 */

import type { AwarenessValue } from "@kolu/terminal-workspace";
import { describe, expect, it } from "vitest";
import {
  type AuthoredActiveTerminal,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "./surface.ts";

/** A live awareness value with a `pending` PR and a foreground process — both
 *  live-half fields that must NOT survive onto a sleeping wire. */
const liveAwareness = (over: Partial<AwarenessValue> = {}): AwarenessValue => ({
  cwd: "/repo",
  git: null,
  lastActivityAt: 0,
  pr: { kind: "pending" },
  agent: null,
  foreground: { name: "vim", title: null },
  ...over,
});

describe("composeTerminalMetadata — the sleeping arm's pr comes only from authored", () => {
  it("a legacy sleeping record with no frozen pr stays pr-absent (no leaked store pending)", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(authored, liveAwareness());
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(wire.pr).toBeUndefined();
  });

  it("a sleeping record WITH a frozen pr keeps the frozen value, not the store's live pr", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      state: "sleeping",
      sleptAt: 123,
      pr: { kind: "absent" }, // the frozen snapshot — must win over the store's `pending`
    };
    const wire = composeTerminalMetadata(
      authored,
      liveAwareness({ pr: { kind: "pending" } }),
    );
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(wire.pr).toEqual({ kind: "absent" });
  });

  it("strips the live half (agent/foreground) from a sleeping wire", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(authored, liveAwareness());
    // The persisted half survives; the live half does not exist on a sleeping arm.
    expect(wire.cwd).toBe("/repo");
    expect("foreground" in wire).toBe(false);
    expect("agent" in wire).toBe(false);
  });

  it("the active arm carries the full awareness, pr included", () => {
    const authored: AuthoredActiveTerminal = {
      location: LOCAL_LOCATION,
      state: "active",
    };
    const wire = composeTerminalMetadata(authored, liveAwareness());
    if (wire.state !== "active") throw new Error("expected active arm");
    expect(wire.pr).toEqual({ kind: "pending" });
    expect(wire.foreground).toEqual({ name: "vim", title: null });
  });
});
