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
import { type Controllable, controllable } from "./controllableStream.testutil";
import type { RelayPolicy } from "./relayStream";
import { reServeSurface } from "./reServeSurface";
import type { Session as MirrorSession, SessionState } from "./session";
import type { AgentClient, SshProv } from "./sshConnector";

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
  cells: {
    counter: { schema: z.number(), default: 0 },
    // A cell WITH an `equals` predicate on the spec — pins the h3 dedup edge:
    // a forwarded write equal to the stale mirror must STILL cross to the agent,
    // even though `equals` would dedup the LOCAL apply.
    label: {
      schema: z.string(),
      default: "",
      equals: (a: string, b: string) => a === b,
    },
  },
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
  label: "value",
  items: "value",
  attach: "delta",
  pulses: "value",
  ctl: "value",
} as const satisfies RelayPolicy;

const mirroredToy = mirroredSurface(toySurface);
type ToyContract = typeof mirroredToy.contract;

// ── A fake upstream agent over hand-driven, signal-aware streams ────────────

/** A fake agent serving the toy surface off controllable streams (the shared
 *  signal-AWARE helper, so a downstream abort actually unblocks the relay's
 *  upstream read). `kill()` fails every stream it has handed out — a whole-agent
 *  link death. */
function makeUpstream(
  counterValue: number,
  items: Record<string, number> = {},
  labelValue = "",
) {
  const open = new Set<Controllable<unknown>>();
  const track = <T>(c: Controllable<T>): Controllable<T> => {
    open.add(c as Controllable<unknown>);
    return c;
  };
  const attachStreams = new Map<string, Controllable<string>>();
  const pulseStreams = new Map<string, Controllable<number>>();
  const echoes: string[] = [];
  // Forwarded cell writes the agent received, in order — the write-forwarding
  // proof (a wire write must CROSS to the agent, not mutate the local mirror).
  const cellWrites: { counter: number[]; label: string[] } = {
    counter: [],
    label: [],
  };

  const counter = track(controllable<number>());
  counter.push(counterValue); // snapshot; the cell stream stays open
  const label = track(controllable<string>());
  label.push(labelValue); // snapshot; the cell stream stays open

  const client = {
    surface: {
      counter: {
        get: async (_i: unknown, opts?: { signal?: AbortSignal }) =>
          counter.stream(opts?.signal),
        // A forwarded write: record it, then ECHO it back on the cell stream so
        // the mirror folds the agent's authoritative value into the local mirror.
        set: async (v: number) => {
          cellWrites.counter.push(v);
          counter.push(v);
        },
      },
      label: {
        get: async (_i: unknown, opts?: { signal?: AbortSignal }) =>
          label.stream(opts?.signal),
        set: async (v: string) => {
          cellWrites.label.push(v);
          label.push(v);
        },
      },
      items: {
        keys: async (_i: unknown, opts?: { signal?: AbortSignal }) => {
          const c = track(controllable<string[]>());
          c.push(Object.keys(items));
          return c.stream(opts?.signal);
        },
        get: async (
          { key }: { key: string },
          opts?: { signal?: AbortSignal },
        ) => {
          const c = track(controllable<{ n: number }>());
          c.push({ n: items[key] ?? 0 });
          return c.stream(opts?.signal);
        },
      },
      attach: {
        get: async (
          { id }: { id: string },
          opts?: { signal?: AbortSignal },
        ) => {
          const c = track(controllable<string>());
          attachStreams.set(id, c);
          return c.stream(opts?.signal);
        },
      },
      pulses: {
        get: async (
          { repo }: { repo: string },
          opts?: { signal?: AbortSignal },
        ) => {
          const c = track(controllable<number>());
          pulseStreams.set(repo, c);
          return c.stream(opts?.signal);
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
    // The raw `counter` cell stream, exposed so a test can FLOOD the mirror fold
    // (push far more frames than the downstream drains) and exercise the channel's
    // per-subscriber overflow policy.
    counterStream: counter,
    attachStreams,
    pulseStreams,
    echoes,
    cellWrites,
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
  const listeners = new Set<(s: SessionState<SshProv>) => void>();
  let destroyed = false;
  let clientPromise: Promise<AgentClient<typeof toySurface.contract>> | null =
    null;
  let state: SessionState<SshProv> = {
    phase: "copying",
    log: [],
    sinceMs: 0,
  };
  const fire = (): void => {
    for (const cb of [...listeners]) cb(state);
  };
  const session = {
    pin: () => clientPromise ?? Promise.reject(new Error("no client yet")),
    isDestroyed: () => destroyed,
    currentClient: () => (destroyed ? null : clientPromise),
    onState: (cb: (s: SessionState<SshProv>) => void) => {
      listeners.add(cb);
      cb(state); // snapshot on subscribe, like the real inMemoryCell-backed onState
      return () => {
        listeners.delete(cb);
      };
    },
    markConnected: () => {
      state = { ...state, phase: "connected" };
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
function setup(
  counterValue: number,
  items: Record<string, number> = {},
  labelValue = "",
) {
  const session = makeSession();
  const upstream = makeUpstream(counterValue, items, labelValue);
  session.setClient(upstream.client);
  const { surface, router, done } = reServeSurface({
    source: toySurface,
    policy: toyPolicy,
    session: session as unknown as MirrorSession<
      AgentClient<typeof toySurface.contract>
    >,
  });
  return {
    session,
    upstream,
    surface,
    router,
    done,
    downstream: directLink<ToyContract>(
      router as Parameters<typeof createRouterClient>[0],
    ),
  };
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
    expect(conn?.phase).toBe("connected");

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

  it("REBIND republishes an equals-gated cell EQUAL to the pre-drain value (#1681)", async () => {
    // `label` declares `equals: (a, b) => a === b`. Serve label = "same" and hold
    // the downstream subscription open across a rebind to a spawn serving the SAME
    // value. The framework equals-gate would drop the equal re-fold — so a
    // downstream holder (kolu-server's adopted-stale banner / connection recovery)
    // could not tell "rebound and confirmed" from "stale". The re-serve's rebind
    // epoch forces ONE republish past the gate, so the equal value crosses once.
    const { session, upstream, done, downstream } = setup(1, {}, "same");
    await delay(15);

    const frames: string[] = [];
    const ctl = new AbortController();
    const sub = (async () => {
      for await (const v of await downstream.surface.label.get(undefined, {
        signal: ctl.signal,
      }))
        frames.push(v);
    })();
    await delay();
    expect(frames).toEqual(["same"]); // snapshot from the first spawn

    // Kill the middle hop, then rebind to a fresh spawn serving the SAME "same".
    // Without the epoch-force the equals-gate swallows the equal re-fold and
    // `frames` stays ["same"]; with it, the rebind republishes → ["same", "same"].
    upstream.kill();
    const upstream2 = makeUpstream(2, {}, "same");
    session.setClient(upstream2.client);
    await delay(20);
    expect(frames).toEqual(["same", "same"]);

    // Steady state still dedups: a further EQUAL agent write does NOT republish
    // (only the rebind epoch's first fold forces; later folds keep the gate).
    await downstream.surface.label.set("same");
    await delay(20);
    expect(frames).toEqual(["same", "same"]);

    ctl.abort();
    await teardown(session, done, upstream2);
    await sub;
  });

  it("a VALUE channel under back-pressure DROPS OLDEST + keeps flowing + LOGS — never aborts the consumer", async () => {
    // (h2) The mirrored cell/collection channels are VALUE channels: a dropped
    // intermediate frame is harmless because the next snapshot/delta re-converges
    // the mirror. So the re-serve bounds each downstream receive queue with
    // `overflow: "drop-oldest"` (NOT "abort") + an `onOverflow` that LOGS the drop.
    // An "abort" would surface as a non-retriable ORPCError and STRAND the mirror;
    // this test pins that a flooded consumer keeps flowing and never sees that abort.
    const logs: string[] = [];
    const overflowLogged = (): boolean =>
      logs.some((l) => /dropped the oldest frame/.test(l));

    const session = makeSession();
    const upstream = makeUpstream(0);
    session.setClient(upstream.client);
    const { router, done } = reServeSurface({
      source: toySurface,
      policy: toyPolicy,
      session: session as unknown as MirrorSession<
        AgentClient<typeof toySurface.contract>
      >,
      log: (line) => logs.push(line),
    });
    const downstream = directLink<ToyContract>(
      router as Parameters<typeof createRouterClient>[0],
    );
    await delay(15); // bind + fold the initial snapshot (0)

    // Open a downstream cell subscription and drive it PAST the snapshot so it
    // SUBSCRIBES to the `<key>:changed` channel (the cell `get` handler is
    // snapshot-THEN-subscribe), then STALL — never pull again — so the channel's
    // per-subscriber queue fills as the mirror keeps folding.
    const iter = (await downstream.surface.counter.get(undefined))[
      Symbol.asyncIterator
    ]();
    const r1 = await iter.next(); // snapshot (registers no subscriber yet)
    expect(r1.done).toBe(false);
    const p2 = iter.next(); // drives the generator into `bus.subscribe()` + parks
    await delay();
    upstream.counterStream.push(1); // first delta wakes the parked pull
    const r2 = await p2; // generator now suspended at `yield v`, subscriber live
    expect(r2.done).toBe(false);

    // FLOOD: push far more distinct frames than the high-water mark (4096) while
    // the subscriber is stalled → the channel evicts the OLDEST per drop-oldest and
    // fires onOverflow (which logs) for each eviction.
    const FLOOD = 6000; // > RESERVE_CHANNEL_HIGH_WATER_MARK (4096)
    for (let i = 2; i <= FLOOD; i++) upstream.counterStream.push(i);
    for (let t = 0; t < 50 && !overflowLogged(); t++) await delay(10);

    // onOverflow fired → the drop is OBSERVABLE, not silent.
    expect(overflowLogged()).toBe(true);

    // KEEPS FLOWING + does NOT abort: resuming the stalled consumer yields a value,
    // it never REJECTS with a ChannelOverflowError (which "abort" would have raised).
    const r3 = await iter.next();
    expect(r3.done).toBe(false);
    expect(typeof r3.value).toBe("number");

    // The mirror re-converged to the authoritative LATEST: a FRESH subscription
    // snapshots the newest folded value (drop-oldest keeps the newest frames).
    let latest: number | undefined;
    for (let t = 0; t < 50; t++) {
      [latest] = await take(await downstream.surface.counter.get(undefined), 1);
      if (latest === FLOOD) break;
      await delay(10);
    }
    expect(latest).toBe(FLOOD);

    await iter.return?.();
    await teardown(session, done, upstream);
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
    const s = makeSession() as unknown as MirrorSession<
      AgentClient<typeof toySurface.contract>
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

  it("reconciles a collection across a reconnect — a departed-while-down key is pruned (no stale row, no flash)", async () => {
    const { session, upstream, done, downstream } = setup(1, { a: 10, b: 20 });
    await delay(15);

    const keyFrames: string[][] = [];
    const ctl = new AbortController();
    const sub = (async () => {
      for await (const keys of await downstream.surface.items.keys(
        {},
        { signal: ctl.signal },
      ))
        keyFrames.push([...keys].sort());
    })();
    await delay();
    expect(keyFrames.at(-1)).toEqual(["a", "b"]); // both present initially

    // Kill the middle hop, then rebind to an upstream serving only {a} — b departed
    // while the link was down.
    upstream.kill();
    const upstream2 = makeUpstream(1, { a: 10 });
    session.setClient(upstream2.client);
    await delay(25);

    // The held keys subscription reconciled to {a}: b was pruned (no stale ghost
    // row) and no frame ever dropped `a` (no empty flash).
    expect(keyFrames.at(-1)).toEqual(["a"]);
    expect(keyFrames.every((f) => f.includes("a"))).toBe(true);

    ctl.abort();
    await teardown(session, done, upstream2);
    await sub;
  });

  it("forwards a downstream cell WRITE to the agent, which echoes back through the fold", async () => {
    const { session, upstream, done, downstream } = setup(5);
    await delay(15);

    // A read folds from the agent…
    expect(
      await take(await downstream.surface.counter.get(undefined), 1),
    ).toEqual([5]);

    // …and a WRITE crosses to the agent (it is NOT applied to the local mirror
    // directly). The agent records it and echoes it, so the fold updates the
    // mirror to the agent's authoritative value.
    await (
      downstream.surface.counter as unknown as {
        set: (v: number) => Promise<unknown>;
      }
    ).set(9);
    await delay();
    expect(upstream.cellWrites.counter).toEqual([9]); // crossed to the agent
    // The mirror now reads the echoed value (folded from the agent, not a phantom
    // local write).
    expect(
      await take(await downstream.surface.counter.get(undefined), 1),
    ).toEqual([9]);

    await teardown(session, done, upstream);
  });

  it("a forward with no live upstream link throws loud (fail-fast), never a silent no-op", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await delay(15);

    // Kill the link so `liveClient.current` is null, then write: the forward must
    // reject loudly (like `forwardProcedure`), not swallow into a local no-op.
    upstream.kill();
    await delay(15);
    await expect(
      (
        downstream.surface.counter as unknown as {
          set: (v: number) => Promise<unknown>;
        }
      ).set(3),
    ).rejects.toThrow(/no live upstream link/);
    expect(upstream.cellWrites.counter).toEqual([]); // nothing crossed

    await teardown(session, done); // upstream already killed
  });

  it("h3 dedup edge: a write EQUAL to the current mirror value still forwards to the agent", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await delay(15);

    const setLabel = (v: string) =>
      (
        downstream.surface.label as unknown as {
          set: (v: string) => Promise<unknown>;
        }
      ).set(v);

    // First write establishes the mirror at "x" (the agent echoes it back).
    await setLabel("x");
    await delay();
    expect(
      await take(await downstream.surface.label.get(undefined), 1),
    ).toEqual(["x"]);

    // Second write of the SAME value: the `label` cell declares `equals`, so the
    // framework's LOCAL apply would dedup-skip it. But the forward BYPASSES
    // `equals` — the agent is the authority — so the write must STILL cross even
    // though it equals the stale mirror.
    await setLabel("x");
    await delay();
    expect(upstream.cellWrites.label).toEqual(["x", "x"]); // both crossed

    await teardown(session, done, upstream);
  });

  it("fails loud on a source surface with no cells (markConnected has no on-connect cue)", () => {
    const cellless = defineSurface({
      streams: {
        s: { inputSchema: z.object({}), outputSchema: z.string() },
      },
    });
    const s = makeSession() as unknown as MirrorSession<
      AgentClient<typeof cellless.contract>
    >;
    expect(() =>
      reServeSurface({ source: cellless, policy: { s: "delta" }, session: s }),
    ).toThrow(/no cells/);
  });
});
