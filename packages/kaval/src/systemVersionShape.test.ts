/**
 * Shape-pin for kaval's legacy `system.version` output. Supervisor identity now
 * rides the frozen control fragment, but this procedure stays byte-for-byte
 * unchanged for existing pid/lifetime/build-readout consumers. Zod strips
 * unknown keys, so exact key pins make an accidental wire edit fail loudly.
 */

import { describe, expect, it } from "vitest";
import {
  PtyHostIdentitySchema,
  SystemVersionOutputSchema,
} from "./ptyHostSurface.ts";

describe("system.version shape — frozen for existing consumers", () => {
  it("SystemVersionOutputSchema is exactly { contractVersion, identity?, lifetime?, pid, startedAt }", () => {
    expect(Object.keys(SystemVersionOutputSchema.shape).sort()).toEqual([
      "contractVersion",
      "identity",
      "lifetime",
      "pid",
      "startedAt",
    ]);
  });

  it("PtyHostIdentitySchema (the currency identity) is exactly { navigableCommit, staleKey }", () => {
    expect(Object.keys(PtyHostIdentitySchema.shape).sort()).toEqual([
      "navigableCommit",
      "staleKey",
    ]);
  });

  it("identity stays OPTIONAL — a daemon predating the field still handshakes", () => {
    expect(SystemVersionOutputSchema.shape.identity.isOptional()).toBe(true);
  });

  it("lifetime is OPTIONAL — a daemon predating the lifetime field still handshakes; the reader falls back to '—'", () => {
    expect(SystemVersionOutputSchema.shape.lifetime.isOptional()).toBe(true);
  });

  it("parses a handshake predating the lifetime field (no `lifetime` key → undefined), and round-trips one that carries it — the survivor stays compatible with NO contract bump", () => {
    // A pre-field 5.0 survivor's `system.version` carries no `lifetime` key at all.
    // It must parse (optional, additive — no PTY_HOST_CONTRACT_VERSION bump), leaving
    // `lifetime` undefined so the reader falls back to "—" rather than the parse
    // rejecting the survivor and forcing a recycle.
    const survivor = SystemVersionOutputSchema.parse({
      contractVersion: "5.0",
      pid: 1234,
      startedAt: 1000,
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
    });
    expect(survivor.lifetime).toBeUndefined();

    // A live daemon carries the projected lifetime; it survives the parse verbatim.
    const live = SystemVersionOutputSchema.parse({
      contractVersion: "5.0",
      pid: 1234,
      startedAt: 1000,
      identity: { staleKey: "abc", navigableCommit: "deadbeef" },
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    expect(live.lifetime).toEqual({ kind: "boundToPid", pid: 4321 });
  });
});
