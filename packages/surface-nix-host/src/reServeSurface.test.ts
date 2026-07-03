/**
 * `reServeSurface` end-to-end against a TOY surface, three hops in miniature:
 * a fake upstream agent → the re-serve (this package) → a downstream `directLink`
 * client. No ssh, no transport — a hand-driven fake `HostSession` hands the pump
 * successive spawns.
 *
 * Proves W2.1's done-criteria and the per-binding scope:
 *   - the assembly re-serves every member kind (cell · collection · value stream ·
 *     delta stream · procedure · the composed `connection` cell);
 *   - KILLING THE MIDDLE HOP on a fail-through (delta) member terminates the
 *     downstream stream (the client re-subscribes end-to-end);
 *   - a HOLD-OPEN (value) member holds across the drop and REPLAYS after rebind
 *     (no healthy-but-empty flash);
 *   - two bindings get independent stores + routers (per-binding, not one global).
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import type { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mirroredSurface } from "./connection";
import type { AgentClient, HostSession, HostSessionState } from "./hostSession";
import { reServeSurface } from "./reServeSurface";
import type { RelayPolicy } from "./relayStream";

const delay = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function take<T>(iterable: AsyncIterable<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iterable) {
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

// ── The toy surface + its forwarding policy ────────────────────────────────

const toySurface = defineSurface({
  cells: { counter: { schema: z.number(), default: 0 } },
  collections: {
    items: { keySchema: z.string(), schema: z.object({ n: z.number() }) },
  },
  streams: {
    // delta — a byte / liveness stream that must FAIL THROUGH.
    attach: {
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.string(),
    },
    // value — an input-keyed pulse that may be HELD OPEN.
    pulses: {
      inputSchema: z.object({ repo: z.string() }),
      outputSchema: z.number(),
    },
  },
  procedures: {
    ctl: {
      echo: {
        input: z.object({ msg: z.string() }),
        output: z.object({ msg: z.string() }),
      },
    },
  },
});

const toyPolicy = {
  counter: "value",
  items: "value",
  attach: "delta",
  pulses: "value",
  ctl: "value",
} as const satisfies RelayPolicy;

const mirroredToy = mirroredSurface(toySurface);
type ToyContract = typeof mirroredToy.contract;
const link = (router: unknown) =>
  directLink<ToyContract>(router as Parameters<typeof createRouterClient>[0]);

// ── A hand-driven stream + a fake upstream agent ───────────────────────────

interface Controllable<T> {
  iterable: AsyncIterable<T>;
  push(v: T): void;
  end(): void;
  fail(err: unknown): void;
}
function controllable<T>(): Controllable<T> {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let closed: "open" | "end" | { err: unknown } = "open";
  const signal = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (queue.length > 0) yield queue.shift() as T;
          if (closed === "end") return;
          if (typeof closed === "object") throw closed.err;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      },
    },
    push(v) {
      queue.push(v);
      signal();
    },
    end() {
      closed = "end";
      signal();
    },
    fail(err) {
      closed = { err };
      signal();
    },
  };
}

/** A fake agent serving the toy surface off controllable streams. `kill()` fails
 *  every stream it has handed out — a whole-agent link death. */
function makeUpstream(
  counterValue: number,
  items: Record<string, number> = {},
) {
  const open = new Set<Controllable<unknown>>();
  const track = <T>(c: Controllable<T>): Controllable<T> => {
    open.add(c as Controllable<unknown>);
    return c;
  };
  const attachStreams = new Map<string, Controllable<string>>();
  const pulseStreams = new Map<string, Controllable<number>>();
  const echoes: string[] = [];

  const counter = track(controllable<number>());
  counter.push(counterValue); // snapshot; the cell stream stays open

  const client = {
    surface: {
      counter: { get: async () => counter.iterable },
      items: {
        keys: async () => {
          const c = track(controllable<string[]>());
          c.push(Object.keys(items));
          return c.iterable;
        },
        get: async ({ key }: { key: string }) => {
          const c = track(controllable<{ n: number }>());
          c.push({ n: items[key] ?? 0 });
          return c.iterable;
        },
      },
      attach: {
        get: async ({ id }: { id: string }) => {
          const c = track(controllable<string>());
          attachStreams.set(id, c);
          return c.iterable;
        },
      },
      pulses: {
        get: async ({ repo }: { repo: string }) => {
          const c = track(controllable<number>());
          pulseStreams.set(repo, c);
          return c.iterable;
        },
      },
      ctl: {
        echo: async ({ msg }: { msg: string }) => {
          echoes.push(msg);
          return { msg: `echo:${msg}` };
        },
      },
    },
  } as unknown as AgentClient<typeof toySurface.contract>;

  return {
    client,
    attachStreams,
    pulseStreams,
    echoes,
    kill: () => {
      for (const c of open) c.fail(new Error("upstream link died"));
    },
  };
}

