import { defineSurface } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ConnectionInfoSchema,
  connectionCell,
  DEFAULT_CONNECTION,
  mirroredSurface,
  type WithConnection,
} from "./connection";
import { projectConnection } from "./connectionPipe";
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

/** A minimal base surface to mirror — one cell, one collection. */
const baseSurface = defineSurface({
  cells: {
    version: { schema: z.object({ v: z.string() }), default: { v: "1" } },
  },
  collections: {
    items: { keySchema: z.string(), schema: z.object({ n: z.number() }) },
  },
});

// ── Compile-time regression: a CELL-LESS base mirrors to EXACTLY `{ connection }`.
// A collection/stream-only surface has no `cells` member, so `S["cells"]` is
// absent; `WithConnection` must model that as `{}` and add only `connection` —
// NOT widen through `SurfaceSpec`'s `Record<string, CellSpec>` constraint (which
// would type the mirror as carrying arbitrary string-keyed cells). These assertions
// fail to compile if the type regrows the widened shape.
const cellLessBase = defineSurface({
  collections: {
    items: { keySchema: z.string(), schema: z.object({ n: z.number() }) },
  },
});
type CellLessSpec = typeof cellLessBase.spec;
type MirroredCells = WithConnection<CellLessSpec>["cells"];
// `connection` is present and is exactly `connectionCell`.
const _connPresent: MirroredCells["connection"] = connectionCell;
// The cell map has NO arbitrary string index — a bogus key must NOT typecheck.
// @ts-expect-error — a cell-less base's mirror carries ONLY `connection`, not an
// open string index of `CellSpec`s.
const _noArbitraryKey: MirroredCells["someOtherCell"] = connectionCell;
void _connPresent;
void _noArbitraryKey;

describe("connection cell", () => {
  it("is gate-closed by default (connecting) — a fresh cell never reads connected", () => {
    // The load-bearing invariant: a composed cell starts `connecting`, so
    // "healthy-empty before the first frame" is structurally unrepresentable.
    expect(DEFAULT_CONNECTION.phase).toBe("connecting");
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

  it("mirrors the session sum: the up phases carry only `log` + `sinceMs`, the down phases require error+cause", () => {
    // UP arms (incl. the ssh connector's `probing` opening phase) — parse with only
    // `log` + `sinceMs`, no error fields.
    for (const phase of [
      "probing",
      "copying",
      "building",
      "connecting",
      "connected",
    ]) {
      expect(
        ConnectionInfoSchema.parse({ phase, log: [], sinceMs: 0 }),
      ).toEqual({
        phase,
        log: [],
        sinceMs: 0,
      });
    }
    // `disconnected` requires error + cause (network | remote); `failed` pins cause
    // to the `"remote"` literal — a `failed`+`network` value is rejected.
    expect(() =>
      ConnectionInfoSchema.parse({
        phase: "disconnected",
        log: [],
        sinceMs: 0,
      }),
    ).toThrow();
    expect(
      ConnectionInfoSchema.parse({
        phase: "failed",
        error: "x",
        cause: "remote",
        log: [],
        sinceMs: 0,
      }),
    ).toMatchObject({ phase: "failed", cause: "remote" });
    expect(() =>
      ConnectionInfoSchema.parse({
        phase: "failed",
        error: "x",
        cause: "network",
        log: [],
        sinceMs: 0,
      }),
    ).toThrow();
  });

  it("projectConnection is the IDENTITY on the session sum (the cell IS SessionState<SshProv>)", () => {
    // Post-remediation the cell value IS `SessionState<SshProv>`, so the projection is a
    // provable identity — no arm-by-arm re-box, no runtime zod-throw drift risk. A DOWN
    // frame passes through unchanged, its unified provenance-tagged log intact.
    const s: SessionState<SshProv> = {
      phase: "failed",
      error: "exited with code 1",
      cause: "remote",
      log: [
        { source: "local", line: "gave up" },
        { source: "remote", line: "kaval 3.2 vs pulam 3.3" },
      ],
      sinceMs: 4200,
    };
    expect(projectConnection(s)).toBe(s); // identity — same reference
    expect(ConnectionInfoSchema.parse(s)).toEqual(s);

    // An UP frame (the `probing` opening) likewise passes through with only log +
    // sinceMs, no invented error fields.
    const up: SessionState<SshProv> = {
      phase: "probing",
      log: [{ source: "local", line: "checking for a cached agent…" }],
      sinceMs: 0,
    };
    expect(projectConnection(up)).toBe(up);
    expect("error" in projectConnection(up)).toBe(false);
    expect(ConnectionInfoSchema.parse(up)).toEqual(up);
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
