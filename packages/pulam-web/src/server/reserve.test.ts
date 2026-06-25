/**
 * The R8b-relevant proof, hermetically: agent → mirror → re-serve → browser
 * store, end-to-end, with NO ssh and NO Nix.
 *
 * The whole pulam-web epic rests on one claim — kolu's browser-consumption leg
 * (websocketLink → surfaceClient → Solid reconcile) works against a re-served
 * mirror of a remote `terminalWorkspaceSurface`. This test pins that leg with
 * the transport collapsed to `directLink` (in-process), so the only thing under
 * test is the FOLD: does an awareness delta on the agent flow through
 * `mirrorRemoteSurface` → `buildReServe`'s sink → the re-serve fragment → a
 * Solid `surfaceClient` collection subscription, and does that subscription
 * RE-NOTIFY?
 *
 * The pipe, left to right:
 *
 *   1. A REAL agent surface (`implementSurface(terminalWorkspaceSurface, …)`),
 *      its awareness collection backed by a Map the test mutates. Seeded with
 *      terminal "A".
 *   2. An agent client over `directLink`.
 *   3. `mirrorRemoteSurface(surface, agentClient, makeSink(), {})` —
 *      drives `buildReServe`'s sink fold WITHOUT the session (the split the
 *      design exposes for exactly this: `makeSink` builds the sink directly, no
 *      client argument — forwarding reaches the live client via the holder).
 *   4. A SECOND client over `directLink` to the re-serve router, wrapped in a
 *      Solid `surfaceClient`, its `awareness.use({})` read inside `createRoot`.
 *
 * ASSERT #1: after the first snapshot, the browser store has key "A".
 * ASSERT #2: upsert "B" + remove "A" on the agent → the Solid subscription
 * re-notifies, keys become {B}. That re-notify is the proof.
 */

import { directLink } from "@kolu/surface/links/direct";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { surfaceClient } from "@kolu/surface/solid";
import { seedAwarenessValue } from "@kolu/terminal-workspace";
import type { ConnectionInfo } from "@kolu/surface-nix-host/connection";
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import { createEffect, createMemo, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ArivuBrowserContract, arivuSurface } from "../shared/contract.ts";
import { type ArivuContract, buildReServe } from "./reserve.ts";

// Two real UUID terminal ids (the collection's key schema is `z.string().uuid()`,
// so a bare "A"/"B" would fail validation at the agent's collection boundary).
const TERM_A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const TERM_B = "22222222-2222-4222-8222-222222222222" as TerminalId;

/** A `directLink` to a re-serve router, typed over the BROWSER contract
 *  (`arivuSurface` = base + connection). The documented fragment→client cast (the
 *  `implementSurface` router's `Lazy<Router>` shape isn't accepted by
 *  `directLink`'s input type; the runtime is a valid router) lives here, once,
 *  rather than at every call site. */
function browserLink(router: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — runtime shape is valid.
  return directLink<ArivuBrowserContract>(router as any);
}

/** Stand up a REAL `terminalWorkspaceSurface` agent over `directLink`. The
 *  awareness collection is backed by the returned `cache` Map and driven through
 *  the returned `ctx` — pushing a delta is `ctx.collections.awareness.upsert(...)`
 *  / `.remove(...)`, exactly what the daemon's sensors do. Every other primitive
 *  is implemented minimally (it must be: `implementSurface` fail-fast THROWS on
 *  any unimplemented one) — they're never exercised by this test, but their
 *  presence proves the re-serve grafts onto a COMPLETE agent surface. */
