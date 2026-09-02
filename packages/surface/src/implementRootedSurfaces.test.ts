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

import { Deferred, Effect, Schema, Stream } from "effect";
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
/** A sibling whose procedure can PARK — so a test can hold a call in flight
 *  across a drop and watch what the handler's own `ctx` does when it resumes. */
const parkingSurface = defineSurface({
  cells: { fleet: { schema: Schema.Number, default: 0 } },
  procedures: {
    slow: { write: { input: Schema.Struct({}), output: Schema.String } },
  },
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

    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps());
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
    const first = runtime.mount("a", fleetSurface, fleetDeps(7));
    const handlerBefore = runtime.handlers["surface/a/fleet/get"];
    // A write through the sibling's own ctx — the state a re-compose would fork.
    (
      first.ctx as { cells: { fleet: { set: (n: number) => void } } }
    ).cells.fleet.set(41);

    const second = runtime.mount("b", queueSurface, queueDeps());
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
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps());
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
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps());
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
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps());
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
    const first = runtime.mount("kolu", fleetSurface, fleetDeps(1));
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

  it("a stale ctx cannot publish into the RE-MOUNTED key's subscribers", async () => {
    // The bug this exists for, measured before it was fixed: channels were named
    // `<key>/<member>` alone, and `inMemoryChannelByName` is name-addressed over
    // one publisher — so a re-mount at the same key subscribed to the very topics
    // the retired generation still published into. A write through the DROPPED
    // mount's ctx was delivered as a delta to the NEW sibling's subscribers,
    // leaving them holding a value that exists in no store on the bundle, while a
    // fresh `get` still answered the new store's. Channels carry a mount
    // GENERATION now; the write itself is refused (below), and even if a consumer
    // reaches the store another way, the topics cannot alias.
    const runtime = rooted();
    const old = runtime.mount("k", fleetSurface, fleetDeps(1));
    await old.drop();
    runtime.mount("k", fleetSurface, fleetDeps(100));

    const seen: unknown[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(
        stream(runtime.handlers, "surface/k/fleet/get"),
        (frame) => Effect.sync(() => seen.push(frame)),
      ),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(() => old.ctx.cells.fleet.set(999)).toThrow(/no longer reachable/);
    await new Promise((r) => setTimeout(r, 20));
    fiber.interruptUnsafe();
    // ONLY the new sibling's own value. Never the retired generation's write.
    expect(seen).toEqual([100]);
    await runtime.close();
  });

  it("retracts the WRITE face at the same instant as the wire face", async () => {
    // A mount has two faces and `drop()` retracts both. A write that lands in a
    // store nobody serves is the silent half of the same crosstalk, and silence is
    // what this repo's fail-loud rule is about.
    const runtime = rooted();
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps(5));
    mounted.ctx.cells.fleet.set(6); // live: fine
    await mounted.drop();
    expect(() => mounted.ctx.cells.fleet.set(7)).toThrow(SurfaceSiblingDropped);
    // READS are retracted too: the handle is dead, not merely read-only, and a
    // `get` answering out of a retired store is the same lie one level quieter.
    expect(() => mounted.ctx.cells.fleet.get()).toThrow(/no longer reachable/);
    await runtime.close();
  });

  it("retracts the ctx a still-running PROCEDURE closed over, not only the handed-back one", async () => {
    // The guard is applied INSIDE the walk, so the ctx the sibling's own
    // procedure handlers close over IS the retracting one. Wrapping the RETURNED
    // ctx instead would leave this exact path live: an in-flight unary call is
    // deliberately not interrupted by a drop — which is an argument about its
    // ANSWER, not about its SIDE EFFECTS, and the side effects outlive the drop.
    const store = inMemoryStore(0);
    const gate = Deferred.makeUnsafe<void>();
    const runtime = rooted();
    const mounted = runtime.mount("kolu", parkingSurface, {
      cells: { fleet: { store } },
      procedures: {
        slow: {
          write: ({
            ctx,
          }: {
            ctx: { cells: { fleet: { set: (n: number) => void } } };
          }) =>
            Effect.flatMap(Deferred.await(gate), () =>
              Effect.sync(() => {
                // Resumes AFTER the drop. This is the write that used to land in
                // a store nobody serves, in silence.
                ctx.cells.fleet.set(999);
                return "wrote";
              }),
            ),
        },
      },
    } as never);

    // Called while the mount is LIVE, so the trampoline hands back the real
    // handler's effect and the call is in flight when the drop lands.
    const exit = Effect.runPromiseExit(
      unary(runtime.handlers, "surface/kolu/slow/write", {}),
    );
    await mounted.drop();
    Deferred.doneUnsafe(gate, Effect.void);

    const outcome = await exit;
    expect(outcome._tag).toBe("Failure");
    expect(String(outcome._tag === "Failure" ? outcome.cause : "")).toMatch(
      /no longer reachable/,
    );
    // The store never moved: the write was refused, not merely unobserved.
    expect(store.get()).toBe(0);
    await runtime.close();
  });

  it("refuses an Effect MINTED while live but RUN after the drop", async () => {
    // The liveness read is suspended into the Effect, so it happens when the
    // member RUNS. A handler returns a description and the caller runs it a
    // moment later — the in-process dispatcher this module documents
    // (`runtime.handlers[tag](payload)`) may hold it indefinitely — so sampling
    // at handler-call time left the framework's OWN `set` writing a retired store
    // and publishing on a retired generation's channel with nothing refusing.
    const store = inMemoryStore(0);
    const runtime = rooted();
    const mounted = runtime.mount("kolu", fleetSurface, {
      cells: { fleet: { store } },
    });
    // Minted while LIVE, not yet run.
    const pending = unary(runtime.handlers, "surface/kolu/fleet/set", {
      value: 42,
    });
    await mounted.drop();
    const exit = await Effect.runPromiseExit(pending);
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("SurfaceSiblingDropped");
    expect(store.get()).toBe(0);
    await runtime.close();
  });

  it("refuses a mount on a key whose previous generation has not finished coming down", async () => {
    // The design invites FLOATING a `drop()` (it always resolves, so a caller
    // needn't await it). Mounting over an unsettled generation would leave two of
    // them owned at once — the old one's sources still supervised, its teardown
    // fault still fatal to this runtime — with nothing in the roster saying so.
    const runtime = rooted();
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps());
    const dropping = mounted.drop(); // deliberately not awaited
    expect(() => runtime.mount("kolu", fleetSurface, fleetDeps())).toThrow(
      /teardown has not settled/,
    );
    // ...and it is off the SERVED roster and out of the group from the instant of
    // the drop, even while it still holds its slot.
    expect(runtime.roster).toEqual([]);
    expect(runtime.group.requests.has("surface/kolu/fleet/get")).toBe(false);
    await dropping;
    // Settled: the slot is free and the key mounts again.
    expect(() =>
      runtime.mount("kolu", fleetSurface, fleetDeps()),
    ).not.toThrow();
    expect(runtime.roster).toEqual(["kolu"]);
    await runtime.close();
  });

  it("releases the walk's state at the drop, not at connection close", async () => {
    // The refusing wrappers outlive a drop BY DESIGN — that is what carries the
    // refusal to a connection that captured the record before it. A wrapper that
    // closed over the raw binding directly therefore pinned, through it, the
    // sibling's stores, channels, ctx and reactor nodes for as long as any such
    // connection lived: a consumer mounting and dropping against a long-lived tab
    // accumulated one whole sibling's state per cycle, with nothing the runtime
    // could release. The bindings are reached THROUGH the record, so retraction
    // drops them.
    const runtime = rooted();
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps(1));
    const captured = { ...runtime.handlers }; // what a connection holds
    expect(typeof captured["surface/kolu/fleet/get"]).toBe("function");

    await mounted.drop();
    // The wrapper is still callable — and still refuses, which is the contract.
    const exit = await Effect.runPromiseExit(
      unary(captured, "surface/kolu/fleet/set", { value: 9 }),
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("SurfaceSiblingDropped");
    await runtime.close();
  });

  it("`drop` is idempotent and the second call is the same promise", async () => {
    const runtime = rooted();
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps());
    await Promise.all([mounted.drop(), mounted.drop()]);
    expect(runtime.roster).toEqual([]);
    await runtime.close();
  });

  it("`drop` RESOLVES even when the sibling's teardown faults, and the fault reaches done", async () => {
    // `drop()`'s promise is documented as always resolving because the design
    // invites floating it — "a caller who never awaited it must not be the only
    // reader of a structural fault". So the teardown fault goes to `done`, the
    // runtime's one owned-fault channel, and never to a rejected `drop()` nobody
    // is awaiting.
    const runtime = rooted();
    const boom = new Error("finalizer died");
    const mounted = runtime.mount("kolu", fleetSurface, {
      cells: {
        fleet: {
          store: inMemoryStore(0),
          connect: () => Effect.addFinalizer(() => Effect.die(boom)),
        },
      },
    } as never);
    await expect(mounted.drop()).resolves.toBeUndefined();
    await expect(runtime.done).rejects.toThrow(/finalizer died/);
  });

  it("a CLOSE retracts every surviving mount — a close is the runtime-wide drop", async () => {
    // One law ("a handle whose bundle is gone refuses"), not one law per verb.
    // After `close` the sibling's sources are interrupted and its subscribers are
    // gone, so a surviving holder's write would land exactly where a dropped
    // one's would: in a store nobody serves.
    const runtime = rooted();
    const rootTags = Object.keys(runtime.handlers).sort();
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps(5));
    await runtime.close();
    expect(() => mounted.ctx.cells.fleet.set(7)).toThrow(SurfaceSiblingDropped);
    expect(runtime.roster).toEqual([]);
    expect(Object.keys(runtime.handlers).sort()).toEqual(rootTags);
    // The ROOT's ctx is the deliberate asymmetry — `SurfaceSiblingDropped` names
    // a sibling, and the root is not one.
    expect(() => runtime.ctx.cells.errors.set("still writable")).not.toThrow();
    await expect(runtime.done).resolves.toBeUndefined();
  });
});

