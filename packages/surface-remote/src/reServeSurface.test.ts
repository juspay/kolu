/**
 * `reServeSurface` end-to-end against a TOY surface, three hops in miniature:
 * a fake upstream agent → the re-serve (this package) → a downstream
 * `directDispatch` face. No ssh, no transport — a hand-driven fake session hands
 * the pump successive spawns.
 *
 * Proves W2.1's done-criteria and the per-binding scope:
 *   - the assembly re-serves every member kind (cell · collection · value stream ·
 *     delta stream · procedure);
 *   - KILLING THE MIDDLE HOP on a fail-through (delta) member terminates the
 *     downstream stream (the client re-subscribes end-to-end);
 *   - a HOLD-OPEN (value) member holds across the drop and REPLAYS after rebind
 *     (no healthy-but-empty flash);
 *   - two bindings get independent stores + handler records (per-binding, not one
 *     global).
 */

import { buildSurfaceFace } from "@kolu/surface/client";
import { defineSurface } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import { Cause, Effect, Exit, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { type Controllable, controllable } from "./controllableStream.testutil";
import type { RelayPolicy } from "./relayStream";
import { reServeSurface } from "./reServeSurface";
import type { Session as MirrorSession, SessionState } from "./session";
import type { AgentClient, SshProv } from "./sshConnector";

const delay = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `check` until it holds — the convergence gate that replaces "sleep and
 *  hope" wherever a test waits for the MIRROR to have folded something.
 *
 *  A fixed `delay(15)` before a mirrored read is a bet that the pump's bind, the
 *  upstream subscribe, and the fold all get scheduled inside 15ms. On a loaded
 *  box — the 4-8 core CI container running the whole suite in parallel — that bet
 *  loses, and the read honestly returns the collection's EMPTY pre-fold state:
 *  the `expected [] to deeply equal ['a','b']` flake. Waiting for the CONDITION
 *  cannot lose that race; it is bounded by a deadline rather than by a guess at
 *  how fast the box is.
 *
 *  This is not the mirror being wrong: serving `[]` before anything has been
 *  folded is the honest snapshot-then-delta contract (and the frame that follows
 *  carries the keys). It is the TEST that was asserting on a moment rather than
 *  on a state. */
async function waitUntil(
  check: () => boolean | Promise<boolean>,
  what: string,
  deadlineMs = 5_000,
): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) {
      throw new Error(`waitUntil: ${what} did not hold within ${deadlineMs}ms`);
    }
    await delay(1);
  }
}

/** The re-serve is BOUND and has folded its first upstream snapshot — the honest
 *  successor of `await delay(15) // let the pump bind + mirror the first spawn`.
 *  Reads the mirrored cell, because every test that used that sleep was waiting
 *  for exactly this. */
async function mirrored(
  downstream: ReturnType<typeof downstreamFace>,
  counterValue: number,
): Promise<void> {
  await waitUntil(async () => {
    const [v] = await take(downstream.surface.counter.get(), 1);
    return v === counterValue;
  }, `the mirror to fold the upstream counter (${counterValue})`);
}

/** Run a UNARY member call. A member call is an `Effect`, and a `vitest`
 *  assertion is a promise-shaped process edge, so this is where the two meet —
 *  once, so each `expect(...).rejects` below reads as it always did. The
 *  rejection is the SQUASHED failure, i.e. the error instance the surface
 *  failed with, which is what the `toBeInstanceOf` / `_tag` assertions read. */
function call<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect);
}

/** Take the first `n` frames of a member stream — the Effect-native successor of
 *  the old `for await … break` helper. */
function take<T>(stream: Stream.Stream<T, unknown>, n: number): Promise<T[]> {
  return Effect.runPromise(
    Stream.runCollect(Stream.take(stream, n)).pipe(
      Effect.map((frames) => Array.from(frames)),
    ),
  );
}

/** Drain a member stream into a recorder; `stop()` INTERRUPTS the subscription,
 *  which is what a downstream unsubscribe is under Effect (PLAN D10). Latches
 *  "stopped" first, so a torn-down drain reports nothing at all. */