function standUpAgent(
  opts: { activityFeed?: AsyncIterable<TerminalId[]> } = {},
) {
  const cache = new Map<TerminalId, AwarenessValue>();
  cache.set(TERM_A, seedAwarenessValue("/work/repo-a"));

  // The agent serves the BASE surface (connection-free) — link health is the
  // PARENT's, added only at the re-serve seam via `mirroredSurface`.
  const { router, ctx } = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: { version: { store: inMemoryStore({ ...DEFAULT_VERSION }) } },
    collections: {
      awareness: {
        readAll: () => cache,
        upsert: (key, value) => {
          cache.set(key, value);
        },
        remove: (key) => {
          cache.delete(key);
        },
      },
    },
    streams: {
      // Live-set source. By default yields the current key set once (not
      // exercised); the activity re-notify test drives it from a hand-fed feed so
      // the live-set frames are deterministic, not snapshot-timing-dependent.
      activity: {
        source: opts.activityFeed
          ? async function* (_input, signal) {
              for await (const frame of opts.activityFeed as AsyncIterable<
                TerminalId[]
              >) {
                if (signal?.aborted) break;
                yield frame;
              }
            }
          : async function* () {
              yield [...cache.keys()];
            },
      },
      // Minimal watcher sources — one snapshot pulse, then done. Not exercised.
      subscribeRepoChange: {
        source: async function* () {
          yield { seq: 0 };
        },
      },
      subscribeFileChange: {
        source: async function* () {
          yield { seq: 0 };
        },
      },
    },
    // Minimal fs/git — canned, schema-valid, never called by this test.
    procedures: {
      fs: {
        listAll: () => ({ paths: [] }),
        readFile: () => ({ content: "", truncated: false }),
        statFileMtimeMs: () => 0,
      },
      git: {
        getStatus: ({ input }) =>
          input.mode === "local"
            ? {
                mode: "local" as const,
                files: [],
                branch: {
                  name: "main",
                  upstream: null,
                  ahead: 0,
                  behind: 0,
                },
                workingTree: { staged: 0, modified: 0, untracked: 0 },
              }
            : { mode: "branch" as const, files: [], base: null },
        getDiff: () => ({
          oldFileName: null,
          newFileName: null,
          hunks: [],
          binary: false,
        }),
      },
    },
  });

  // biome-ignore lint/suspicious/noExplicitAny: matches the repo's documented fragment→client cast — the implementSurface router's Lazy<Router> spread isn't accepted by directLink's input type; the runtime shape is valid.
  const client = directLink<ArivuContract>(router as any);
  return { cache, ctx, client };
}

// Track Solid roots + mirror aborts so each test tears its reactive graph and
// background mirror down (no leaked effects across tests).
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch {
      /* best-effort teardown */
    }
  }
});

/** Poll until `predicate()` holds — delegates to `vi.waitFor` (Vitest's built-in
 *  retry loop) so the test's clock for the async fold (mirror frame → re-serve
 *  publish → Solid effect flush) stays consistent with the rest of the suite. */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000 } = {},
): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), {
    timeout: timeoutMs,
  });
}

/** A hand-fed async iterable: `push(frame)` enqueues, `close()` ends it. Frames
 *  are pushed by the test, so the activity stream's order is deterministic rather
 *  than racing the snapshot timing (drishti's `processesStream.test.ts` pattern). */
function makeFeed<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(item: T): void {
      queue.push(item);
      wake?.();
    },
    close(): void {
      closed = true;
      wake?.();
    },
    iterable: {
      async *[Symbol.asyncIterator](): AsyncGenerator<T> {
        while (true) {
          while (queue.length > 0) yield queue.shift() as T;
          if (closed) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    } as AsyncIterable<T>,
  };
}

