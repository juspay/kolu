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
 *   3. `mirrorRemoteSurface(surface, agentClient, makeSink(agentClient), {})` —
 *      drives `buildReServe`'s sink fold WITHOUT the session (the split the
 *      design exposes for exactly this: `makeSink` is invokable with any client).
 *   4. A SECOND client over `directLink` to the re-serve router, wrapped in a
 *      Solid `surfaceClient`, its `awareness.use({})` read inside `createRoot`.
 *
 * ASSERT #1: after the first snapshot, the browser store has key "A".
 * ASSERT #2: upsert "B" + remove "A" on the agent → the Solid subscription
 * re-notifies, keys become {B}. That re-notify is the proof.
 */

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { directLink } from "@kolu/surface/links/direct";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { surfaceClient } from "@kolu/surface/solid";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { seedAwarenessValue } from "@kolu/terminal-workspace";
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
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

/** Spin until `predicate()` holds or the budget elapses — the test's clock for
 *  the async fold (mirror frame → re-serve publish → Solid effect flush). */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000, stepMs = 5 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met within budget");
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe("buildReServe — agent → mirror → re-serve → browser store", () => {
  it("seeds the browser store from the agent snapshot, then re-notifies on a delta", async () => {
    // 1 + 2. The real agent surface and its in-process client.
    const agent = standUpAgent();

    // 3. The re-serve, and the mirror that folds the agent's frames into its
    //    sink. We call `mirrorRemoteSurface` ourselves with the test client and
    //    `makeSink(client)` — the split `buildReServe` exposes precisely so the
    //    fold is testable without `pumpRemoteSurface`'s session.
    const reServe = buildReServe();
    const mirror = mirrorRemoteSurface(
      terminalWorkspaceSurface,
      agent.client,
      reServe.makeSink(agent.client),
      {},
    );
    // The re-serve forwards input-param streams / procedures through the live
    // client; wire it so the whole shell is live (unused by this test, but it
    // mirrors how `hostEntry` populates the holder around a spawn).
    reServe.liveClient.current = agent.client;
    disposers.push(() => {
      reServe.liveClient.current = null;
      // The mirror's `done` settles when the agent's streams close; we don't
      // await it (it's the loop body, per the design note) — the afterEach
      // teardown lets pending subscriptions get collected.
      void mirror.done;
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