/** A fake `HostSession` that hands the pump successive spawns. `setClient` mints a
 *  NEW client promise (the pump's cursor advances on promise identity) and fires
 *  `onState`; `onState` also carries a `HostSessionState` so the connection pipe
 *  can project it. */
function makeSession() {
  const listeners = new Set<(s: HostSessionState) => void>();
  let destroyed = false;
  let clientPromise: Promise<AgentClient<typeof toySurface.contract>> | null =
    null;
  let state: HostSessionState = {
    connection: "copying",
    progressLines: [],
    remoteProgressLines: [],
    lastError: null,
    failureCause: null,
  };
  const fire = (): void => {
    for (const cb of [...listeners]) cb(state);
  };
  const session = {
    pin: () => clientPromise ?? Promise.reject(new Error("no client yet")),
    isDestroyed: () => destroyed,
    currentClient: () => (destroyed ? null : clientPromise),
    onState: (cb: (s: HostSessionState) => void) => {
      listeners.add(cb);
      cb(state); // snapshot on subscribe, like the real inMemoryCell-backed onState
      return () => {
        listeners.delete(cb);
      };
    },
    markConnected: () => {
      state = { ...state, connection: "connected" };
      fire();
    },
    destroy: () => {
      destroyed = true;
      clientPromise = null;
      fire();
    },
    setClient: (c: AgentClient<typeof toySurface.contract>) => {
      clientPromise = Promise.resolve(c);
      fire();
    },
  };
  return session;
}

type Session = ReturnType<typeof makeSession>;

/** Wire a whole re-serve over an upstream serving `counterValue` + `items`. */
function setup(counterValue: number, items: Record<string, number> = {}) {
  const session = makeSession();
  const upstream = makeUpstream(counterValue, items);
  session.setClient(upstream.client);
  const { surface, router, done } = reServeSurface({
    source: toySurface,
    policy: toyPolicy,
    session: session as unknown as HostSession<typeof toySurface.contract>,
  });
  return { session, upstream, surface, router, done, downstream: link(router) };
}

/** End a test cleanly: kill the live upstream so the mirror settles, destroy the
 *  session so the pump loop exits, and await it. */
async function teardown(
  session: Session,
  done: Promise<void>,
  ...upstreams: Array<{ kill: () => void }>
): Promise<void> {
  for (const u of upstreams) u.kill();
  session.destroy();
  await done;
}