describe("buildReServe — the mirror's connection health reaches the browser", () => {
  it("surfaces a FAILED mirror as `failed` (with lastError), never a healthy-empty fleet", async () => {
    // The re-serve alone — no agent, no mirror. The `connection` cell is NOT
    // folded from the mirror; it's the SESSION's state, written via
    // `setConnection` (what `pipeSessionStateToCell` does off `session.onState`).
    const reServe = buildReServe();
    const browserClient = browserLink(reServe.router);

    let connNow: () => ConnectionInfo | undefined = () => undefined;
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const conn = app.cells.connection.use({});
      connNow = () => conn.value();
    });

    // Gate-closed default: the browser reads `connecting` BEFORE any session
    // frame — never `connected`, so the dashboard can't paint a healthy-empty
    // host while the link is still coming up.
    await waitFor(() => connNow()?.state === "connecting");

    // The session gives up. The parent writes the terminal `failed` state. NO
    // awareness keys are present: the down state must reach the browser ON ITS
    // OWN, not be inferred from — or hidden behind — an empty awareness set.
    reServe.setConnection({
      state: "failed",
      lastError: "exited with code 1",
      failureCause: "remote",
      progressLines: ["[remote] kaval speaks pty-host 3.2, pulam needs 3.3"],
    });

    // The browser cell RE-NOTIFIES to `failed`, carrying the real error — the
    // regression guard. Before the connection cell existed, a dead mirror left
    // awareness empty and the browser painted "no terminals"; now it reads
    // honestly. A revert of the gate flips this red.
    await waitFor(() => connNow()?.state === "failed");
    expect(connNow()?.lastError).toBe("exited with code 1");
    expect(connNow()?.failureCause).toBe("remote");
    expect(connNow()?.progressLines.at(-1)).toContain("pty-host 3.2");
  });
});

describe("buildReServe — agent → mirror → re-serve → browser store", () => {
  it("seeds the browser store from the agent snapshot, then re-notifies on a delta", async () => {
    // 1 + 2. The real agent surface and its in-process client.
    const agent = standUpAgent();

    // 3. The re-serve, and the mirror that folds the agent's frames into its
    //    sink. We call `mirrorRemoteSurface` ourselves with the test client and
    //    `makeSink()` — the split `buildReServe` exposes precisely so the
    //    fold is testable without `pumpRemoteSurface`'s session.
    const reServe = buildReServe();
    // Abort-driven teardown: pass `{ signal }` so the mirror's in-memory
    // subscriptions are actually torn down in the disposer (not just left for GC),
    // and we settle `mirror.done` so a teardown error surfaces rather than floats.
    const mirrorAbort = new AbortController();
    const mirror = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      agent.client,
      reServe.makeSink(),
      { signal: mirrorAbort.signal },
    );
    // The re-serve forwards input-param streams / procedures through the live
    // client; wire it so the whole shell is live (unused by this test, but it
    // mirrors how `hostEntry` populates the holder around a spawn). Fire
    // `onChange` so the holder matches the pump's set semantics.
    reServe.liveClient.current = agent.client;
    reServe.liveClient.onChange?.();
    disposers.push(() => {
      reServe.liveClient.current = null;
      reServe.liveClient.onChange?.();
      mirrorAbort.abort();
      // Settle (not ignore) the mirror's done so any teardown rejection is
      // observed here rather than left as a floating promise across tests.
      void mirror.done.catch(() => {});
    });

    // 4. A SECOND client to the RE-SERVE router, wrapped in a Solid client, with
    //    its awareness collection read inside a reactive root.
    const browserClient = browserLink(reServe.router);

    let keysNow: () => TerminalId[] = () => [];
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const awareness = app.collections.awareness.use({});
      keysNow = () => awareness.keys();
    });

    // ASSERT #1: after the first snapshot folds through, the browser store has A.
    await waitFor(() => keysNow().includes(TERM_A));
    expect([...keysNow()].sort()).toEqual([TERM_A]);

    // Push a delta ON THE AGENT: B arrives, A departs. The agent's wrapped
    // upsert/remove publish through its keyed channels → the mirror's sink folds
    // them into the re-serve cache → the re-serve's keyed channels push to the
    // browser client → the Solid subscription re-runs.
    agent.ctx.collections.awareness.upsert(
      TERM_B,
      seedAwarenessValue("/work/repo-b"),
    );
    agent.ctx.collections.awareness.remove(TERM_A);

    // ASSERT #2: the Solid store RE-NOTIFIES — keys become {B}. This is the
    // proof: the delta crossed agent → mirror → re-serve → browser-store.
    await waitFor(() => {
      const keys = keysNow();
      return keys.includes(TERM_B) && !keys.includes(TERM_A);
    });
    expect([...keysNow()].sort()).toEqual([TERM_B]);
  });
});