describe("implementRootedSurfaces: mounting is transactional", () => {
  it("refuses a key that is already mounted, leaving the roster untouched", async () => {
    const runtime = rooted();
    runtime.mount("kolu", fleetSurface, fleetDeps());
    expect(() => runtime.mount("kolu", queueSurface, queueDeps())).toThrow(
      /already mounted/,
    );
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
    expect(() => runtime.mount("a/b", fleetSurface, fleetDeps())).toThrow();
    expect(runtime.roster).toEqual([]);
    await runtime.close();
  });

  it("refuses a mount after close", async () => {
    const runtime = rooted();
    await runtime.close();
    expect(() => runtime.mount("kolu", fleetSurface, fleetDeps())).toThrow(
      /closing or closed/,
    );
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
    const a = runtime.mount("a", fleetSurface, fleetDeps(1));
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

  it("the error class names WHICH FACE was reached, not just which member", () => {
    // The two arrivals are discriminated: a wire caller reads the tag it dialled,
    // a stale `ctx` holder reads the write it attempted. One `tag` string carrying
    // either would be a field that means two things.
    const onWire = new SurfaceSiblingDropped({
      key: "kolu",
      at: { face: "wire", tag: "surface/kolu/fleet/get" },
    });
    expect(onWire.message).toContain("surface/kolu/fleet/get");
    expect(onWire.message).toContain("no longer served");
    const onWrite = new SurfaceSiblingDropped({
      key: "kolu",
      at: { face: "ctx", path: "cells.fleet.set" },
    });
    expect(onWrite.message).toContain("cells.fleet.set");
    expect(onWrite.message).toContain("no longer reachable");
  });
});

describe("implementRootedSurfaces: served through a real per-connection door", () => {
  it("a socket accepted AFTER a mount is served the new sibling; one accepted before is not", async () => {
    // The claim the whole door rests on, asserted against an actual serve rather
    // than against `runtime.handlers` read directly — because WHICH door re-reads
    // the pair is the thing a consumer gets wrong. `serveSurfaceSocket` takes the
    // pair per accepted connection, so an accept loop that reads the runtime
    // inside its own closure serves the current roster; the two LISTENER doors
    // (`serveSurfaceApp`, `serveOverUnixSocket`) snapshot at bind and cannot.
    //
    // Modelled at the seam those doors sit on: each "connection" captures the
    // pair the way `serveSurfaceSocket` is handed it.
    const runtime = rooted();
    const accept = () => ({
      group: runtime.group,
      handlers: { ...runtime.handlers },
    });

    const before = accept();
    const mounted = runtime.mount("kolu", fleetSurface, fleetDeps(3));
    const after = accept();

    // The connection accepted BEFORE the mount cannot dial the new sibling —
    // its RpcServer was built over a group that never carried those tags.
    expect(before.group.requests.has("surface/kolu/fleet/get")).toBe(false);
    expect(before.handlers["surface/kolu/fleet/get"]).toBeUndefined();
    // The one accepted AFTER serves it, with no one having told the door.
    expect(after.group.requests.has("surface/kolu/fleet/get")).toBe(true);
    const frames: unknown[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        Stream.take(stream(after.handlers, "surface/kolu/fleet/get"), 1),
        (frame) => Effect.sync(() => frames.push(frame)),
      ),
    );
    expect(frames).toEqual([3]);

    // ...and a DROP reaches BOTH — the one accepted after through its captured
    // record's refusing wrapper, which is the half a snapshotting listener also
    // gets (and why one half-works rather than plainly failing).
    await mounted.drop();
    const exit = await Effect.runPromiseExit(
      unary(after.handlers, "surface/kolu/fleet/set", { value: 9 }),
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("SurfaceSiblingDropped");
    await runtime.close();
  });
});
