import { defineSurface } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CONNECTION_STATES,
  connectionCell,
  ConnectionInfoSchema,
  DEFAULT_CONNECTION,
  mirroredSurface,
} from "./connection";
import { projectConnection } from "./connectionPipe";
import type { HostSessionState } from "./hostSession";

/** A minimal base surface to mirror — one cell, one collection. */
const baseSurface = defineSurface({
  cells: {
    version: { schema: z.object({ v: z.string() }), default: { v: "1" } },
  },
  collections: {
    items: { keySchema: z.string(), schema: z.object({ n: z.number() }) },
  },
});

describe("connection cell", () => {
  it("is gate-closed by default (connecting) — a fresh cell never reads connected", () => {
    // The load-bearing invariant: a composed cell starts `connecting`, so
    // "healthy-empty before the first frame" is structurally unrepresentable.
    expect(DEFAULT_CONNECTION.state).toBe("connecting");
    expect(ConnectionInfoSchema.parse(DEFAULT_CONNECTION)).toEqual(
      DEFAULT_CONNECTION,
    );
    expect(connectionCell.default).toBe(DEFAULT_CONNECTION);
    expect(connectionCell.schema).toBe(ConnectionInfoSchema);
  });

  it("is read-only over the wire — verbs is ['get'], never 'set'", () => {
    // The parent host OWNS this cell (it writes it server-side off
    // `session.onState`). A cell with no `patchSchema` would otherwise default to
    // `["get", "set"]` and leak `set` onto the browser-facing surface — letting a
    // remote client forge the host's health to `connected` and defeat the
    // stale-health gate. Pin the verbs so the contract can't silently regrow `set`.
    expect([...connectionCell.verbs]).toEqual(["get"]);
    expect(connectionCell.verbs).not.toContain("set");
  });

  it("CONNECTION_STATES mirrors the HostSession lifecycle 1:1", () => {
    expect([...CONNECTION_STATES]).toEqual([
      "copying",
      "connecting",
      "connected",
      "disconnected",
      "failed",
    ]);
  });

  it("projectConnection keeps the browser-facing four, dropping the remote-only field", () => {
    const s: HostSessionState = {
      connection: "failed",
      progressLines: ["[local] gave up", "[remote] kaval 3.2 vs pulam 3.3"],
      remoteProgressLines: ["kaval 3.2 vs pulam 3.3"],
      lastError: "exited with code 1",
      failureCause: "remote",
    };
    const info = projectConnection(s);
    expect(info).toEqual({
      state: "failed",
      lastError: "exited with code 1",
      failureCause: "remote",
      progressLines: ["[local] gave up", "[remote] kaval 3.2 vs pulam 3.3"],
    });
    // The projection NARROWED `HostSessionState` — `remoteProgressLines` is not
    // on the browser-facing shape (and the result validates against the schema).
    expect("remoteProgressLines" in info).toBe(false);
    expect(ConnectionInfoSchema.parse(info)).toEqual(info);
  });
});

describe("mirroredSurface", () => {
  it("augments the base with a get-only `connection` cell, preserving the rest", () => {
    const mirrored = mirroredSurface(baseSurface);
    // The connection cell is added…
    expect(Object.keys(mirrored.spec.cells ?? {})).toEqual(
      expect.arrayContaining(["version", "connection"]),
    );
    // …and the base's other primitives survive untouched.
    expect(Object.keys(mirrored.spec.collections ?? {})).toEqual(["items"]);
    expect(mirrored.spec.cells?.connection).toBe(connectionCell);
  });

  it("exposes `connection.get` over the wire but NOT `connection.set` (unforgeable)", () => {
    // The cell is read-only over RPC: the parent writes it server-side off
    // `session.onState`; a wire client must never `connection.set` to forge the
    // host's health. The contract is the wire shape a client can reach.
    const connection = (
      mirroredSurface(baseSurface).contract as {
        surface: { connection: Record<string, unknown> };
      }
    ).surface.connection;
    expect(connection.get).toBeTruthy();
    expect("set" in connection).toBe(false);
  });

  it("THROWS on a base that already declares a `connection` cell (reserved name)", () => {
    const collides = defineSurface({
      cells: {
        connection: { schema: z.object({ x: z.string() }), default: { x: "" } },
      },
    });
    expect(() => mirroredSurface(collides)).toThrow(/reserved/i);
  });
});