/**
 * F1 proof: a forwarded INPUT-parameterized stream (`subscribeRepoChange`) must
 * stay OPEN across the live-client lifecycle — yield its lead frame before any
 * client, HOLD (not complete) while none is up, bind to the live client when one
 * appears, and REBIND to the next one when a spawn's stream ends. The whole point
 * is that a remote respawn doesn't drop the browser↔parent transport, so a
 * one-shot forward would silently go dead.
 *
 * We drive the re-serve's browser-facing `subscribeRepoChange` source directly
 * over `directLink` and flip `reServe.liveClient` by hand (the pump's job in
 * production), asserting on the pulse `seq`s the browser sees.
 */
describe("forwardInputStream — holds open and rebinds across spawns (F1)", () => {
  /** A minimal AgentClient stand-in whose `subscribeRepoChange` yields a
   *  controllable pulse stream. Only the slice `forwardInputStream` reaches
   *  (`.surface.subscribeRepoChange.get`) is implemented. `pulse(seq)` enqueues a
   *  frame; `end()` completes the stream (a respawn / link death). Pulses queue
   *  on the holder itself (not per-subscribe), so a `pulse(1)` racing ahead of the
   *  forwarder's `.get()` subscribe is BUFFERED and still delivered — the test
   *  asserts behaviour, not subscribe-timing luck. */
  function fakeClient() {
    const queue: Array<{ seq: number }> = [];
    let wake: (() => void) | null = null;
    let done = false;
    let failure: Error | null = null;
    const surface = {
      subscribeRepoChange: {
        get: async (_input: { repoPath: string }) => ({
          async *[Symbol.asyncIterator]() {
            while (true) {
              while (queue.length > 0) yield queue.shift() as { seq: number };
              // A link drop mid-stream surfaces as a THROW from the iterator —
              // the F2 path. The forward must treat it like a clean end (hold +
              // rebind), never let it kill the browser subscription.
              if (failure !== null) throw failure;
              if (done) return;
              await new Promise<void>((r) => {
                wake = r;
              });
            }
          },
        }),
      },
    };
    return {
      // biome-ignore lint/suspicious/noExplicitAny: structural stand-in for the slice forwardInputStream reaches
      client: { surface } as any,
      pulse: (seq: number) => {
        queue.push({ seq });
        wake?.();
      },
      end: () => {
        done = true;
        wake?.();
      },
      /** The live link dropped mid-stream: the iterator THROWS instead of
       *  completing — the F2 case the clean-end path doesn't cover. */
      throwError: (message: string) => {
        failure = new Error(message);
        wake?.();
      },
    };
  }

  it("yields the lead frame before any client, then forwards a client's pulses, then rebinds to the next spawn", async () => {
    const reServe = buildReServe();
    const browser = browserLink(reServe.router);

    const ac = new AbortController();
    const seen: number[] = [];
    const iterable = await browser.surface.subscribeRepoChange.get(
      { repoPath: "/work/repo" },
      { signal: ac.signal },
    );
    // Drain in the background so we can assert on `seen` as we drive the holder.
    const drain = (async () => {
      try {
        for await (const pulse of iterable) seen.push(pulse.seq);
      } catch {
        /* aborted on teardown */
      }
    })();
    disposers.push(() => {
      ac.abort();
      void drain.catch(() => {});
    });

    // Lead frame {seq:0} arrives BEFORE any live client — the snapshot a browser
    // that subscribed pre-handshake still gets — and the stream does NOT complete.
    await waitFor(() => seen.includes(0));

    // First spawn appears: bind and forward its pulses.
    const spawn1 = fakeClient();
    reServe.liveClient.current = spawn1.client;
    reServe.liveClient.onChange?.();
    spawn1.pulse(1);
    await waitFor(() => seen.includes(1));

    // That spawn's link dies (stream ends) and the holder clears — the forward
    // must HOLD, not complete.
    spawn1.end();
    reServe.liveClient.current = null;
    reServe.liveClient.onChange?.();

    // Next spawn appears: the forward REBINDS and its pulses flow through the
    // SAME browser subscription (proof the stream stayed open across the gap).
    const spawn2 = fakeClient();
    reServe.liveClient.current = spawn2.client;
    reServe.liveClient.onChange?.();
    spawn2.pulse(2);
    await waitFor(() => seen.includes(2));

    expect(seen).toEqual([0, 1, 2]);
  });

  it("survives a remote stream ERROR (not just a clean end) — holds open and rebinds (F2)", async () => {
    const reServe = buildReServe();
    const browser = browserLink(reServe.router);

    const ac = new AbortController();
    const seen: number[] = [];
    let drainThrew: unknown = null;
    const iterable = await browser.surface.subscribeRepoChange.get(
      { repoPath: "/work/repo" },
      { signal: ac.signal },
    );
    const drain = (async () => {
      try {
        for await (const pulse of iterable) seen.push(pulse.seq);
      } catch (err) {
        // The browser subscription must NOT throw on an upstream link blip —
        // record it so the test fails loudly if F2's guard regresses.
        drainThrew = err;
      }
    })();
    disposers.push(() => {
      ac.abort();
      void drain.catch(() => {});
    });

    await waitFor(() => seen.includes(0));

    // First spawn forwards a pulse, then its link DROPS mid-stream (the iterator
    // throws, not a clean end).
    const spawn1 = fakeClient();
    reServe.liveClient.current = spawn1.client;
    reServe.liveClient.onChange?.();
    spawn1.pulse(1);
    await waitFor(() => seen.includes(1));
    spawn1.throwError("stdio link dropped");
    reServe.liveClient.current = null;
    reServe.liveClient.onChange?.();

    // The next spawn appears: the forward must have HELD across the error and now
    // REBINDS — its pulse flows through the SAME browser subscription.
    const spawn2 = fakeClient();
    reServe.liveClient.current = spawn2.client;
    reServe.liveClient.onChange?.();
    spawn2.pulse(2);
    await waitFor(() => seen.includes(2));

    expect(seen).toEqual([0, 1, 2]);
    // The browser subscription stayed alive the whole time — the upstream error
    // was swallowed as a link blip, never propagated.
    expect(drainThrew).toBeNull();
  });
});

