/**
 * Per-face `expose` — the property the feature exists for, pinned twice.
 *
 * At the SEAM (`exposeFace` + `restrictHandlers` over a handler record): what
 * each map shape grants, what it withholds, and every boot-time refusal to
 * serve a map that does not describe the surface.
 *
 * Over a REAL unix socket, twice, from ONE runtime: a verb exposed on face A
 * and not on face B is callable on A and refused on B. That is the whole ask
 * (juspay/kolu#2169) and it cannot be proven at the seam alone — the refusal
 * has to survive the transport, and the two faces have to be provably the same
 * live surface rather than two copies of it.
 *
 * The one grammar is pinned here too (`classifyExpose` is what every face reads
 * a map with): a surface where a procedure NAMESPACE and a primitive share a
 * name is legal, and the same key has to mean the same thing on the wire face
 * as it does on the MCP face.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { Cause, Effect, Exit, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  classifyExpose,
  type ExposeMap,
  exposeFace,
  exposeFaces,
  restrictHandlers,
  SurfaceMemberNotExposed,
} from "./expose";
import { callUnary, firstFrame } from "./handlerDispatch.testlib";
import { unixSocketLink } from "./links/unix-socket";
import {
  implementSurface,
  implementSurfaces,
  inMemoryStore,
  type SurfaceHandlers,
} from "./server";
import { serveOverUnixSocket } from "./unix-socket";

/** One surface with everything a map can name: a readable+writable cell, a
 *  collection, a stream, and two procedures of different trust. */
const surface = defineSurface({
  cells: {
    motd: { schema: Schema.String, default: "boot" },
  },
  collections: {
    notes: {
      keySchema: Schema.Number,
      schema: Schema.Struct({ text: Schema.String }),
    },
  },
  streams: {
    ticks: { inputSchema: Schema.Void, outputSchema: Schema.String },
  },
  procedures: {
    admin: {
      wipe: {
        input: Schema.Void,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
    },
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
    },
  },
});

const DOUBLE = "surface/math/double";
const WIPE = "surface/admin/wipe";
const MOTD_GET = "surface/motd/get";
const MOTD_SET = "surface/motd/set";
const NOTES_KEYS = "surface/notes/keys";
const NOTES_UPSERT = "surface/notes/upsert";
const TICKS_GET = "surface/ticks/get";
const LIVE = "surface/system/live";

/** A live runtime of {@link surface}. `wiped` is the observable a refusal has to
 *  keep empty: a gate that runs AFTER the handler would still fail the call and
 *  still be worthless. */
function build() {
  let stored = "boot";
  const notes = new Map<number, { text: string }>();
  const wiped: string[] = [];
  const runtime = implementSurface(surface, {
    cells: {
      motd: {
        store: {
          get: () => stored,
          set: (v: string) => {
            stored = v;
          },
        },
      },
    },
    collections: {
      notes: {
        readAll: () => notes,
        upsert: (k, v) => {
          notes.set(k, v);
        },
        remove: (k) => {
          notes.delete(k);
        },
      },
    },
    streams: { ticks: { source: () => Stream.make("tick") } },
    procedures: {
      admin: {
        wipe: () =>
          Effect.sync(() => {
            wiped.push("called");
            return { ok: true };
          }),
      },
      math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
    },
  });
  return { runtime, wiped, notes };
}

/** A restricted record of {@link surface}, from the map an author writes. */
function gate(runtime: ReturnType<typeof build>["runtime"], map: ExposeMap) {
  return restrictHandlers(
    runtime.group,
    runtime.handlers,
    exposeFace(surface, map),
  );
}

/** The defect a refused call carries, or `undefined` if the call did anything
 *  else — including succeed. */
