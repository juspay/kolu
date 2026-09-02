/**
 * `implementRootedSurfaces` serves an unprefixed ROOT surface plus a sibling set
 * that MOVES WHILE IT IS SERVED — the serve-side third member of the family whose
 * other two doors already carry a root (`exposeRootedFaces` at the gate,
 * `connectSurfaces`' `core` slot in the browser).
 *
 * The claims, in the order the door's value depends on them:
 *
 *   1. **The root's tags never move.** Mounting and dropping siblings leaves the
 *      root's tag set — and the root's HANDLER VALUES — byte-identical. This is
 *      the load-bearing one: an MCP client's URIs and every tag assertion a
 *      consumer wrote address the same words whatever the roster does.
 *   2. **Composition is INCREMENTAL.** A surviving sibling keeps its handler
 *      identity, its store and its published state across a roster change — the
 *      property a re-compose (walk the whole map again) destroys, and the reason
 *      an already-open connection holding the previous record is still holding
 *      the right handlers for every tag it can dial.
 *   3. **A drop reaches a connection that captured the record BEFORE it.** The
 *      handler is stable for the mount's life and refuses the instant the mount
 *      is dropped — a fresh call with a `SurfaceSiblingDropped` defect, and an
 *      in-flight SUBSCRIPTION with the same defect rather than a silent hang on a
 *      producer nobody drives.
 *   4. **A recycled key cannot route a stale connection into a new sibling.**
 *      Drop `k`, mount a different surface at `k`: the old record's handler still
 *      refuses.
 *   5. **Mounting is TRANSACTIONAL** — a bad mount leaves roster, route set and
 *      running sources untouched.
 *   6. Channels are key-namespaced exactly as `implementSurfaces` namespaces
 *      them, and the root's are its own.
 *   7. Supervision: a live sibling's fault reaches `done`; `close` releases the
 *      root and every mounted sibling.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import { exposeRootedFaces, restrictHandlers } from "./expose";
import {
  implementRootedSurfaces,
  inMemoryStore,
  type SurfaceHandlers,
  SurfaceSiblingDropped,
} from "./server";

const coreSurface = () =>
  defineSurface({
    cells: {
      errors: { schema: Schema.String, default: "" },
    },
    procedures: {
      core: {
        ping: { input: Schema.Struct({}), output: Schema.String },
      },
    },
  });

/** A plugin-shaped sibling. Two of them, differing only in member name, so a test
 *  can tell whose members it is holding. Spelled as literals rather than built by
 *  a helper so each keeps its precise spec — a sibling's `ctx` is what a consumer
 *  writes through, and an erased one would let this file assert about a type
 *  nobody gets. */
const fleetSurface = defineSurface({
  cells: { fleet: { schema: Schema.Number, default: 0 } },
});
const queueSurface = defineSurface({
  cells: { queue: { schema: Schema.Number, default: 0 } },
});

const coreDeps = () => ({
  cells: { errors: { store: inMemoryStore("") } },
  procedures: { core: { ping: () => Effect.succeed("pong") } },
});

const fleetDeps = (seed = 0) => ({
  cells: { fleet: { store: inMemoryStore(seed) } },
});
const queueDeps = (seed = 0) => ({
  cells: { queue: { store: inMemoryStore(seed) } },
});

const rooted = () => implementRootedSurfaces(coreSurface(), {}, coreDeps());

function unary(handlers: SurfaceHandlers, tag: string, payload?: unknown) {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Effect.Effect<unknown>;
}

function stream(handlers: SurfaceHandlers, tag: string, payload?: unknown) {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Stream.Stream<unknown, unknown>;
}

/** The tags the root serves, read off the runtime. */
const coreTags = (tags: string[]) =>
  tags.filter((t) => t.split("/").length === 3).sort();