/**
 * The R-pulamweb-3 proof: the dashboard's green activity dot consumes the
 * `activity` stream — VALUE-BEARING (each frame is the full live set), so it
 * reads through `.streams.activity.use()` (replace-each-frame), NOT the
 * delta-accumulate `createSubscription` + reduce path R-pulamweb-1's
 * `processesSnapshot` needs.
 *
 * This pins the value-bearing analog of R-pulamweb-1's same-shape-delta proof:
 * two consecutive frames of the SAME cardinality (one id each) but different
 * membership must each re-notify a FINE-GRAINED reader (`liveSet().has(id)` —
 * exactly how a row reads its dot). The membership is observed into closed-over
 * vars so the assertion proves the effect RE-RAN, not merely that the accessor
 * holds a value — the case a coarse copy-into-store would coalesce away. The path
 * under test is the full agent → mirror → re-serve → browser-store leg.
 */
describe("buildReServe — activity stream re-notifies on a same-shape live-set swap", () => {
  it("flips a fine-grained dot reader across two same-cardinality membership swaps", async () => {
    const feed = makeFeed<TerminalId[]>();
    const agent = standUpAgent({ activityFeed: feed.iterable });

    const reServe = buildReServe();
    const mirrorAbort = new AbortController();
    const mirror = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      agent.client,
      reServe.makeSink(),
      { signal: mirrorAbort.signal },
    );
    reServe.liveClient.current = agent.client;
    reServe.liveClient.onChange?.();
    disposers.push(() => {
      reServe.liveClient.current = null;
      reServe.liveClient.onChange?.();
      mirrorAbort.abort();
      feed.close();
      void mirror.done.catch(() => {});
    });

    const browserClient = browserLink(reServe.router);

    // FINE-GRAINED membership readers — exactly how a row reads its green dot.
    let aLive: boolean | undefined;
    let bLive: boolean | undefined;
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const live = app.streams.activity.use(() => ({}));
      const liveSet = createMemo(() => new Set(live() ?? []));
      createEffect(() => {
        aLive = liveSet().has(TERM_A);
      });
      createEffect(() => {
        bLive = liveSet().has(TERM_B);
      });
    });

    // Establish the live set as {A}. The `activity` bus only delivers FUTURE
    // publishes (no replay), so a frame pushed before the browser's bus
    // subscription registers is dropped — re-push [A] each tick until the dot
    // lights, which deterministically covers that race (re-pushing the same
    // membership is idempotent). Once a frame lands, the subscription is live and
    // the ordered swaps below deliver reliably.
    await vi.waitFor(
      () => {
        feed.push([TERM_A]);
        expect(aLive).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(bLive).toBe(false);

    // Swap 1 — same cardinality (one id), A out / B in. The coalescing regression
    // would drop this same-shape frame; the fine-grained readers must flip.
    feed.push([TERM_B]);
    await waitFor(() => bLive === true && aLive === false);

    // Swap 2 — same cardinality again, B out / A in. A second same-shape frame
    // must ALSO re-notify (the exact case R-pulamweb-1 found a coarse reader drops
    // on the second consecutive same-shape delta).
    feed.push([TERM_A]);
    await waitFor(() => aLive === true && bLive === false);
  });

  /**
   * F1 regression: a quiet terminal must NOT paint live before a real activity
   * frame arrives. The re-serve's `activity` snapshot is the last frame the mirror
   * folded (`[]` before any) — NOT the awareness key set. A previous cut yielded
   * `[...awarenessCache.keys()]` as the snapshot, so a terminal that merely EXISTS
   * (TERM_A is in the awareness cache) painted its dot live until the next byte
   * moved — the green dot is the byte-tap, orthogonal to a terminal existing.
   *
   * The bug is a SNAPSHOT bug, so the test must subscribe to `activity` only AFTER
   * the re-serve's awareness cache is fully populated — otherwise an empty cache at
   * subscribe time would mask it. We first stand up an awareness subscription and
   * wait until TERM_A has folded into the re-serve, THEN open a fresh `activity`
   * subscription (its snapshot reads the cache at THAT moment): the dot must still
   * read `false`, because no byte has moved. Pushing a real `[TERM_A]` frame then
   * lights it — proving the snapshot is the live set, not the key set.
   */
  it("does NOT paint a quiet terminal live before an activity frame (F1)", async () => {
    // A feed that never pushes a frame — the host is quiet (no bytes moving), but
    // TERM_A is in the awareness cache (seeded by `standUpAgent`).
    const feed = makeFeed<TerminalId[]>();
    const agent = standUpAgent({ activityFeed: feed.iterable });

    const reServe = buildReServe();
    const mirrorAbort = new AbortController();
    const mirror = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      agent.client,
      reServe.makeSink(),
      { signal: mirrorAbort.signal },
    );
    reServe.liveClient.current = agent.client;
    reServe.liveClient.onChange?.();
    disposers.push(() => {
      reServe.liveClient.current = null;
      reServe.liveClient.onChange?.();
      mirrorAbort.abort();
      feed.close();
      void mirror.done.catch(() => {});
    });

    const browserClient = browserLink(reServe.router);

    // First: an awareness subscription, so we can wait until TERM_A has folded
    // into the re-serve's cache. This makes the `activity` subscribe below land
    // AFTER the cache is populated — the only timing under which the old snapshot
    // bug (`yield [...awarenessCache.keys()]`) would surface.
    let keys: () => TerminalId[] = () => [];
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const awareness = app.collections.awareness.use({});
      keys = () => awareness.keys();
    });
    await waitFor(() => keys().includes(TERM_A));

    // Now open a FRESH activity subscription — its snapshot reads the re-serve's
    // cache, which now holds TERM_A. The dot must still read `false`: no byte has
    // moved, so the live set is empty regardless of what keys exist.
    let aLive: boolean | undefined;
    // The raw snapshot the stream delivered (`undefined` until it lands). We wait
    // on THIS — not on `aLive` — so the assertion can't pass on the pre-snapshot
    // `undefined → empty set → false` transient; the snapshot must have actually
    // arrived (the buggy snapshot would carry `[TERM_A]`).
    let snapshot: readonly TerminalId[] | undefined;
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const live = app.streams.activity.use(() => ({}));
      const liveSet = createMemo(() => new Set(live() ?? []));
      createEffect(() => {
        snapshot = live();
      });
      createEffect(() => {
        aLive = liveSet().has(TERM_A);
      });
    });

    // Wait until the snapshot frame actually lands, then assert the dot is dark.
    // The buggy `yield [...awarenessCache.keys()]` would deliver `[TERM_A]` here
    // (the key exists), lighting the dot; the fix yields `[]` (nothing live yet).
    await waitFor(() => snapshot !== undefined);
    expect(aLive).toBe(false);
    expect([...(snapshot ?? [])]).toEqual([]);

    // A real activity frame now lights it — proving the dot tracks the byte-tap,
    // not the existence of the key.
    await vi.waitFor(
      () => {
        feed.push([TERM_A]);
        expect(aLive).toBe(true);
      },
      { timeout: 2000 },
    );
  });
});