describe("reServeSurface — end-to-end over a toy surface", () => {
  it("re-serves the cell, collection, procedure, and connection cell downstream", async () => {
    const { session, upstream, done, downstream } = setup(7, { a: 1, b: 2 });
    await delay(15); // let the pump bind + mirror the first spawn

    // Cell (value) — the mirrored snapshot.
    expect(
      await take(await downstream.surface.counter.get(undefined), 1),
    ).toEqual([7]);
    // Collection (value) — keys + a per-key value, folded from the upstream.
    const [keys = []] = await take(await downstream.surface.items.keys({}), 1);
    expect([...keys].sort()).toEqual(["a", "b"]);
    expect(
      await take(await downstream.surface.items.get({ key: "a" }), 1),
    ).toEqual([{ n: 1 }]);
    // Procedure — forwarded to the live upstream and back.
    expect(await downstream.surface.ctl.echo({ msg: "hi" })).toEqual({
      msg: "echo:hi",
    });
    expect(upstream.echoes).toEqual(["hi"]);
    // The composed connection cell reads `connected` once the first frame landed.
    const [conn] = await take(
      await downstream.surface.connection.get(undefined),
      1,
    );
    expect(conn?.state).toBe("connected");

    await teardown(session, done, upstream);
  });

  it("kills the middle hop on a DELTA member → the downstream stream terminates (no splice)", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await delay(15);

    const frames: string[] = [];
    let error: unknown = null;
    const sub = (async () => {
      try {
        for await (const f of await downstream.surface.attach.get({ id: "t1" }))
          frames.push(f);
      } catch (err) {
        error = err;
      }
    })();
    await delay(); // the relay opens the upstream attach stream
    upstream.attachStreams.get("t1")?.push("snapshot");
    upstream.attachStreams.get("t1")?.push("live");
    await delay();
    expect(frames).toEqual(["snapshot", "live"]);

    // Kill the middle hop's upstream leg mid-stream.
    upstream.kill();
    await sub;
    expect(error).toBeTruthy(); // the downstream stream ended — the client re-subscribes
    expect(frames).toEqual(["snapshot", "live"]); // never a spliced snapshot

    await teardown(session, done); // upstream already killed
  });

  it("holds a VALUE cell open across the drop and REPLAYS after rebind", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await delay(15);

    const frames: number[] = [];
    const ctl = new AbortController();
    const sub = (async () => {
      for await (const v of await downstream.surface.counter.get(undefined, {
        signal: ctl.signal,
      }))
        frames.push(v);
    })();
    await delay();
    expect(frames).toEqual([1]); // snapshot from the first spawn

    // Kill the middle hop, then rebind to a fresh spawn serving counter = 2. The
    // downstream cell subscription never tore down (no flash); the store held 1
    // across the drop and now REPLAYS 2.
    upstream.kill();
    const upstream2 = makeUpstream(2);
    session.setClient(upstream2.client);
    await delay(20);
    expect(frames).toEqual([1, 2]);

    ctl.abort();
    await teardown(session, done, upstream2);
    await sub; // the downstream subscription drained cleanly
  });

  it("holds a VALUE stream (pulse) open across a rebind", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await delay(15);

    const frames: number[] = [];
    const ctl = new AbortController();
    const sub = (async () => {
      for await (const v of await downstream.surface.pulses.get(
        { repo: "r" },
        { signal: ctl.signal },
      ))
        frames.push(v);
    })();
    await delay();
    upstream.pulseStreams.get("r")?.push(1);
    await delay();
    expect(frames).toEqual([1]);

    // Blip + rebind: the value stream holds open and keeps yielding on the next
    // spawn (unlike a delta member, which would have ended).
    upstream.kill();
    const upstream2 = makeUpstream(1);
    session.setClient(upstream2.client);
    await delay(20);
    upstream2.pulseStreams.get("r")?.push(2);
    await delay();
    expect(frames).toEqual([1, 2]);

    ctl.abort();
    await teardown(session, done, upstream2);
    await sub; // the downstream subscription drained cleanly
  });

  it("per-binding scope: two bindings get independent stores AND routers", async () => {
    const a = setup(1, { x: 10 });
    const b = setup(100, { y: 20 });
    await delay(15);

    expect(
      await take(await a.downstream.surface.counter.get(undefined), 1),
    ).toEqual([1]);
    expect(
      await take(await b.downstream.surface.counter.get(undefined), 1),
    ).toEqual([100]);
    expect(a.router).not.toBe(b.router); // distinct per-binding routers, not one global

    await teardown(a.session, a.done, a.upstream);
    await teardown(b.session, b.done, b.upstream);
  });

  it("fails loud on a mis-classified or unannotated streaming member (no silent fold)", () => {
    // The throw fires during the synchronous deps build, before any pump starts.
    // Only STREAMS / events carry a real hold-open-vs-fail-through choice, so the
    // policy is consulted (and enforced) for those alone — cells, collections, and
    // procedures fold / forward regardless of any policy entry. Both cases target
    // the `attach` STREAM, the one member whose classification the re-serve reads.
    const s = makeSession() as unknown as HostSession<
      typeof toySurface.contract
    >;
    // A stream classified as neither "value" nor "delta".
    expect(() =>
      reServeSurface({
        source: toySurface,
        policy: { ...toyPolicy, attach: "bogus" } as unknown as RelayPolicy,
        session: s,
      }),
    ).toThrow(/no forwarding policy/);
    // The same stream missing from the policy entirely.
    const noAttach: RelayPolicy = {
      counter: "value",
      items: "value",
      pulses: "value",
      ctl: "value",
    };
    expect(() =>
      reServeSurface({ source: toySurface, policy: noAttach, session: s }),
    ).toThrow(/no forwarding policy/);
  });
});