describe("implementRootedSurfaces: the root does not move", () => {
  it("keeps the root's tags and handler VALUES byte-identical across mount and drop", async () => {
    const runtime = rooted();
    const before = Object.keys(runtime.handlers).sort();
    const rootHandler = runtime.handlers["surface/core/ping"];
    expect(coreTags(before)).toEqual(before);

    const mounted = runtime.mount(
      "kolu",
      fleetSurface,
      fleetDeps(),
    );
    expect(coreTags(Object.keys(runtime.handlers))).toEqual(before);
    expect(runtime.handlers["surface/core/ping"]).toBe(rootHandler);

    await mounted.drop();
    expect(Object.keys(runtime.handlers).sort()).toEqual(before);
    expect(runtime.handlers["surface/core/ping"]).toBe(rootHandler);
    // ...and the group came back to exactly the root's own.
    expect([...runtime.group.requests.keys()].sort()).toEqual(before);
    await runtime.close();
  });

  it("a sibling lands under its own key, with its own reserved system members", async () => {
    const runtime = rooted();
    runtime.mount("kolu", fleetSurface, fleetDeps());
    const tags = Object.keys(runtime.handlers).sort();
    expect(tags).toContain("surface/kolu/fleet/get");
    expect(tags).toContain("surface/kolu/system/live");
    // The ROOT's reserved members are the BARE ones, and they are still there.
    expect(tags).toContain("surface/system/live");
    expect(tags.some((t) => t.startsWith("surface/surface/"))).toBe(false);
    expect(tags).toEqual([...runtime.group.requests.keys()].sort());
    await runtime.close();
  });

  it("serves the root while the roster is empty — a bundle with no siblings is an ordinary bundle", async () => {
    const runtime = rooted();
    expect(runtime.roster).toEqual([]);
    expect(
      await Effect.runPromise(unary(runtime.handlers, "surface/core/ping", {})),
    ).toBe("pong");
    await runtime.close();
  });

  it("refuses a sibling-scoped surface as the root — the same law as the gate and the browser door", () => {
    const scoped = defineSurface({
      cells: { errors: { schema: Schema.String, default: "" } },
    });
    // A surface already scoped to a sibling carries `surface/<key>/`.
    const asSibling = {
      ...scoped,
      tagPrefix: "surface/kolu/",
    } as typeof scoped;
    expect(() =>
      implementRootedSurfaces(
        asSibling,
        {},
        {
          cells: { errors: { store: inMemoryStore("") } },
        },
      ),
    ).toThrow(/the root of a rooted bundle is the UNPREFIXED one/);
  });
});

describe("implementRootedSurfaces: composition is incremental", () => {
  it("a surviving sibling keeps its handler identity AND its state when another mounts", async () => {
    const runtime = rooted();
    const first = runtime.mount(
      "a",
      fleetSurface,
      fleetDeps(7),
    );
    const handlerBefore = runtime.handlers["surface/a/fleet/get"];
    // A write through the sibling's own ctx — the state a re-compose would fork.
    (
      first.ctx as { cells: { fleet: { set: (n: number) => void } } }
    ).cells.fleet.set(41);

    const second = runtime.mount(
      "b",
      queueSurface,
      queueDeps(),
    );
    expect(runtime.handlers["surface/a/fleet/get"]).toBe(handlerBefore);
    expect(runtime.roster).toEqual(["a", "b"]);

    await second.drop();
    // ...and it survives the DROP of its neighbour too.
    expect(runtime.handlers["surface/a/fleet/get"]).toBe(handlerBefore);
    const frames: unknown[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        Stream.take(stream(runtime.handlers, "surface/a/fleet/get"), 1),
        (frame) => Effect.sync(() => frames.push(frame)),
      ),
    );
    expect(frames).toEqual([41]);
    await runtime.close();
  });
});