/**
 * Issue #1549 — a stale awareness row must NOT survive an ssh-link respawn.
 *
 * pulam-web's awareness cache is built ONCE per host session (`buildReServe`)
 * and closed over by every (re)spawn's sink, while each fresh mirror's per-key
 * `open` set starts EMPTY. So a key that left the remote while the link was down
 * is absent from the new snapshot AND unknown to the new mirror — its `onRemove`
 * never fires, and the cache pins a phantom row indefinitely (the Dock, reading
 * kolu's in-process awareness, correctly shows it gone). The pump fires
 * `onLinkDown` on each link death; the re-serve answers with `resetRemoteFold()`,
 * dropping the fold so the NEXT spawn rebuilds from the remote's authoritative
 * snapshot. One reset collapses both flavors: a finished agent's `working` is
 * overwritten by the fresh snapshot, and a departed terminal's ghost is dropped.
 *
 * The activity live-set is the SAME per-host-session local state with the same
 * pathology, so `resetRemoteFold` clears it too (`activityLatest = []` + an
 * empty bus frame) — the second test below pins that.
 *
 * The first test drives two spawns through ONE re-serve exactly as
 * `pumpRemoteSurface` does — spawn #1 with terminal A, link death (+ the pump's
 * `onLinkDown` → `resetRemoteFold`), then spawn #2 whose snapshot no longer has
 * A — and asserts an ALREADY-subscribed browser sees A depart rather than keep
 * painting the ghost (a fresh-subscribe browser would merely read the rebuilt
 * cache).
 */
