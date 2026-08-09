/**
 * The read paths, exercised against a hand-rolled fake `PadiSurfaceClient` (no
 * socket): `readTerminalKeys` (the id-prefix read), `settledSnapshot` (the
 * `status` read) and `awaitAgentState` (the `wait` read). Four regressions are
 * pinned here:
 *
 *   - `wait` must resolve `gone` — not hang — when the watched terminal exited in
 *     the gap between the caller resolving its id and this subscription opening
 *     (the target is absent from the mirror's FIRST snapshot, so the mirror never
 *     opens — hence never removes — its key; the seeded id is what rescues it).
 *   - `status` must FAIL LOUD when the link drops mid-read, rather than collapsing
 *     a dropped link to a partial/empty table (caught-error-must-not-collapse-to-
 *     empty).
 *   - a `keys` stream that ends WITHOUT a snapshot frame must throw, never
 *     collapse to "no terminals" (the same rule, one layer down).
 *   - the one-shot key read must TEAR ITS SUBSCRIPTION DOWN. Under Effect there is
 *     no `signal` left to pass a member verb (D10/#18), so the only thing that
 *     closes it is returning out of the `for await` — and if that ever stopped
 *     interrupting, every `wait` / `create --parent` on either CLI face would leak
 *     a live `keys` subscription for the life of the link with nothing to show
 *     for it.
 */

import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { awaitAgentState, type PadiSurfaceClient } from "./dial.ts";
import type { PadiTerminal } from "./surface.ts";
import { readTerminalKeys, settledSnapshot } from "./read.ts";

const id = (s: string): TerminalId => s as TerminalId;

const claudeAgent = (state: string): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

/** A minimal `active` record. `git`/`agent`/`foreground` default to the all-null
 *  shape `isResolved` treats as still-sensing (so `settledSnapshot` keeps waiting);
 *  a case overrides one to mark it resolved. */
function active(over: Record<string, unknown>): PadiTerminal {
  return {
    state: "active",
    agent: null,
    git: null,
    pr: { kind: "pending" },
    foreground: null,
    ...over,
  } as unknown as PadiTerminal;
}

/** A pushable snapshot-then-delta SOURCE: every subscribe replays the queued
 *  frames from the start, waits for more, and ends on `end()` — the exact
 *  contract the surface mirror consumes.
 *
 *  {@link stream} hands back a LAZY `Stream` per call, like a real member ref: no
 *  frame is read until something subscribes, and teardown is fiber interruption
 *  rather than the `AbortSignal` the pre-Effect fake threaded through every verb
 *  (D10/#18 — there is no signal left to pass). `Stream.suspend` keeps each
 *  subscribe on its own replay cursor, so two subscribers never share one.
 *
 *  The iterator deliberately exposes NO `return` method. `Stream.fromAsyncIterable`
 *  registers a teardown finalizer only when one EXISTS, and it awaits what
 *  `return()` resolves — an iterator parked on an unsettled `next()` promise would
 *  never resolve it, hanging scope close instead of tearing down. Without the
 *  method, an interrupt simply abandons the parked read, which is all a test
 *  needs. (Same shape as the framework's own pushable fakes.) */
class FakeSource<T> {
  private readonly frames: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private ended = false;
  push(v: T): void {
    this.frames.push(v);
    this.wake();
  }
  end(): void {
    this.ended = true;
    this.wake();
  }
  private wake(): void {
    for (const r of this.waiters.splice(0)) r();
  }
  stream(): Stream.Stream<T, unknown> {
    return Stream.suspend(() =>
      Stream.fromAsyncIterable<T, unknown>(this.iterable(), (e) => e),
    );
  }
  private iterable(): AsyncIterable<T> {
    let i = 0;
    const next = async (): Promise<IteratorResult<T, undefined>> => {
      while (true) {
        // In-range by the guard; the cast satisfies noUncheckedIndexedAccess.
        if (i < this.frames.length) {
          return { value: this.frames[i++] as T, done: false };
        }
        if (this.ended) return { value: undefined, done: true };
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
}

/** A structural `PadiSurfaceClient` over three pushable sources — enough of
 *  `.surface.terminals.keys` / `.terminals.get` / `.activity.get` for the mirror
 *  and the direct reads. Each verb returns a `Stream` SYNCHRONOUSLY, the shape
 *  every member ref has under Effect. */
function fakeClient(streams: {
  keys: FakeSource<readonly TerminalId[]>;
  activity: FakeSource<readonly TerminalId[]>;
  get: (key: TerminalId) => FakeSource<PadiTerminal>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminals: {
        keys: () => streams.keys.stream(),
        get: (input: { key: TerminalId }) => streams.get(input.key).stream(),
      },
      activity: { get: () => streams.activity.stream() },
    },
  } as unknown as PadiSurfaceClient;
}

/** A `keys` source whose iterator DOES expose `return`, so
 *  `Stream.fromAsyncIterable` registers its teardown finalizer and the test can
 *  OBSERVE it. Hand-rolled rather than an async generator precisely so `return()`
 *  settles at once — a generator parked on an unsettled `next()` would never
 *  resolve it, which is why {@link FakeSource} omits the method entirely.
 *
 *  After `frames` are exhausted the stream stays LIVE (a `next()` that never
 *  settles), which is what a real `keys` subscription does: the snapshot arrives,
 *  then it waits for deltas forever. So a reader that did NOT tear down would
 *  simply never return. */
function observableKeys(frames: ReadonlyArray<readonly TerminalId[]>) {
  let closed = false;
  let i = 0;
  const stream = Stream.suspend(() =>
    Stream.fromAsyncIterable<readonly TerminalId[], unknown>(
      {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            i < frames.length
              ? Promise.resolve({
                  value: frames[i++] as readonly TerminalId[],
                  done: false as const,
                })
              : new Promise<IteratorResult<readonly TerminalId[], undefined>>(
                  () => {},
                ),
          return: () => {
            closed = true;
            return Promise.resolve({ value: undefined, done: true as const });
          },
        }),
      },
      (e) => e,
    ),
  );
  return { stream, isClosed: () => closed };
}