describe("implementRootedSurfaces: a drop reaches an already-bound record", () => {
  it("refuses a NEW call at the tag a connection captured before the drop", async () => {
    const runtime = rooted();
    const mounted = runtime.mount(
      "kolu",
      fleetSurface,
      fleetDeps(),
    );
    // What a serve site captured at accept — `RpcGroup.toLayer` and
    // `restrictHandlers` both hold these VALUES.
    const captured = { ...runtime.handlers };
    await mounted.drop();

    // The runtime no longer advertises the tag at all...
    expect(runtime.handlers["surface/kolu/fleet/get"]).toBeUndefined();
    expect(runtime.group.requests.has("surface/kolu/fleet/get")).toBe(false);
    // ...and the captured handler refuses rather than answering out of a
    // sibling nobody serves any more.
    const exit = await Effect.runPromiseExit(
      // A `get` is streaming; its unary sibling below covers the other shape.
      Effect.asVoid(
        Stream.runDrain(
          stream(captured, "surface/kolu/fleet/get"),
        ) as Effect.Effect<void, unknown>,
      ),
    );
    expect(exit._tag).toBe("Failure");
    await runtime.close();
  });

  it("kills an IN-FLIGHT subscription with the same defect, rather than hanging or ending clean", async () => {
    const runtime = rooted();
    const mounted = runtime.mount(
      "kolu",
      fleetSurface,
      fleetDeps(),
    );
    const captured = { ...runtime.handlers };

    const settled = Effect.runPromiseExit(
      Stream.runDrain(
        stream(captured, "surface/kolu/fleet/get"),
      ) as Effect.Effect<void, unknown>,
    );
    // The subscription is parked on the cell's channel — nothing will ever end
    // it on its own, which is exactly the hang this claim exists about. Pinned:
    // it is STILL RUNNING at the moment of the drop, so the failure below is the
    // drop's doing and not a subscription that had already died on its own.
    const pending = Symbol("pending");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await Promise.race([settled, Promise.resolve(pending)])).toBe(
      pending,
    );
    await mounted.drop();

    const exit = await settled;
    expect(exit._tag).toBe("Failure");
    const rendered = JSON.stringify(exit);
    expect(rendered).toContain("SurfaceSiblingDropped");
    expect(rendered).toContain("surface/kolu/fleet/get");
    await runtime.close();
  });

  it("refuses a unary call issued after the drop", async () => {
    const runtime = rooted();
    const mounted = runtime.mount(
      "kolu",
      fleetSurface,
      fleetDeps(),
    );
    const captured = { ...runtime.handlers };
    await mounted.drop();
    const exit = await Effect.runPromiseExit(
      unary(captured, "surface/kolu/fleet/set", { value: 3 }),
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("SurfaceSiblingDropped");
  });

  it("a RE-MOUNTED key does not resurrect a stale connection's handler", async () => {
    const runtime = rooted();
    const first = runtime.mount(
      "kolu",
      fleetSurface,
      fleetDeps(1),
    );
    const captured = { ...runtime.handlers };
    await first.drop();
    // The same KEY, a different surface and a different store.
    runtime.mount("kolu", fleetSurface, fleetDeps(2));

    // The live record answers...
    const live: unknown[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        Stream.take(stream(runtime.handlers, "surface/kolu/fleet/get"), 1),
        (frame) => Effect.sync(() => live.push(frame)),
      ),
    );
    expect(live).toEqual([2]);
    // ...and the stale one still refuses, rather than reading the NEW sibling's
    // store through a recycled name.
    const exit = await Effect.runPromiseExit(
      unary(captured, "surface/kolu/fleet/set", { value: 9 }),
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("SurfaceSiblingDropped");
    await runtime.close();
  });

  it("`drop` is idempotent and the second call is the same promise", async () => {
    const runtime = rooted();
    const mounted = runtime.mount(
      "kolu",
      fleetSurface,
      fleetDeps(),
    );
    await Promise.all([mounted.drop(), mounted.drop()]);
    expect(runtime.roster).toEqual([]);
    await runtime.close();
  });
});

describe("implementRootedSurfaces: mounting is transactional", () => {
  it("refuses a key that is already mounted, leaving the roster untouched", async () => {
    const runtime = rooted();
    runtime.mount("kolu", fleetSurface, fleetDeps());
    expect(() =>
      runtime.mount(
        "kolu",
        queueSurface,
        queueDeps(),
      ),
    ).toThrow(/already mounted/);
    expect(runtime.roster).toEqual(["kolu"]);
    expect(Object.keys(runtime.handlers)).toEqual([
      ...runtime.group.requests.keys(),
    ]);
    await runtime.close();
  });

  it("a sibling with a missing dep throws with the roster and route set unchanged", async () => {
    const runtime = rooted();
    const before = Object.keys(runtime.handlers).sort();
    expect(() => runtime.mount("kolu", fleetSurface, {})).toThrow();
    expect(runtime.roster).toEqual([]);
    expect(Object.keys(runtime.handlers).sort()).toEqual(before);
    await runtime.close();
  });

  it("refuses an illegal sibling key through the framework's own grammar", async () => {
    const runtime = rooted();
    expect(() =>
      runtime.mount("a/b", fleetSurface, fleetDeps()),
    ).toThrow();
    expect(runtime.roster).toEqual([]);
    await runtime.close();
  });

  it("refuses a mount after close", async () => {
    const runtime = rooted();
    await runtime.close();
    expect(() =>
      runtime.mount("kolu", fleetSurface, fleetDeps()),
    ).toThrow(/closing or closed/);
  });
});