describe("buildReServe — resets the remote-derived fold on link death (#1549)", () => {
  it("drops a terminal that departed during the link-down window across the respawn", async () => {
    const reServe = buildReServe();
    const browserClient = browserLink(reServe.router);

    // A browser subscribed BEFORE the reconnect — the one that must see the
    // ghost depart, not a fresh-subscribe browser reading the rebuilt cache.
    let keysNow: () => TerminalId[] = () => [];
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const awareness = app.collections.awareness.use({});
      keysNow = () => awareness.keys();
    });

    // ── Spawn #1: terminal A is present. ──
    const spawn1 = standUpAgent(); // seeds TERM_A
    const abort1 = new AbortController();
    const mirror1 = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      spawn1.client,
      reServe.makeSink(),
      { signal: abort1.signal },
    );
    reServe.liveClient.current = spawn1.client;
    reServe.liveClient.onChange?.();
    await waitFor(() => keysNow().includes(TERM_A));

    // ── Link death: the pump aborts the mirror, clears the live client, and
    //    fires `onLinkDown`. The mirror's teardown fires NO `onRemove` for A
    //    (it only aborts the per-key controllers), so the cache still pins A —
    //    `resetRemoteFold` is what drops it. ──
    abort1.abort();
    // Abort-driven teardown RESOLVES `.done` (mirrorRemoteSurface swallows
    // abort-time rejections; only a `SinkError` — a broken local fold — rejects).
    // So await it bare, NOT `.catch(() => {})`: a swallow here would hide a real
    // sink failure or setup regression while the test marched on to pass.
    await mirror1.done;
    reServe.liveClient.current = null;
    reServe.liveClient.onChange?.();
    reServe.resetRemoteFold(); // ← the pump's `onLinkDown` hook

    // The subscribed browser sees A depart the instant the fold resets — not
    // keep the stale row pinned across the down window.
    await waitFor(() => !keysNow().includes(TERM_A));

    // ── Spawn #2: A departed while the link was down — its snapshot is empty. ──
    const spawn2 = standUpAgent();
    spawn2.cache.delete(TERM_A); // the terminal is gone on the remote now
    const abort2 = new AbortController();
    const mirror2 = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      spawn2.client,
      reServe.makeSink(),
      { signal: abort2.signal },
    );
    reServe.liveClient.current = spawn2.client;
    reServe.liveClient.onChange?.();
    disposers.push(() => {
      reServe.liveClient.current = null;
      reServe.liveClient.onChange?.();
      abort2.abort();
      void mirror2.done.catch(() => {});
    });

    // The rebuilt fold has no A and no respawn ever re-adds it — the ghost is
    // gone for good.
    await waitFor(() => keysNow().length === 0);
    expect([...keysNow()]).toEqual([]);
  });

  it("clears the activity live-set on link death — for both an existing and a fresh subscriber", async () => {
    const feed = makeFeed<TerminalId[]>();
    const agent = standUpAgent({ activityFeed: feed.iterable });

    const reServe = buildReServe();
    const abort = new AbortController();
    const mirror = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      agent.client,
      reServe.makeSink(),
      { signal: abort.signal },
    );
    reServe.liveClient.current = agent.client;
    reServe.liveClient.onChange?.();
    disposers.push(() => {
      reServe.liveClient.current = null;
      reServe.liveClient.onChange?.();
      abort.abort();
      feed.close();
      void mirror.done.catch(() => {});
    });

    const browserClient = browserLink(reServe.router);

    // An ALREADY-subscribed browser — the one that must hear the dot go dark on
    // link death, not just a fresh-subscribe browser reading the reset snapshot.
    let aLive: boolean | undefined;
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const live = app.streams.activity.use(() => ({}));
      const liveSet = createMemo(() => new Set(live() ?? []));
      createEffect(() => {
        aLive = liveSet().has(TERM_A);
      });
    });

    // Light A live (re-push until the bus subscription registers — same race the
    // re-notify test documents). `activityLatest` now pins `[TERM_A]`.
    await vi.waitFor(
      () => {
        feed.push([TERM_A]);
        expect(aLive).toBe(true);
      },
      { timeout: 2000 },
    );

    // ── Link death + the pump's `onLinkDown` → `resetRemoteFold`. WITHOUT the
    //    activity half of the reset, `activityLatest` would still pin `[TERM_A]`:
    //    the existing subscriber never hears it leave, and a fresh subscriber
    //    reads the stale snapshot — a dead link's last frame painting a quiet
    //    terminal live across the reconnect. ──
    abort.abort();
    await mirror.done;
    reServe.liveClient.current = null;
    reServe.liveClient.onChange?.();
    reServe.resetRemoteFold();

    // The existing subscriber sees A go dark (the empty bus frame reached it).
    await waitFor(() => aLive === false);

    // A FRESH subscriber's snapshot is empty too (`activityLatest` was reset, so
    // it no longer reads the dead link's last frame).
    let freshLive: TerminalId[] | undefined;
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(arivuSurface, browserClient);
      const live = app.streams.activity.use(() => ({}));
      createEffect(() => {
        freshLive = live();
      });
    });
    await waitFor(() => freshLive !== undefined);
    expect([...(freshLive ?? [])]).toEqual([]);
  });
});