async function refusalOf(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Promise<SurfaceMemberNotExposed | undefined> {
  const exit = await Effect.runPromiseExit(
    Effect.suspend(() => {
      const result = handlers[tag]?.(payload);
      if (result === undefined) throw new Error(`no handler at ${tag}`);
      return Stream.isStream(result)
        ? Stream.runCollect(result)
        : (result as Effect.Effect<unknown>);
    }),
  );
  if (!Exit.isFailure(exit)) return undefined;
  const squashed = Cause.squash(exit.cause);
  return squashed instanceof SurfaceMemberNotExposed ? squashed : undefined;
}

describe("a map grants what it names", () => {
  it("keeps a named procedure's own handler, byte-identical", () => {
    const { runtime } = build();
    const restricted = gate(runtime, { "math.double": "tool" });
    expect(restricted[DOUBLE]).toBe(runtime.handlers[DOUBLE]);
  });

  it("refuses every procedure the map does not name, without calling it", async () => {
    const { runtime, wiped } = build();
    const restricted = gate(runtime, { "math.double": "tool" });
    await expect(callUnary(restricted, DOUBLE, { x: 21 })).resolves.toEqual({
      y: 42,
    });
    const refusal = await refusalOf(restricted, WIPE, undefined);
    expect(refusal).toBeInstanceOf(SurfaceMemberNotExposed);
    expect(refusal?.tag).toBe(WIPE);
    expect(refusal?.message).toBe(
      `surface: "${WIPE}" is not exposed on this face`,
    );
    // The gate is IN FRONT of the handler, not around it.
    expect(wiped).toEqual([]);
  });

  it("refuses a streaming member as a dying STREAM, not a dying effect", async () => {
    const { runtime } = build();
    const restricted = gate(runtime, { "math.double": "tool" });
    const result = restricted[TICKS_GET]?.(undefined);
    // The shape the protocol will run has to be the shape the `Rpc` promised —
    // an `Effect` here is a serving stack that breaks on subscribe.
    expect(Stream.isStream(result)).toBe(true);
    expect((await refusalOf(restricted, TICKS_GET, undefined))?.tag).toBe(
      TICKS_GET,
    );
  });

  it('grants a primitive its READ verbs on "resource" and withholds its writes', async () => {
    const { runtime, notes } = build();
    const restricted = gate(runtime, { motd: "resource", notes: "resource" });
    await expect(firstFrame(restricted, MOTD_GET)).resolves.toBe("boot");
    await expect(firstFrame(restricted, NOTES_KEYS)).resolves.toEqual([]);
    expect((await refusalOf(restricted, MOTD_SET, "hijacked"))?.tag).toBe(
      MOTD_SET,
    );
    expect(
      (
        await refusalOf(restricted, NOTES_UPSERT, {
          key: 1,
          value: { text: "x" },
        })
      )?.tag,
    ).toBe(NOTES_UPSERT);
    // Refused BEFORE the write, which is the only thing that matters.
    expect(notes.size).toBe(0);
  });

  it("keeps the framework-reserved members reachable on a gated face", async () => {
    const { runtime } = build();
    const restricted = gate(runtime, {});
    // An empty map denies the whole app surface…
    expect((await refusalOf(restricted, DOUBLE, { x: 1 }))?.tag).toBe(DOUBLE);
    // …and still answers the probe a client's watchdog rides, because a refused
    // `system/live` reads as a dead transport and reconnects forever.
    await expect(callUnary(restricted, LIVE, {})).resolves.toEqual({});
  });

  it("gates a sibling bundle per sibling, with each sibling's own map", async () => {
    // Two siblings with the SAME member names, which is the case a face-level
    // gate has to keep apart: their tags differ only in the prefix. Each map is
    // written against its own sibling's spec, so nothing has to be qualified.
    const sibling = () =>
      defineSurface({
        cells: { state: { schema: Schema.String, default: "s" } },
        procedures: { math: { ping: { output: Schema.String } } },
      });
    const surfaces = { left: sibling(), right: sibling() };
    const runtime = implementSurfaces(
      surfaces,
      {},
      {
        left: {
          cells: { state: { store: inMemoryStore("L") } },
          procedures: { math: { ping: () => Effect.succeed("L") } },
        },
        right: {
          cells: { state: { store: inMemoryStore("R") } },
          procedures: { math: { ping: () => Effect.succeed("R") } },
        },
      },
    );
    const restricted = restrictHandlers(
      runtime.group,
      runtime.handlers,
      exposeFaces(surfaces, {
        left: { "math.ping": "tool" },
        right: { state: "resource" },
      }),
    );
    await expect(callUnary(restricted, "surface/left/math/ping")).resolves.toBe(
      "L",
    );
    expect((await refusalOf(restricted, "surface/right/math/ping"))?.tag).toBe(
      "surface/right/math/ping",
    );
    await expect(
      firstFrame(restricted, "surface/right/state/get"),
    ).resolves.toBe("R");
    expect((await refusalOf(restricted, "surface/left/state/get"))?.tag).toBe(
      "surface/left/state/get",
    );

    // A sibling with NO map is fully denied — an omitted map is an omission,
    // and default-deny is the whole contract…
    const onlyLeft = restrictHandlers(
      runtime.group,
      runtime.handlers,
      exposeFaces(surfaces, { left: { "math.ping": "tool" } }),
    );
    expect((await refusalOf(onlyLeft, "surface/right/state/get"))?.tag).toBe(
      "surface/right/state/get",
    );
    // …while its reserved members still answer, per sibling.
    await expect(
      callUnary(onlyLeft, "surface/right/system/live", {}),
    ).resolves.toEqual({});
    await runtime.close();
  });
});

describe("one grammar — a key means the same thing on every face", () => {
  // `defineSurface`'s `claim` rejects a duplicate TAG, not a shared NAME, so a
  // cell `nodes` next to a procedure namespace `nodes` is a legal surface. An
  // earlier cut of this module classified keys by walking the GROUP and read
  // that surface differently from the MCP face; this is the regression test.
  const overlap = defineSurface({
    cells: { nodes: { schema: Schema.String, default: "boot" } },
    procedures: {
      nodes: { refresh: { output: Schema.Struct({ ok: Schema.Boolean }) } },
    },
  });

  it("resolves a procedure whose namespace shares a primitive's name", async () => {
    const runtime = implementSurface(overlap, {
      cells: { nodes: { store: inMemoryStore("boot") } },
      procedures: { nodes: { refresh: () => Effect.succeed({ ok: true }) } },
    });
    const restricted = restrictHandlers(
      runtime.group,
      runtime.handlers,
      exposeFace(overlap, { "nodes.refresh": "tool" }),
    );
    await expect(
      callUnary(restricted, "surface/nodes/refresh"),
    ).resolves.toEqual({ ok: true });
    // The cell was NOT named, so it stays denied — a shared name grants nothing
    // by accident in either direction.
    expect((await refusalOf(restricted, "surface/nodes/get"))?.tag).toBe(
      "surface/nodes/get",
    );
    await runtime.close();
  });

  it("splits a dotted key at the FIRST dot, whatever else the surface declares", () => {
    // A `.` is legal in a member name (`assertTagSegment` refuses `/`, not
    // `.`), so a key's meaning cannot be "count the dots" — a dotted key is a
    // procedure, and the SPEC says whether that procedure exists.
    const dotted = defineSurface({
      cells: { "a.b": { schema: Schema.String, default: "x" } },
      procedures: { a: { b: { output: Schema.String } } },
    });
    // `ExposeMap<S>` already makes this key unspellable when `S` is known — its
    // procedure half demands a `ToolExposure` and its primitive half demands
    // `"resource"`, and the intersection is uninhabited, which is why these two
    // maps are annotated as the bare shape. Both faces still have to AGREE
    // about a map that reaches them through the string index.
    const asTool: ExposeMap = { "a.b": "tool" };
    const asResource: ExposeMap = { "a.b": "resource" };
    expect(classifyExpose(dotted.spec, asTool)).toEqual([
      { kind: "procedure", ns: "a", verb: "b", exposure: "tool" },
    ]);
    // The cell that spells the same key is therefore unreachable by that
    // spelling — and says so, as a category error, rather than silently
    // granting one of the two.
    expect(() => classifyExpose(dotted.spec, asResource)).toThrow(
      /procedure "a\.b" is exposed as "resource"/,
    );
  });

  it("reads a map exactly as the MCP resolver reads it — one function, one grammar", () => {
    expect(classifyExpose(surface.spec, { "math.double": "tool" })).toEqual([
      { kind: "procedure", ns: "math", verb: "double", exposure: "tool" },
    ]);
    expect(classifyExpose(surface.spec, { notes: "resource" })).toEqual([
      { kind: "collection", key: "notes" },
    ]);
    expect(classifyExpose(surface.spec, { ticks: "resource" })).toEqual([
      { kind: "stream", key: "ticks" },
    ]);
    expect(classifyExpose(surface.spec, { motd: "resource" })).toEqual([
      { kind: "cell", key: "motd" },
    ]);
  });
});

describe("a map that does not describe the surface is a boot crash", () => {
  const bind = (expose: ExposeMap) => () => exposeFace(surface, expose);

  it("refuses a key that names nothing", () => {
    // The failure a default-deny gate hides best: a typo denies EVERYTHING and
    // the face still serves, so nothing looks wrong until a caller needs it.
    expect(bind({ "math.dubble": "tool" })).toThrow(
      /expose names procedure "math\.dubble" but the spec has no such procedure/,
    );
    expect(bind({ mtod: "resource" })).toThrow(
      /expose names "mtod" but the spec has no such cell\/collection\/stream\/event/,
    );
  });

  it("refuses a procedure exposed as a resource", () => {
    expect(bind({ "math.double": "resource" })).toThrow(
      /procedure "math\.double" is exposed as "resource"/,
    );
  });

  it("refuses a primitive exposed as a tool", () => {
    expect(bind({ motd: "tool" })).toThrow(
      /primitive "motd" must be exposed as "resource"/,
    );
  });

  it("refuses to gate a reserved member, which is not a spellable key", () => {
    expect(bind({ "system.live": "tool" })).toThrow(
      /expose names procedure "system\.live" but the spec has no such procedure/,
    );
  });

  it("refuses an exposure built from a DIFFERENT surface than the group served", () => {
    // Silently gating everything is the one failure mode that looks like
    // success from the outside, so the mismatch has to be loud.
    const { runtime } = build();
    const other = defineSurface({
      procedures: { other: { ping: { output: Schema.String } } },
    });
    expect(() =>
      restrictHandlers(
        runtime.group,
        runtime.handlers,
        exposeFace(other, { "other.ping": "tool" }),
      ),
    ).toThrow(/built from a different surface than the group being served/);
  });
});

describe("two faces of one surface, over real sockets", () => {
  it("serves a verb on the face that exposes it and refuses it on the face that does not", async () => {
    const { runtime, wiped } = build();
    const dir = mkdtempSync(join(tmpdir(), "surface-expose-"));

    // Face A — the trusted local socket. Both procedures.
    const trusted = await serveOverUnixSocket({
      socketPath: join(dir, "trusted.sock"),
      group: runtime.group,
      handlers: runtime.handlers,
      expose: exposeFace(surface, {
        "math.double": "tool",
        "admin.wipe": "tool",
      }),
      log: silentLogger,
    });
    // Face B — the untrusted one. The same runtime, one verb short.
    const public_ = await serveOverUnixSocket({
      socketPath: join(dir, "public.sock"),
      group: runtime.group,
      handlers: runtime.handlers,
      expose: exposeFace(surface, { "math.double": "tool" }),
      log: silentLogger,
    });
    expect(trusted.outcome).toEqual({ kind: "listening" });
    expect(public_.outcome).toEqual({ kind: "listening" });

    const trustedLink = await unixSocketLink({
      group: surface.group,
      socketPath: trusted.socketPath,
    });
    const publicLink = await unixSocketLink({
      group: surface.group,
      socketPath: public_.socketPath,
    });

    // The verb BOTH faces expose answers on both — so the difference below is
    // the map, not a broken link.
    await expect(
      Effect.runPromise(trustedLink.dispatch.unary(DOUBLE, { x: 4 })),
    ).resolves.toEqual({ y: 8 });
    await expect(
      Effect.runPromise(publicLink.dispatch.unary(DOUBLE, { x: 4 })),
    ).resolves.toEqual({ y: 8 });

    // The verb only face A exposes: called on A…
    await expect(
      Effect.runPromise(trustedLink.dispatch.unary(WIPE, undefined)),
    ).resolves.toEqual({ ok: true });
    expect(wiped).toEqual(["called"]);

    // …and refused on B, on the same live runtime, in the same process.
    const exit = await Effect.runPromiseExit(
      publicLink.dispatch.unary(WIPE, undefined),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain(
        `"${WIPE}" is not exposed on this face`,
      );
    }
    // The refusal did not reach the handler: still the ONE call face A made.
    expect(wiped).toEqual(["called"]);

    // And face A is still serving — a refusal on B is one request's answer, not
    // a transport event.
    await expect(
      Effect.runPromise(trustedLink.dispatch.unary(DOUBLE, { x: 5 })),
    ).resolves.toEqual({ y: 10 });

    await trustedLink.dispose();
    await publicLink.dispose();
    trusted.close();
    public_.close();
    await runtime.close();
  }, 20_000);
});