function drain<T>(stream: Stream.Stream<T, unknown>) {
  const frames: T[] = [];
  let error: unknown = null;
  let ended = false;
  let stopped = false;
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (item: T) =>
      Effect.sync(() => {
        if (!stopped) frames.push(item);
      }),
    ),
  );
  fiber.addObserver((exit) => {
    if (stopped) return;
    if (Exit.isSuccess(exit)) {
      ended = true;
      return;
    }
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    error = Cause.squash(exit.cause);
  });
  return {
    frames,
    /** Wait until `n` frames have ARRIVED — see {@link waitUntil} for why a sleep
     *  here is a bet the loaded CI box loses. Settles early if the stream fails or
     *  ends, so the assertion below shows the real diff instead of a timeout. */
    waitFrames: async (n: number, deadlineMs = 5_000): Promise<void> => {
      const until = Date.now() + deadlineMs;
      while (frames.length < n && error === null && !ended) {
        if (Date.now() > until) {
          throw new Error(
            `waitFrames: only ${frames.length}/${n} frames arrived within ${deadlineMs}ms (error=${String(error)}, ended=${ended})`,
          );
        }
        await delay(1);
      }
    },
    /** Wait until the stream has FAILED or ended — the error-assertion twin. */
    waitSettled: async (deadlineMs = 5_000): Promise<void> => {
      const until = Date.now() + deadlineMs;
      while (error === null && !ended) {
        if (Date.now() > until) {
          throw new Error(
            `waitSettled: the stream neither failed nor ended within ${deadlineMs}ms`,
          );
        }
        await delay(1);
      }
    },
    stop: () => {
      stopped = true;
      fiber.interruptUnsafe();
    },
    get error() {
      return error;
    },
    get ended() {
      return ended;
    },
  };
}

/** Wait until the relay has actually OPENED an upstream keyed stream, then hand
 *  it back.
 *
 *  The `upstream.attachStreams.get(id)?.push(…)` idiom is a trap: the relay opens
 *  that upstream leg asynchronously, so before it exists the optional chain makes
 *  the push a SILENT NO-OP and the downstream assertion later reads `[]`. That is
 *  the `expected [] to deeply equal ['snapshot','live']` flake — a dropped
 *  stimulus, not a dropped frame. */
async function upstreamStream<T>(
  streams: Map<string, Controllable<T>>,
  key: string,
): Promise<Controllable<T>> {
  await waitUntil(
    () => streams.has(key),
    `the relay to open the upstream stream for "${key}"`,
  );
  const c = streams.get(key);
  if (!c) throw new Error(`upstreamStream: "${key}" vanished after opening`);
  return c;
}

// ── The toy surface + its forwarding policy ────────────────────────────────

/** A DECLARED procedure error — the D4 successor of the oRPC-era
 *  `ORPCError("BAD_REQUEST")` the agent used to raise. Declared on `ctl.echo`, so
 *  the re-serve's forward re-FAILS it verbatim and a downstream caller narrows on
 *  `_tag` (rather than reading a magic code off an opaque wrapper). */
