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
import { Cause, Effect, Exit, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  classifyExpose,
  type ExposeMap,
  ExposeMapError,
  exposeFace,
  exposeFaces,
  restrictHandlers,
  SurfaceMemberNotExposed,
} from "./expose";
import { callUnary, firstFrame, handlerAt } from "./handlerDispatch.testlib";
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

/** What a call actually did — three outcomes, told apart.
 *
 *  A bare `SurfaceMemberNotExposed | undefined` cannot say them apart: an
 *  unbound tag, a decode error and a genuine handler bug all collapse to the
 *  same `undefined` that a SUCCESS returns, so the assertion below would report
 *  "was not refused" and throw the real cause away. `handlerAt`'s own throw is
 *  no exception — it runs inside `Effect.suspend`, and the fiber turns a
 *  synchronous throw into a DIE rather than letting it escape. */
type CallOutcome =
  | { readonly kind: "refused"; readonly refusal: SurfaceMemberNotExposed }
  | { readonly kind: "succeeded"; readonly value: unknown }
  | { readonly kind: "failed"; readonly cause: string };

async function callOutcome(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Promise<CallOutcome> {
  const exit = await Effect.runPromiseExit(
    Effect.suspend(() => {
      const result = handlerAt(handlers, tag)(payload);
      return Stream.isStream(result)
        ? Stream.runCollect(result)
        : (result as Effect.Effect<unknown>);
    }),
  );
  if (!Exit.isFailure(exit)) return { kind: "succeeded", value: exit.value };
  const squashed = Cause.squash(exit.cause);
  return squashed instanceof SurfaceMemberNotExposed
    ? { kind: "refused", refusal: squashed }
    : { kind: "failed", cause: Cause.pretty(exit.cause) };
}

/** Assert a member is REFUSED on this face — and, when it was not, say what it
 *  did instead. A call that unexpectedly SUCCEEDS and a call that blew up for an
 *  unrelated reason are different bugs, so the message carries the real cause
 *  rather than leaving a reader to re-derive it. */
async function expectRefused(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Promise<void> {
  const outcome = await callOutcome(handlers, tag, payload);
  expect(
    outcome.kind,
    `"${tag}" was not refused on this face — it ${
      outcome.kind === "succeeded"
        ? `SUCCEEDED with ${JSON.stringify(outcome.value)}`
        : `failed for another reason:\n${outcome.kind === "failed" ? outcome.cause : ""}`
    }`,
  ).toBe("refused");
  if (outcome.kind === "refused") expect(outcome.refusal.tag).toBe(tag);
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
    const outcome = await callOutcome(restricted, WIPE, undefined);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") throw new Error("unreachable");
    expect(outcome.refusal).toBeInstanceOf(SurfaceMemberNotExposed);
    expect(outcome.refusal.tag).toBe(WIPE);
    expect(outcome.refusal.message).toBe(
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
    await expectRefused(restricted, TICKS_GET);
  });

  it("reads membership only — `mutates` is an MCP presentation hint, not a gate", async () => {
    // Every other test here writes the bare `"tool"`. The OBJECT spellings are
    // the ones a consumer reaches for when it also serves an MCP face, and a
    // wire face must read them the same: `{ tool: { mutates: false } }` does not
    // make a call more allowed, and `{ tool: {} }` (which `@kolu/surface-mcp`
    // reads as MUTATING) does not make it less.
    const { runtime, wiped } = build();
    const restricted = gate(runtime, {
      "math.double": { tool: { mutates: false } },
      "admin.wipe": { tool: {} },
    });
    await expect(callUnary(restricted, DOUBLE, { x: 21 })).resolves.toEqual({
      y: 42,
    });
    await expect(callUnary(restricted, WIPE, undefined)).resolves.toEqual({
      ok: true,
    });
    expect(wiped).toEqual(["called"]);
  });

  it('grants a primitive its READ verbs on "resource" and withholds its writes', async () => {
    const { runtime, notes } = build();
    const restricted = gate(runtime, { motd: "resource", notes: "resource" });
    await expect(firstFrame(restricted, MOTD_GET)).resolves.toBe("boot");
    await expect(firstFrame(restricted, NOTES_KEYS)).resolves.toEqual([]);
    await expectRefused(restricted, MOTD_SET, "hijacked");
    await expectRefused(restricted, NOTES_UPSERT, {
      key: 1,
      value: { text: "x" },
    });
    // Refused BEFORE the write, which is the only thing that matters.
    expect(notes.size).toBe(0);
  });

  it('withholds EVERY write verb on "resource", not just `set` and `upsert`', async () => {
    // The docs name five withheld writes; `set` and `upsert` are the two the
    // default verb sets mint. A surface that declares the other three has to
    // withhold those too — `patch` (a cell with a `patchSchema`), `delete`, and
    // the test-only `test__set`, which is the one an author is likeliest to
    // forget is a WRITE.
    const rich = defineSurface({
      cells: {
        doc: {
          schema: Schema.Struct({ title: Schema.String }),
          default: { title: "boot" },
          patchSchema: Schema.Struct({ title: Schema.String }),
          patch: (current, p) => ({ ...current, ...p }),
          verbs: ["get", "set", "patch", "test__set"],
        },
      },
      collections: {
        items: {
          keySchema: Schema.Number,
          schema: Schema.Struct({ text: Schema.String }),
          verbs: ["keys", "get", "deltas", "upsert", "delete", "test__set"],
        },
      },
    });
    const stored = new Map<number, { text: string }>();
    const docStore = inMemoryStore({ title: "boot" });
    const runtime = implementSurface(rich, {
      cells: { doc: { store: docStore } },
      collections: {
        items: {
          readAll: () => stored,
          upsert: (k, v) => {
            stored.set(k, v);
          },
          remove: (k) => {
            stored.delete(k);
          },
        },
      },
    });
    const restricted = restrictHandlers(
      runtime.group,
      runtime.handlers,
      exposeFace(rich, { doc: "resource", items: "resource" }),
    );
    // The reads it declares…
    await expect(firstFrame(restricted, "surface/doc/get")).resolves.toEqual({
      title: "boot",
    });
    await expect(firstFrame(restricted, "surface/items/keys")).resolves.toEqual(
      [],
    );
    await expect(
      firstFrame(restricted, "surface/items/deltas"),
    ).resolves.toEqual({ kind: "snapshot", entries: [] });
    // …and every write it declares, withheld. Each carries the payload its `Rpc`
    // actually declares, so the two "nothing was written" assertions below can
    // go RED: called with `undefined` these would fail their own decode and
    // leave the store untouched whether or not a gate ran, which asserts nothing.
    for (const [tag, payload] of [
      ["surface/doc/set", { title: "hijacked" }],
      ["surface/doc/patch", { title: "hijacked" }],
      ["surface/doc/test__set", { title: "hijacked" }],
      ["surface/items/upsert", { key: 1, value: { text: "x" } }],
      ["surface/items/delete", { key: 1 }],
      ["surface/items/test__set", [{ key: 2, value: { text: "y" } }]],
    ] as const) {
      await expectRefused(restricted, tag, payload);
    }
    expect(stored.size).toBe(0);
    expect(docStore.get()).toEqual({ title: "boot" });
    // …and the same two payloads DO write through the ungated record, which is
    // what gives the two assertions above their teeth: they read "the gate ran
    // in front of the handler", not "the handler could not have run anyway".
    await callUnary(runtime.handlers, "surface/doc/set", { title: "hijacked" });
    await callUnary(runtime.handlers, "surface/items/upsert", {
      key: 1,
      value: { text: "x" },
    });
    expect(docStore.get()).toEqual({ title: "hijacked" });
    expect(stored.size).toBe(1);
    await runtime.close();
  });

  it("grants only the read verbs a member actually DECLARES", () => {
    // `"resource"` OFFERS every read verb and keeps the ones the surface serves,
    // so a narrowed member is narrow on the gate too: a `verbs: ["get"]` cell
    // grants only `get`, and a collection without `deltas` never gets a `deltas`
    // tag. Asserted on the tag set itself — a granted tag no surface serves is
    // invisible when applied (the applier walks the GROUP), so nothing
    // downstream would ever notice.
    const narrowed = defineSurface({
      cells: {
        health: { schema: Schema.String, default: "ok", verbs: ["get"] },
      },
      collections: {
        notes: {
          keySchema: Schema.Number,
          schema: Schema.Struct({ text: Schema.String }),
        },
      },
    });
    expect(
      [...exposeFace(narrowed, { health: "resource", notes: "resource" }).tags]
        .slice()
        .sort(),
    ).toEqual([
      "surface/health/get",
      "surface/notes/get",
      "surface/notes/keys",
    ]);
  });

  it("keeps the framework-reserved members reachable on a gated face", async () => {
    const { runtime } = build();
    const restricted = gate(runtime, {});
    // An empty map denies the whole app surface…
    await expectRefused(restricted, DOUBLE, { x: 1 });
    // …and still answers the probe a client's watchdog rides, because a refused
    // `system/live` reads as a dead transport and reconnects forever.
    await expect(callUnary(restricted, LIVE, {})).resolves.toEqual({});
  });

  it("answers the reserved members for a HAND-BUILT exposure too", async () => {
    // `FaceExposure` is a structural interface, so an exposure assembled any
    // other way than by the constructors above is a legal argument. The reserved
    // carve-out is therefore the APPLIER's guarantee, not the value's — seeding
    // it at construction would leave this exposure refusing `system/live` and
    // every client on the face reconnecting forever.
    const { runtime } = build();
    const restricted = restrictHandlers(runtime.group, runtime.handlers, {
      universe: new Set(runtime.group.requests.keys()),
      tags: new Set<string>(),
    });
    await expect(callUnary(restricted, LIVE, {})).resolves.toEqual({});
    await expectRefused(restricted, DOUBLE, { x: 1 });
  });

  it("returns the handler record UNCHANGED when there is no policy", () => {
    // The "omit `expose` and the face serves the whole surface" rule, at its one
    // implementation — the same record, not an equal copy, so no face can get
    // the default wrong by rebuilding it.
    const { runtime } = build();
    expect(restrictHandlers(runtime.group, runtime.handlers, undefined)).toBe(
      runtime.handlers,
    );
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
    await expectRefused(restricted, "surface/right/math/ping");
    await expect(
      firstFrame(restricted, "surface/right/state/get"),
    ).resolves.toBe("R");
    await expectRefused(restricted, "surface/left/state/get");

    // A sibling with NO map is fully denied — an omitted map is an omission,
    // and default-deny is the whole contract…
    const onlyLeft = restrictHandlers(
      runtime.group,
      runtime.handlers,
      exposeFaces(surfaces, { left: { "math.ping": "tool" } }),
    );
    await expectRefused(onlyLeft, "surface/right/state/get");
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
    await expectRefused(restricted, "surface/nodes/get");
    await runtime.close();
  });

  it("resolves a dotted key against the SPEC, not against a fixed dot position", () => {
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
      {
        kind: "procedure",
        ns: "a",
        verb: "b",
        exposure: "tool",
        spec: dotted.spec.procedures.a.b,
      },
    ]);
    // The cell that spells the same key is therefore unreachable by that
    // spelling — and says so, as a category error, rather than silently
    // granting one of the two.
    expect(() => classifyExpose(dotted.spec, asResource)).toThrow(
      /procedure "a\.b" is exposed as "resource"/,
    );
  });

  it("reads a map exactly as the MCP resolver reads it — one function, one grammar", () => {
    // Each entry carries the member spec the classifier RESOLVED, by identity —
    // so a face reads the value this lookup found rather than redeeming the key
    // with a second lookup of its own that could disagree.
    expect(classifyExpose(surface.spec, { "math.double": "tool" })).toEqual([
      {
        kind: "procedure",
        ns: "math",
        verb: "double",
        exposure: "tool",
        spec: surface.spec.procedures.math.double,
      },
    ]);
    expect(classifyExpose(surface.spec, { notes: "resource" })[0]?.spec).toBe(
      surface.spec.collections.notes,
    );
    expect(classifyExpose(surface.spec, { ticks: "resource" })[0]?.spec).toBe(
      surface.spec.streams.ticks,
    );
    expect(classifyExpose(surface.spec, { motd: "resource" })[0]?.spec).toBe(
      surface.spec.cells.motd,
    );
    expect(
      classifyExpose(surface.spec, {
        notes: "resource",
        ticks: "resource",
        motd: "resource",
      }).map((e) => e.kind),
    ).toEqual(["collection", "stream", "cell"]);
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
    // success from the outside, so the mismatch has to be loud — and it is the
    // `universe` the exposure CARRIES that catches it, never the tags it
    // granted. Both maps below drive the identical path for exactly that
    // reason: the empty one grants nothing at all, so a check that looked only
    // at the granted tags would read it as a perfectly ordinary strict face.
    const { runtime } = build();
    const other = defineSurface({
      procedures: { other: { ping: { output: Schema.String } } },
    });
    for (const map of [{ "other.ping": "tool" } as ExposeMap, {}]) {
      expect(() =>
        restrictHandlers(
          runtime.group,
          runtime.handlers,
          exposeFace(other, map),
        ),
      ).toThrow(/built from a different surface than the group being served/);
    }
  });

  it("refuses a PARTIAL bundle exposure, which would silently deny a whole sibling", () => {
    // Every tag such an exposure names really is in the group, so the mismatch
    // is invisible from the exposure's side alone. What it leaves out is a whole
    // sibling — its `system/live` heartbeat included, which a client's watchdog
    // reads as a dead transport and reconnects on forever.
    const sibling = () =>
      defineSurface({
        cells: { state: { schema: Schema.String, default: "s" } },
      });
    const surfaces = { left: sibling(), right: sibling() };
    const runtime = implementSurfaces(
      surfaces,
      {},
      {
        left: { cells: { state: { store: inMemoryStore("L") } } },
        right: { cells: { state: { store: inMemoryStore("R") } } },
      },
    );
    expect(() =>
      restrictHandlers(
        runtime.group,
        runtime.handlers,
        exposeFaces({ left: surfaces.left }, { left: { state: "resource" } }),
      ),
    ).toThrow(/built from a different surface than the group being served/);
  });

  it("refuses a dotted key TWO of the spec's procedures answer to", () => {
    // `assertTagSegment` refuses `/` in a member name, never `.`, and `claim`
    // rejects a duplicate TAG rather than a shared name — so this surface is
    // legal and both its procedures spell the key `"a.b.c"` (`ProcedureName<S>`
    // emits it twice, so the type check sees nothing either). Splitting at the
    // first dot would silently GRANT `a`.`b.c` to a face whose author wrote
    // `a.b`.`c`: a member the map does not name, reachable on a gated face.
    const ambiguous = defineSurface({
      procedures: {
        a: { "b.c": { output: Schema.String } },
        "a.b": { c: { output: Schema.String } },
      },
    });
    expect(() => classifyExpose(ambiguous.spec, { "a.b.c": "tool" })).toThrow(
      /expose key "a\.b\.c" is ambiguous — the spec declares 2 procedures it could name/,
    );
    // A key only ONE procedure answers to still resolves — at whichever dot that
    // procedure lives, which is what makes a dotted member name exposable at all
    // instead of permanently denied with a message that says it does not exist.
    const late = defineSurface({
      procedures: { "a.b": { c: { output: Schema.String } } },
    });
    expect(classifyExpose(late.spec, { "a.b.c": "tool" })).toEqual([
      {
        kind: "procedure",
        ns: "a.b",
        verb: "c",
        exposure: "tool",
        spec: late.spec.procedures["a.b"].c,
      },
    ]);
  });

  it("refuses a malformed ToolExposure, not just a malformed key", () => {
    // `classifyExpose` is the boot check for the call shapes the TYPE cannot see
    // (an erased map accepts any key and any value). Without the value half,
    // `{ tool: … }` forgotten is a raw `TypeError` inside `@kolu/surface-mcp`
    // — neither this module's class nor the face's brand — while a wire face
    // reads the same garbage as a perfectly good grant.
    for (const bad of [{ mutates: false }, null, true, { tool: "yes" }]) {
      expect(() =>
        classifyExpose(surface.spec, {
          "math.double": bad,
        } as unknown as ExposeMap),
      ).toThrow(
        /procedure "math\.double" is exposed as something that is not a tool/,
      );
    }
    // …and the shapes the type does allow still pass, unchanged.
    for (const good of ["tool", { tool: {} }, { tool: { mutates: false } }]) {
      expect(
        classifyExpose(surface.spec, {
          "math.double": good,
        } as unknown as ExposeMap),
      ).toHaveLength(1);
    }
  });

  it('refuses a "resource" key that grants NOTHING on this surface', () => {
    // The last silent way for a map to say something the face will not do: a
    // write-only primitive passes the classifier (the member exists) and then
    // offers only read verbs the surface does not serve, so the author's key
    // grants zero tags and the member is denied with nothing saying so —
    // indistinguishable from a face that is correctly narrow.
    const writeOnly = defineSurface({
      cells: {
        knob: { schema: Schema.String, default: "x", verbs: ["set"] },
      },
    });
    expect(() => exposeFace(writeOnly, { knob: "resource" })).toThrow(
      /expose names "knob" but that grants nothing on this surface/,
    );
  });

  it("refuses an exposure granting a tag the served surface does not have", () => {
    // The constructors cannot mint a stray (they ask the group before granting),
    // but `FaceExposure` is a structural interface and a hand-assembled one is a
    // supported argument — and the applier walks the GROUP, so a stray grant is
    // read by nobody.
    const { runtime } = build();
    expect(() =>
      restrictHandlers(runtime.group, runtime.handlers, {
        universe: new Set(runtime.group.requests.keys()),
        tags: new Set([DOUBLE, "surface/ghost/get"]),
      }),
    ).toThrow(
      /grants 1 tag\(s\) this surface does not serve \[surface\/ghost\/get\]/,
    );
  });

  it("refuses a bundle map keyed by a sibling that does not exist", () => {
    // The member-level twin of "a key that names nothing", one level up. The
    // fold walks the SURFACES, never the maps, so a misspelled sibling key is
    // read by nobody — and it fails in the direction that looks like success:
    // the sibling the author meant to gate is absent from the policy, the
    // universe still matches the served group, and the face binds serving
    // nothing of it. The type only catches this for an inline literal against a
    // non-erased bundle, which is why the runtime check exists.
    const sibling = () =>
      defineSurface({
        cells: { state: { schema: Schema.String, default: "s" } },
      });
    const surfaces = { left: sibling(), right: sibling() };
    const stray: Record<string, ExposeMap> = { lft: { state: "resource" } };
    expect(() => exposeFaces(surfaces, stray)).toThrow(ExposeMapError);
    expect(() => exposeFaces(surfaces, stray)).toThrow(
      /expose names sibling\(s\) \[lft\] this bundle does not have; its siblings are \[left, right\]/,
    );
    // An OMITTED sibling stays an omission — fully denied, never a crash.
    expect(() =>
      exposeFaces(surfaces, { left: { state: "resource" } }),
    ).not.toThrow();
  });

  it("names the face on the refusal, and only when there is one", () => {
    // `ExposeMapError`'s whole reason for being a CLASS is that a face need not
    // match on message text — so the brand is a field, and the message is the
    // framework's words with the face's name in front when a face gave one.
    expect(new ExposeMapError({ detail: "nope" }).message).toBe("nope");
    expect(new ExposeMapError({ detail: "nope", face: "mcp" }).message).toBe(
      "mcp: nope",
    );
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

  it("refuses a member without touching a live subscription on the SAME link", async () => {
    // The property the module claims in prose — `surfaceRpcServerLayer` runs
    // with `disableFatalDefects`, so a refusal is ONE request's answer and not a
    // connection event. Proven where it matters: one link, one bystander
    // subscription, one denial. A refusal that killed the connection would take
    // out a subscription that never asked for anything.
    const { runtime } = build();
    const dir = mkdtempSync(join(tmpdir(), "surface-expose-live-"));
    const listener = await serveOverUnixSocket({
      socketPath: join(dir, "gated.sock"),
      group: runtime.group,
      handlers: runtime.handlers,
      // The cell is readable here; `admin.wipe` is not named at all.
      expose: exposeFace(surface, { motd: "resource" }),
      log: silentLogger,
    });
    const link = await unixSocketLink({
      group: surface.group,
      socketPath: listener.socketPath,
    });

    // A LIVE subscription to an exposed streaming member, held open across the
    // refusal below.
    const frames: string[] = [];
    const subscription = Effect.runFork(
      Stream.runForEach(
        link.dispatch.stream(MOTD_GET, undefined) as Stream.Stream<
          string,
          unknown
        >,
        (frame) => Effect.sync(() => void frames.push(frame)),
      ),
    );
    await expect
      .poll(() => frames.length, { timeout: 2_000 })
      .toBeGreaterThan(0);
    expect(frames).toEqual(["boot"]);

    // The denial, on that same link.
    const exit = await Effect.runPromiseExit(
      link.dispatch.unary(WIPE, undefined),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain(
        `"${WIPE}" is not exposed on this face`,
      );
    }

    // The subscription is still LIVE: a write through the trusted in-process
    // handler pushes a new frame down the very connection that was just
    // refused.
    await callUnary(runtime.handlers, MOTD_SET, "after");
    await expect
      .poll(() => frames.length, { timeout: 2_000 })
      .toBeGreaterThan(1);
    expect(frames).toEqual(["boot", "after"]);

    await Effect.runPromise(Fiber.interrupt(subscription));
    await link.dispose();
    listener.close();
    await runtime.close();
  }, 20_000);

  it("REJECTS a mismatched exposure instead of resolving to a refused listener", async () => {
    // `serveOverUnixSocket`'s contract is that no TRANSPORT failure rejects —
    // every one of them comes back as an `outcome` a host can survive. A
    // mismatched exposure is carved out of that on purpose: it is the author's
    // own mistake, and degrading it to a quiet no-op listener would hide a
    // security gate that never took effect.
    const { runtime } = build();
    const other = defineSurface({
      procedures: { other: { ping: { output: Schema.String } } },
    });
    const dir = mkdtempSync(join(tmpdir(), "surface-expose-mismatch-"));
    await expect(
      serveOverUnixSocket({
        socketPath: join(dir, "mismatched.sock"),
        group: runtime.group,
        handlers: runtime.handlers,
        expose: exposeFace(other, { "other.ping": "tool" }),
        log: silentLogger,
      }),
    ).rejects.toThrow(
      /built from a different surface than the group being served/,
    );
    await runtime.close();
  });
});