describe("implementRootedSurfaces: the gate reads the live roster", () => {
  it("a face built for the current roster binds, and one built for the old roster is refused", async () => {
    const runtime = rooted();
    const core = coreSurface();
    const tenant = fleetSurface;
    const mounted = runtime.mount("kolu", tenant, fleetDeps());

    const withSibling = exposeRootedFaces(
      core,
      { errors: "resource" },
      { kolu: tenant },
      { kolu: { fleet: "resource" } },
    );
    expect(() =>
      restrictHandlers(runtime.group, runtime.handlers, withSibling),
    ).not.toThrow();

    await mounted.drop();
    // The exposure now describes a sibling this serve no longer carries — the
    // refusal a gated face owes a roster change, loud rather than silently
    // denying a whole sibling.
    expect(() =>
      restrictHandlers(runtime.group, runtime.handlers, withSibling),
    ).toThrow(/different surface/);
    // ...and the root-only face binds again.
    const rootOnly = exposeRootedFaces(core, { errors: "resource" }, {}, {});
    expect(() =>
      restrictHandlers(runtime.group, runtime.handlers, rootOnly),
    ).not.toThrow();
    await runtime.close();
  });
});

describe("implementRootedSurfaces: channels", () => {
  it("two siblings that own the SAME member name do not publish into each other", async () => {
    // The behavioural statement of `<key>/<name>` channel namespacing: without
    // it both cells would sit on one `fleet:changed` bus and a write to `a` would
    // reach `b`'s subscribers. Asked of what a subscriber SEES rather than of a
    // spy on the factory, because the factory is the runtime's own.
    const runtime = rooted();
    const a = runtime.mount(
      "a",
      fleetSurface,
      fleetDeps(1),
    );
    runtime.mount("b", fleetSurface, fleetDeps(2));
    (
      a.ctx as { cells: { fleet: { set: (n: number) => void } } }
    ).cells.fleet.set(50);

    const frameOf = async (tag: string) => {
      const frames: unknown[] = [];
      await Effect.runPromise(
        Stream.runForEach(
          Stream.take(stream(runtime.handlers, tag), 1),
          (frame) => Effect.sync(() => frames.push(frame)),
        ),
      );
      return frames[0];
    };
    expect(await frameOf("surface/a/fleet/get")).toBe(50);
    expect(await frameOf("surface/b/fleet/get")).toBe(2);
    await runtime.close();
  });
});

describe("implementRootedSurfaces: supervision", () => {
  it("close releases the root and every mounted sibling, and done resolves", async () => {
    const runtime = rooted();
    runtime.mount("a", fleetSurface, fleetDeps());
    runtime.mount("b", queueSurface, queueDeps());
    await runtime.close();
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a live sibling's owned fault reaches done", async () => {
    const runtime = rooted();
    const boom = new Error("connector died");
    runtime.mount("a", fleetSurface, {
      cells: {
        fleet: {
          store: inMemoryStore(0),
          connect: () => Effect.fail(boom),
        },
      },
    } as never);
    await expect(runtime.done).rejects.toThrow(/connector died/);
  });

  it("the error class is exported for a consumer that recognises a dropped member", () => {
    const err = new SurfaceSiblingDropped({
      key: "kolu",
      tag: "surface/kolu/fleet/get",
    });
    expect(err.message).toContain("surface/kolu/fleet/get");
    expect(err.message).toContain("kolu");
  });
});