/** A `PadiSurfaceClient` whose ONLY member is `terminals.keys` — everything
 *  `readTerminalKeys` touches, and nothing else, so a read that reached further
 *  would crash rather than quietly pass. */
function keysOnlyClient(
  stream: Stream.Stream<readonly TerminalId[], unknown>,
): PadiSurfaceClient {
  return {
    surface: { terminals: { keys: () => stream } },
  } as unknown as PadiSurfaceClient;
}

describe("readTerminalKeys — the one-shot key set", () => {
  it("returns the FIRST snapshot frame of a still-live stream, and closes it", async () => {
    const { stream, isClosed } = observableKeys([[id("t1"), id("t2")]]);

    expect(
      await Effect.runPromise(readTerminalKeys(keysOnlyClient(stream))),
    ).toEqual([id("t1"), id("t2")]);
    // Returning out of the `for await` interrupted the subscription — the ONLY
    // teardown left now that member verbs take no `signal`.
    expect(isClosed()).toBe(true);
  });

  it("THROWS when the stream ends with no snapshot frame (never 'no terminals')", async () => {
    // Zero terminals is a defined EMPTY ARRAY frame; an empty STREAM is a link or
    // protocol failure. Collapsing the two would make `wait <id>` report `no
    // terminal matching <id>` and `status` render a blank table.
    await expect(
      Effect.runPromise(readTerminalKeys(keysOnlyClient(Stream.empty))),
    ).rejects.toThrow(/no snapshot frame/i);
  });

  it("surfaces a stream failure as a rejection, not a synchronous throw", async () => {
    // A member ref hands back a Stream and can fail where the old `async` verb
    // could only reject; `main`'s single `.catch` is what turns this into the
    // CLI's one-line `padi-tui: <message>`.
    await expect(
      Effect.runPromise(
        readTerminalKeys(
          keysOnlyClient(Stream.fail(new Error("socket hung up"))),
        ),
      ),
    ).rejects.toThrow(/socket hung up/);
  });
});

describe("awaitAgentState — the `wait` read", () => {
  it("resolves `gone` when the terminal exited before the watch subscribed", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    // The FIRST (and only) keys snapshot no longer carries the target — it exited
    // in the id-resolve → subscribe gap. Streams stay open (no `end`), so without
    // the seeded-id reconciliation this wait (no timeout) would hang forever.
    keys.push([]);
    activity.push([]);
    const client = fakeClient({
      keys,
      activity,
      get: () => new FakeSource<PadiTerminal>(),
    });

    const outcome = await awaitAgentState(client, {
      id: id("t-gone"),
      targets: new Set(["working"]),
    });
    // `gone` now carries the scaffold's elapsedMs stamp — assert the kind.
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("resolves `met` for a present terminal already in a target bucket (seed is inert here)", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ agent: claudeAgent("thinking") })); // bucket → working
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    const outcome = await awaitAgentState(client, {
      id: id("t1"),
      targets: new Set(["working"]),
    });
    expect(outcome.kind).toBe("met");
  });
});

describe("settledSnapshot — the `status` read", () => {
  it("FAILS LOUD when the link drops mid-read (never a silent partial table)", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({})); // never flips `isResolved` → the read keeps waiting…
    // …until the link drops: every subscription ends with no abort from us.
    keys.end();
    activity.end();
    tget.end();
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    await expect(
      Effect.runPromise(settledSnapshot(client, { maxMs: 5000, graceMs: 50 })),
    ).rejects.toThrow(/link closed/i);
  });

  it("returns the snapshot on a clean settle (a warm padi resolves at once)", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ git: { branch: "main" } })); // git non-null → resolved
    // Streams stay OPEN — the settle is driven by grace, not a dropped link.
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    const entries = await Effect.runPromise(
      settledSnapshot(client, { maxMs: 5000, graceMs: 20 }),
    );
    expect(entries.map(([k]) => k)).toEqual([id("t1")]);
  });
});
