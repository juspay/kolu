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
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ArivuContract, buildReServe } from "./reserve.ts";

// Two real UUID terminal ids (the collection's key schema is `z.string().uuid()`,
// so a bare "A"/"B" would fail validation at the agent's collection boundary).
const TERM_A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const TERM_B = "22222222-2222-4222-8222-222222222222" as TerminalId;

/** Stand up a REAL `terminalWorkspaceSurface` agent over `directLink`. The
 *  awareness collection is backed by the returned `cache` Map and driven through
 *  the returned `ctx` — pushing a delta is `ctx.collections.awareness.upsert(...)`
 *  / `.remove(...)`, exactly what the daemon's sensors do. Every other primitive
 *  is implemented minimally (it must be: `implementSurface` fail-fast THROWS on
 *  any unimplemented one) — they're never exercised by this test, but their
 *  presence proves the re-serve grafts onto a COMPLETE agent surface. */
function standUpAgent() {
  const cache = new Map<TerminalId, AwarenessValue>();
  cache.set(TERM_A, seedAwarenessValue("/work/repo-a"));

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
      // Minimal live-set source — yields the current key set once. Not exercised.
      activity: {
        source: async function* () {
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
    // biome-ignore lint/suspicious/noExplicitAny: same documented fragment→client cast as the agent above.
    const browserClient = directLink<ArivuContract>(reServe.router as any);

    let keysNow: () => TerminalId[] = () => [];
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(terminalWorkspaceSurface, browserClient);
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
    // biome-ignore lint/suspicious/noExplicitAny: same documented fragment→client cast as elsewhere.
    const browser = directLink<ArivuContract>(reServe.router as any);

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
    // biome-ignore lint/suspicious/noExplicitAny: same documented fragment→client cast as elsewhere.
    const browser = directLink<ArivuContract>(reServe.router as any);

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