class EchoRejected extends Schema.TaggedErrorClass<EchoRejected>(
  "@kolu/surface-remote/test/EchoRejected",
)("EchoRejected", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

const toySurface = defineSurface({
  cells: {
    counter: { schema: Schema.Number, default: 0 },
    // A cell WITH an `equals` predicate on the spec — pins the h3 dedup edge:
    // a forwarded write equal to the stale mirror must STILL cross to the agent,
    // even though `equals` would dedup the LOCAL apply.
    label: {
      schema: Schema.String,
      default: "",
      equals: (a: string, b: string) => a === b,
    },
  },
  collections: {
    items: {
      keySchema: Schema.String,
      schema: Schema.Struct({ n: Schema.Number }),
    },
  },
  streams: {
    // delta — a byte / liveness stream that must FAIL THROUGH.
    attach: {
      inputSchema: Schema.Struct({ id: Schema.String }),
      outputSchema: Schema.String,
    },
    // value — an input-keyed pulse that may be HELD OPEN.
    pulses: {
      inputSchema: Schema.Struct({ repo: Schema.String }),
      outputSchema: Schema.Number,
    },
  },
  procedures: {
    ctl: {
      echo: {
        input: Schema.Struct({ msg: Schema.String }),
        output: Schema.Struct({ msg: Schema.String }),
        error: EchoRejected,
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

// ── A fake upstream agent over hand-driven, interruptible streams ────────────

/** A fake agent serving the toy surface off controllable streams (the shared
 *  helper, so a downstream unsubscribe really tears the relay's upstream read
 *  down). `kill()` fails every stream it has handed out — a whole-agent link
 *  death. */
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
  let writeCounter = async (v: number): Promise<void> => {
    cellWrites.counter.push(v);
    counter.push(v);
  };
  let callEcho = async (msg: string): Promise<{ msg: string }> => {
    echoes.push(msg);
    return { msg: `echo:${msg}` };
  };

  const counter = track(controllable<number>());
  counter.push(counterValue); // snapshot; the cell stream stays open
  const label = track(controllable<string>());
  label.push(labelValue); // snapshot; the cell stream stays open

  // The agent FACE is Effect-native (a unary member row is an `Effect`), while the
  // per-test hooks below (`setCounterWriter` / `setEchoCaller`) stay async so a test
  // can `throw` in them. `tryPromise` is the join: a thrown error lands on the
  // FAILURE channel, which is where a real face puts a declared error, so the
  // re-serve’s classification sees exactly what it would in production.
  const client = {
    surface: {
      counter: {
        get: () => counter.stream,
        // A forwarded write: record it, then ECHO it back on the cell stream so
        // the mirror folds the agent's authoritative value into the local mirror.
        set: (v: number) =>
          Effect.tryPromise({ try: () => writeCounter(v), catch: (e) => e }),
      },
      label: {
        get: () => label.stream,
        set: (v: string) =>
          Effect.sync(() => {
            cellWrites.label.push(v);
            label.push(v);
          }),
      },
      items: {
        keys: () => {
          const c = track(controllable<string[]>());
          c.push(Object.keys(items));
          return c.stream;
        },
        get: ({ key }: { key: string }) => {
          const c = track(controllable<{ n: number }>());
          c.push({ n: items[key] ?? 0 });
          return c.stream;
        },
      },
      attach: {
        get: ({ id }: { id: string }) => {
          const c = track(controllable<string>());
          attachStreams.set(id, c);
          return c.stream;
        },
      },
      pulses: {
        get: ({ repo }: { repo: string }) => {
          const c = track(controllable<number>());
          pulseStreams.set(repo, c);
          return c.stream;
        },
      },
      ctl: {
        echo: ({ msg }: { msg: string }) =>
          Effect.tryPromise({ try: () => callEcho(msg), catch: (e) => e }),
      },
    },
  } as unknown as AgentClient;

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
    setCounterWriter: (writer: (v: number) => Promise<void>) => {
      writeCounter = writer;
    },
    setEchoCaller: (
      caller: (msg: string) => Promise<{
        msg: string;
      }>,
    ) => {
      callEcho = caller;
    },
    kill: () => {
      for (const c of open) c.fail(new Error("upstream link died"));
    },
  };
}

/** A fake session that hands the pump successive spawns. `setClient` mints a
 *  NEW client promise (the pump's cursor advances on promise identity) and fires
 *  `onState`; `onState` also carries a `SessionState` so a projection can read it. */
function makeSession() {
  const listeners = new Set<(s: SessionState<SshProv>) => void>();
  let destroyed = false;
  let clientPromise: Promise<AgentClient> | null = null;
  let state: SessionState<SshProv> = {
    phase: "provisioning",
    log: [],
    sinceMs: 0,
    campaignEpoch: 0,
  };
  const fire = (): void => {
    for (const cb of [...listeners]) cb(state);
  };
  const session = {
    pin: () => clientPromise ?? Promise.reject(new Error("no client yet")),
    isDestroyed: () => destroyed,
    currentClient: () => (destroyed ? null : clientPromise),
    currentState: () => state,
    onState: (cb: (s: SessionState<SshProv>) => void) => {
      listeners.add(cb);
      cb(state); // snapshot on subscribe, like the real inMemoryCell-backed onState
      return () => {
        listeners.delete(cb);
      };
    },
    markConnected: () => {
      // The `connected` arm carries `clockOffset` (null until the admit
      // `system.clockNow` probe stamps it); this fake never measures one.
      state = { ...state, phase: "connected", clockOffset: null };
      fire();
    },
    destroy: () => {
      destroyed = true;
      clientPromise = null;
      fire();
    },
    setClient: (c: AgentClient) => {
      clientPromise = Promise.resolve(c);
      fire();
    },
    setDisconnected: () => {
      state = {
        phase: "disconnected",
        error: "link dropped",
        cause: "network",
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
      };
      fire();
    },
  };
  return session;
}

type Session = ReturnType<typeof makeSession>;

/** The downstream FACE over a re-serve's handler record — `directDispatch` is
 *  the in-process link, and the face re-nests the flat tags. */
function downstreamFace(handlers: { handlers: Record<string, unknown> }) {
  return buildSurfaceFace(
    toySurface,
    directDispatch(handlers as never),
  ) as unknown as {
    surface: {
      counter: {
        get: () => Stream.Stream<number, unknown>;
        set: (v: number) => Effect.Effect<unknown, unknown>;
      };
      label: {
        get: () => Stream.Stream<string, unknown>;
        set: (v: string) => Effect.Effect<unknown, unknown>;
      };
      items: {
        keys: (i: unknown) => Stream.Stream<readonly string[], unknown>;
        get: (i: { key: string }) => Stream.Stream<{ n: number }, unknown>;
      };
      attach: { get: (i: { id: string }) => Stream.Stream<string, unknown> };
      pulses: { get: (i: { repo: string }) => Stream.Stream<number, unknown> };
      ctl: {
        echo: (i: { msg: string }) => Effect.Effect<{ msg: string }, unknown>;
      };
    };
  };
}

/** Wire a whole re-serve over an upstream serving `counterValue` + `items`. */
function setup(
  counterValue: number,
  items: Record<string, number> = {},
  labelValue = "",
  log?: (line: string) => void,
) {
  const session = makeSession();
  const upstream = makeUpstream(counterValue, items, labelValue);
  session.setClient(upstream.client);
  const served = reServeSurface({
    source: toySurface,
    policy: toyPolicy,
    session: session as unknown as MirrorSession<AgentClient, SshProv>,
    ...(log ? { log } : {}),
  });
  return {
    session,
    upstream,
    surface: served.surface,
    handlers: served.handlers,
    done: served.done,
    close: served.close,
    downstream: downstreamFace(served),
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
  it("re-serves the cell, collection, and procedure downstream", async () => {
    const { session, upstream, done, downstream } = setup(7, { a: 1, b: 2 });
    await mirrored(downstream, 7); // bound + first snapshot folded

    // Cell (value) — the mirrored snapshot.
    expect(await take(downstream.surface.counter.get(), 1)).toEqual([7]);
    // Collection (value) — keys + a per-key value, folded from the upstream. The
    // KEYS fold is a separate subscription from the cell's, so it needs its own
    // convergence gate: `mirrored` proves the pump bound, not that every member
    // has folded.
    await waitUntil(async () => {
      const [ks = []] = await take(downstream.surface.items.keys({}), 1);
      return ks.length === 2;
    }, "the mirror to fold the upstream collection keys");
    const [keys = []] = await take(downstream.surface.items.keys({}), 1);
    expect([...keys].sort()).toEqual(["a", "b"]);
    expect(await take(downstream.surface.items.get({ key: "a" }), 1)).toEqual([
      { n: 1 },
    ]);
    // Procedure — forwarded to the live upstream and back.
    expect(await call(downstream.surface.ctl.echo({ msg: "hi" }))).toEqual({
      msg: "echo:hi",
    });
    expect(upstream.echoes).toEqual(["hi"]);
    // SR9: there is no downstream `connection` cell to read — link health rides the
    // host-map entry now (the `serveHostMap` joint-invariant suite pins it), not this
    // re-served surface.

    await teardown(session, done, upstream);
  });

  it("reports a procedure's missing upstream link as a loud upstream-unavailable failure", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    upstream.kill();
    await delay(15);
    // No source surface can DECLARE the re-serving parent's own transport state,
    // so this crosses on the crash-loudly channel (a defect) rather than as a
    // domain failure a caller could branch on — the honest D4 successor of the
    // oRPC-era `ORPCError("SERVICE_UNAVAILABLE")`, whose code was sanitized away
    // on the wire anyway.
    await expect(
      call(downstream.surface.ctl.echo({ msg: "between-spawns" })),
    ).rejects.toThrow(/no live upstream link/);

    await teardown(session, done);
  });

  it("a mirror serves NO frame until the authority's first real one (never the fabricated default)", async () => {
    // Subscribe to the mirrored cell IMMEDIATELY — before the pump has bound and
    // folded the upstream's first frame — and take exactly the FIRST frame. The
    // authority's value is 7; the spec default is 0. Old behaviour served the
    // seeded default (0) as the snapshot before any fold, so a reconnect could
    // hand a consumer a value asserted by nobody. The fix withholds it: the very
    // first frame the downstream ever sees is the authority's 7, never 0.
    const { session, upstream, done, downstream } = setup(7);
    const first = await take(downstream.surface.counter.get(), 1);
    expect(first).toEqual([7]);
    await teardown(session, done, upstream);
  });

  it("kills the middle hop on a DELTA member → the downstream stream terminates (no splice)", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    const sub = drain(downstream.surface.attach.get({ id: "t1" }));
    // Wait for the relay to OPEN the upstream attach leg — pushing before it
    // exists is a silent no-op (see `upstreamStream`).
    const attach = await upstreamStream(upstream.attachStreams, "t1");
    attach.push("snapshot");
    attach.push("live");
    await sub.waitFrames(2);
    expect(sub.frames).toEqual(["snapshot", "live"]);

    // Kill the middle hop's upstream leg mid-stream.
    upstream.kill();
    await sub.waitSettled();
    expect(sub.error).toBeTruthy(); // the downstream ended — the client re-subscribes
    expect(sub.frames).toEqual(["snapshot", "live"]); // never a spliced snapshot
    sub.stop();

    await teardown(session, done); // upstream already killed
  });

  it("holds a VALUE cell open across the drop and REPLAYS after rebind", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    const sub = drain(downstream.surface.counter.get());
    await sub.waitFrames(1);
    expect(sub.frames).toEqual([1]); // snapshot from the first spawn

    // Kill the middle hop, then rebind to a fresh spawn serving counter = 2. The
    // downstream cell subscription never tore down (no flash); the store held 1
    // across the drop and now REPLAYS 2.
    upstream.kill();
    const upstream2 = makeUpstream(2);
    session.setClient(upstream2.client);
    await sub.waitFrames(2);
    expect(sub.frames).toEqual([1, 2]);

    sub.stop();
    await teardown(session, done, upstream2);
  });

  it("REBIND republishes an equals-gated cell EQUAL to the pre-drain value (#1681)", async () => {
    // `label` declares `equals: (a, b) => a === b`. Serve label = "same" and hold
    // the downstream subscription open across a rebind to a spawn serving the SAME
    // value. The framework equals-gate would drop the equal re-fold — so a
    // downstream holder (kolu-server's adopted-stale banner / connection recovery)
    // could not tell "rebound and confirmed" from "stale". The re-serve's rebind
    // epoch forces ONE republish past the gate, so the equal value crosses once.
    const { session, upstream, done, downstream } = setup(1, {}, "same");
    await mirrored(downstream, 1); // bound + first snapshot folded

    const sub = drain(downstream.surface.label.get());
    await sub.waitFrames(1);
    expect(sub.frames).toEqual(["same"]); // snapshot from the first spawn

    // Kill the middle hop, then rebind to a fresh spawn serving the SAME "same".
    // Without the epoch-force the equals-gate swallows the equal re-fold and
    // `frames` stays ["same"]; with it, the rebind republishes → ["same", "same"].
    upstream.kill();
    const upstream2 = makeUpstream(2, {}, "same");
    session.setClient(upstream2.client);
    await sub.waitFrames(2);
    expect(sub.frames).toEqual(["same", "same"]);

    // Steady state still dedups: a further EQUAL agent write does NOT republish
    // (only the rebind epoch's first fold forces; later folds keep the gate).
    await call(downstream.surface.label.set("same"));
    await sub.waitFrames(2);
    expect(sub.frames).toEqual(["same", "same"]);

    sub.stop();
    await teardown(session, done, upstream2);
  });

  it("a VALUE channel under back-pressure DROPS OLDEST + keeps flowing + LOGS — never fails the consumer", async () => {
    // (h2) The mirrored cell/collection channels are VALUE channels: a dropped
    // intermediate frame is harmless because the next snapshot/delta re-converges
    // the mirror. So the re-serve bounds each downstream receive queue with
    // `overflow: "drop-oldest"` (NOT "abort") + an `onOverflow` that LOGS the drop.
    // An "abort" would surface as a non-retryable failure and STRAND the mirror;
    // this test pins that a flooded consumer keeps flowing and never sees it.
    const logs: string[] = [];
    const overflowLogged = (): boolean =>
      logs.some((l) => /dropped the oldest frame/.test(l));

    const { session, upstream, done, downstream } = setup(0, {}, "", (line) =>
      logs.push(line),
    );
    await delay(15); // bind + fold the initial snapshot (0)

    // Open a downstream cell subscription and STALL it: the sink parks on a gate
    // after the snapshot, so the channel's per-subscriber queue fills as the
    // mirror keeps folding.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seen: number[] = [];
    let stalled = false;
    const fiber = Effect.runFork(
      Stream.runForEach(downstream.surface.counter.get(), (v: number) =>
        Effect.gen(function* () {
          seen.push(v);
          if (!stalled) {
            stalled = true;
            yield* Effect.promise(() => gate);
          }
        }),
      ),
    );
    await delay(15);
    expect(seen.length).toBeGreaterThan(0); // snapshot delivered, now parked

    // FLOOD: push far more distinct frames than the high-water mark (4096) while
    // the subscriber is stalled → the channel evicts the OLDEST per drop-oldest and
    // fires onOverflow (which logs) for each eviction.
    const FLOOD = 6000; // > RESERVE_CHANNEL_HIGH_WATER_MARK (4096)
    for (let i = 1; i <= FLOOD; i++) upstream.counterStream.push(i);
    for (let t = 0; t < 50 && !overflowLogged(); t++) await delay(10);

    // onOverflow fired → the drop is OBSERVABLE, not silent.
    expect(overflowLogged()).toBe(true);

    // KEEPS FLOWING + does NOT fail: releasing the stalled consumer delivers more
    // values, and the subscription never fails with a ChannelOverflowError (which
    // "abort" would have raised).
    release();
    for (let t = 0; t < 50 && seen.length < 2; t++) await delay(10);
    expect(seen.length).toBeGreaterThan(1);

    // The mirror re-converged to the authoritative LATEST: a FRESH subscription
    // snapshots the newest folded value (drop-oldest keeps the newest frames).
    let latest: number | undefined;
    for (let t = 0; t < 50; t++) {
      [latest] = await take(downstream.surface.counter.get(), 1);
      if (latest === FLOOD) break;
      await delay(10);
    }
    expect(latest).toBe(FLOOD);

    fiber.interruptUnsafe();
    await teardown(session, done, upstream);
  });

  it("holds a VALUE stream (pulse) open across a rebind", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    const sub = drain(downstream.surface.pulses.get({ repo: "r" }));
    (await upstreamStream(upstream.pulseStreams, "r")).push(1);
    await sub.waitFrames(1);
    expect(sub.frames).toEqual([1]);

    // Blip + rebind: the value stream holds open and keeps yielding on the next
    // spawn (unlike a delta member, which would have ended).
    upstream.kill();
    const upstream2 = makeUpstream(1);
    session.setClient(upstream2.client);
    // Wait for the REBIND to have opened the new spawn's leg, rather than for
    // 30ms and hoping.
    (await upstreamStream(upstream2.pulseStreams, "r")).push(2);
    await sub.waitFrames(2);
    expect(sub.frames).toEqual([1, 2]);

    sub.stop();
    await teardown(session, done, upstream2);
  });

  it("per-binding scope: two bindings get independent stores AND handler records", async () => {
    const a = setup(1, { x: 10 });
    const b = setup(100, { y: 20 });
    await delay(15);

    expect(await take(a.downstream.surface.counter.get(), 1)).toEqual([1]);
    expect(await take(b.downstream.surface.counter.get(), 1)).toEqual([100]);
    // Distinct per-binding handler records, not one global.
    expect(a.handlers).not.toBe(b.handlers);
    expect(a.handlers["surface/counter/get"]).not.toBe(
      b.handlers["surface/counter/get"],
    );

    await teardown(a.session, a.done, a.upstream);
    await teardown(b.session, b.done, b.upstream);
  });

  it("fails loud on a mis-classified or unannotated streaming member (no silent fold)", () => {
    // The throw fires during the synchronous deps build, before any pump starts.
    // Only STREAMS / events carry a real hold-open-vs-fail-through choice, so the
    // policy is consulted (and enforced) for those alone — cells, collections, and
    // procedures fold / forward regardless of any policy entry. Both cases target
    // the `attach` STREAM, the one member whose classification the re-serve reads.
    const s = makeSession() as unknown as MirrorSession<AgentClient, SshProv>;
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
    await mirrored(downstream, 1);

    // Gate on the keys fold BEFORE opening the held subscription. The
    // no-empty-flash invariant below is about what happens ACROSS THE RECONNECT,
    // so the subscription must start from the converged state — open it earlier
    // and its own first frame is the honest pre-fold `[]`, which is a snapshot,
    // not a flash.
    await waitUntil(async () => {
      const [ks = []] = await take(downstream.surface.items.keys({}), 1);
      return ks.length === 2;
    }, "the mirror to fold the upstream collection keys");
    const sub = drain(downstream.surface.items.keys({}));
    await waitUntil(
      () => sub.frames.length > 0,
      "the held keys subscription's first frame",
    );
    expect([...(sub.frames.at(-1) ?? [])].sort()).toEqual(["a", "b"]);

    // Kill the middle hop, then rebind to an upstream serving only {a} — b departed
    // while the link was down.
    upstream.kill();
    const upstream2 = makeUpstream(1, { a: 10 });
    session.setClient(upstream2.client);
    // Wait for the RECONCILE (the respawn's snapshot pruning `b`), not 40ms.
    await waitUntil(
      () => (sub.frames.at(-1) ?? []).length === 1,
      "the respawn's snapshot to prune the departed key",
    );

    // The held keys subscription reconciled to {a}: b was pruned (no stale ghost
    // row) and no frame ever dropped `a` (no empty flash).
    expect([...(sub.frames.at(-1) ?? [])].sort()).toEqual(["a"]);
    expect(sub.frames.every((f) => [...f].includes("a"))).toBe(true);

    sub.stop();
    await teardown(session, done, upstream2);
  });

  it("forwards a downstream cell WRITE to the agent, which echoes back through the fold", async () => {
    const { session, upstream, done, downstream } = setup(5);
    await mirrored(downstream, 5); // bound + first snapshot folded

    // A read folds from the agent…
    expect(await take(downstream.surface.counter.get(), 1)).toEqual([5]);

    // …and a WRITE crosses to the agent (it is NOT applied to the local mirror
    // directly). The agent records it and echoes it, so the fold updates the
    // mirror to the agent's authoritative value.
    await call(downstream.surface.counter.set(9));
    await delay(10);
    expect(upstream.cellWrites.counter).toEqual([9]); // crossed to the agent
    // The mirror now reads the echoed value (folded from the agent, not a phantom
    // local write).
    expect(await take(downstream.surface.counter.get(), 1)).toEqual([9]);

    await teardown(session, done, upstream);
  });

  it("a forward with no live upstream link fails loud (fail-fast), never a silent no-op", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    // Kill the link so `liveClient.current` is null, then write: the forward must
    // fail loudly (like the procedure forward), not swallow into a local no-op.
    upstream.kill();
    await delay(15);
    await expect(call(downstream.surface.counter.set(3))).rejects.toThrow(
      /no live upstream link/,
    );
    expect(upstream.cellWrites.counter).toEqual([]); // nothing crossed

    await teardown(session, done); // upstream already killed
  });

  it("rejects stale cell and procedure forwards once the session is down", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    // Session state changes synchronously when the transport dies; the mirror
    // can clear its cached client/procedure holders a turn later. A forward in
    // that edge must not call the stale client.
    session.setDisconnected();

    await expect(call(downstream.surface.counter.set(3))).rejects.toThrow(
      /no live upstream link/,
    );
    await expect(
      call(downstream.surface.ctl.echo({ msg: "stale" })),
    ).rejects.toThrow(/no live upstream link/);
    expect(upstream.cellWrites.counter).toEqual([]);
    expect(upstream.echoes).toEqual([]);

    await teardown(session, done, upstream);
  });

  it("translates a link drop during cell and procedure forwards to upstream-unavailable, keeping the raw error as `cause`", async () => {
    const cell = setup(1);
    await delay(15);
    cell.upstream.setCounterWriter(async () => {
      cell.session.setDisconnected();
      throw new Error("transport closed during cell write");
    });
    await expect(
      call(cell.downstream.surface.counter.set(3)),
    ).rejects.toMatchObject({
      name: "UpstreamUnavailableError",
      cause: expect.objectContaining({
        message: "transport closed during cell write",
      }),
    });
    await teardown(cell.session, cell.done, cell.upstream);

    const procedure = setup(1);
    await delay(15);
    procedure.upstream.setEchoCaller(async () => {
      procedure.session.setDisconnected();
      throw new Error("transport closed during procedure call");
    });
    await expect(
      call(procedure.downstream.surface.ctl.echo({ msg: "drop" })),
    ).rejects.toMatchObject({
      name: "UpstreamUnavailableError",
      cause: expect.objectContaining({
        message: "transport closed during procedure call",
      }),
    });
    await teardown(procedure.session, procedure.done, procedure.upstream);
  });

  it("preserves cell and procedure application errors while the session stays connected", async () => {
    // A CELL write has no declared error channel at all (the framework owns the
    // member), so an application rejection crosses on the crash-loudly channel —
    // carrying its own message, never re-labelled as an upstream outage.
    const cell = setup(1);
    await delay(15);
    cell.upstream.setCounterWriter(async () => {
      throw new Error("cell value rejected");
    });
    await expect(call(cell.downstream.surface.counter.set(3))).rejects.toThrow(
      /cell value rejected/,
    );
    await teardown(cell.session, cell.done, cell.upstream);

    // A PROCEDURE that DECLARES its error re-fails it verbatim: same class, same
    // `_tag`, data intact — so a downstream caller narrows on `_tag` rather than
    // reading a magic code off an opaque wrapper (D4).
    const procedure = setup(1);
    await delay(15);
    procedure.upstream.setEchoCaller(async () => {
      throw new EchoRejected({ detail: "procedure input rejected" });
    });
    const failure = await call(
      procedure.downstream.surface.ctl.echo({ msg: "bad" }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(EchoRejected);
    expect((failure as EchoRejected)._tag).toBe("EchoRejected");
    expect((failure as EchoRejected).detail).toBe("procedure input rejected");
    await teardown(procedure.session, procedure.done, procedure.upstream);
  });

  it("h3 dedup edge: a write EQUAL to the current mirror value still forwards to the agent", async () => {
    const { session, upstream, done, downstream } = setup(1);
    await mirrored(downstream, 1); // bound + first snapshot folded

    // First write establishes the mirror at "x" (the agent echoes it back).
    await call(downstream.surface.label.set("x"));
    await delay(10);
    expect(await take(downstream.surface.label.get(), 1)).toEqual(["x"]);

    // Second write of the SAME value: the `label` cell declares `equals`, so the
    // framework's LOCAL apply would dedup-skip it. But the forward BYPASSES
    // `equals` — the agent is the authority — so the write must STILL cross even
    // though it equals the stale mirror.
    await call(downstream.surface.label.set("x"));
    await delay(10);
    expect(upstream.cellWrites.label).toEqual(["x", "x"]); // both crossed

    await teardown(session, done, upstream);
  });

  it("fails loud on a source surface with no cells (markConnected has no on-connect cue)", () => {
    const cellless = defineSurface({
      streams: {
        s: { inputSchema: Schema.Struct({}), outputSchema: Schema.String },
      },
    });
    const s = makeSession() as unknown as MirrorSession<AgentClient, SshProv>;
    expect(() =>
      reServeSurface({ source: cellless, policy: { s: "delta" }, session: s }),
    ).toThrow(/no cells/);
  });
});
