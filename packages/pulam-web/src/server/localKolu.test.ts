/**
 * R9a — the localhost-dedup differential proof, hermetically.
 *
 * The bug: under `PULAM_WEB_HOSTS=localhost` pulam-web spawned its OWN `pulam`, so
 * two sensor sets watched the same terminals and drifted — `working` in pulam-web
 * vs `idle` in the Dock. The fix makes pulam-web a READER of kolu's ONE served
 * awareness instead of a second writer. This test pins the consequence: given the
 * awareness kolu serves for a terminal, the value pulam-web re-serves the browser
 * is the SAME value (deep-equal), and the SHARED agent-state fold
 * (`@kolu/terminal-workspace/agentProjection`, what both the Dock and pulam-web
 * render from) yields the SAME urgency / paint / alert — one sensor, two readers,
 * identical agent state.
 *
 * Transport is collapsed to `directLink` (the dedup PROPERTY is transport-blind):
 * a stand-in for the local kolu serves `terminalWorkspaceSurface` in-process, the
 * actual local mirror pump (`runLocalMirror`) folds it into a real `buildReServe`,
 * and a second client reads the re-serve exactly as the browser does. No socket,
 * no Nix, no second pulam.
 */

import { surfaceClient } from "@kolu/surface/solid";
import { seedAwarenessValue } from "@kolu/terminal-workspace";
import {
  agentPaintClass,
  agentUrgency,
  alertClass,
} from "@kolu/terminal-workspace/agentProjection";
import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { pulamSurface } from "../shared/contract.ts";
import {
  type KoluLink,
  runLocalMirror,
  startLocalKoluMirror,
} from "./localKolu.ts";
import { buildReServe } from "./reserve.ts";
import {
  browserLink,
  standUpAgent,
  TERM_A,
  TERM_B,
  useDisposers,
  waitFor,
} from "./testKolu.ts";

type AgentState =
  | "thinking"
  | "tool_use"
  | "waiting"
  | "awaiting_user"
  | "running_background";

/** An awareness value carrying a given agent state. Unlike `fleet.test.ts`'s
 *  pure-fold `withAgent` (a minimal cast — the folds read only `kind`/`state`),
 *  this value crosses the surface wire (the mirror's per-key get VALIDATES it
 *  against `AwarenessValueSchema`), so the `claude-code` agent is built whole. */
function withAgent(state: AgentState, cwd = "/work/repo"): AwarenessValue {
  return {
    ...seedAwarenessValue(cwd),
    agent: {
      kind: "claude-code",
      state,
      sessionId: "sess-1",
      model: null,
      summary: null,
      taskProgress: null,
      workflow: null,
      contextTokens: null,
      startedAt: null,
    },
  };
}

// A stand-in for the LOCAL kolu is the shared `standUpAgent` fixture seeded with
// the test's awareness map and a quiet (empty) live-set — kolu serves the same
// `terminalWorkspaceSurface` an ssh pulam does, so the differential test reads it
// through the same stand-up the re-serve test uses. `registryBacked: true` makes
// the awareness collection a no-op-upsert registry PROJECTION (kolu-server's
// pattern, not the pulam daemon's Map), and `kolu.publish`/`kolu.drop` mutate it
// the way kolu's sensors do (registry first, then publish) — the backing under
// which membership deltas must still reach a connected mirror.
function standUpKolu(seed: Map<TerminalId, AwarenessValue>) {
  return standUpAgent({ seed, quietLiveSet: [], registryBacked: true });
}

const disposers = useDisposers();

/** Read one terminal's re-served awareness value the way a browser ROW does: a
 *  per-key `byKey` subscription inside a reactive root (the read must run in a
 *  tracking owner — `byKey` lazily opens the per-key stream, mirroring
 *  `HostGroup`'s `valueForId`). Returns a plain getter `waitFor` can poll. */
function readServed(
  router: unknown,
  id: TerminalId,
): () => AwarenessValue | undefined {
  let value: AwarenessValue | undefined;
  createRoot((dispose) => {
    disposers.push(dispose);
    const app = surfaceClient(pulamSurface, browserLink(router));
    const awareness = app.collections.awareness.use({});
    createEffect(() => {
      const sub = awareness.byKey(id);
      value = sub !== undefined && !sub.pending() ? sub() : undefined;
    });
  });
  return () => value;
}

/** The agent state on an awareness value — the input the paint/alert folds take.
 *  Throws if the agent is absent (the differential tests always seed one), so the
 *  read narrows `AgentInfo | null` without a widening cast. */
function agentState(
  v: AwarenessValue | undefined,
): NonNullable<AwarenessValue["agent"]>["state"] {
  const agent = v?.agent;
  if (!agent) throw new Error("expected an agent on the awareness value");
  return agent.state;
}

describe("R9a — localhost mirror: one sensor, two readers (Dock ≡ pulam-web)", () => {
  it("re-serves kolu's awareness value VERBATIM, and folds it to the same agent state", async () => {
    // kolu serves an awaiting-you agent for TERM_A.
    const kolu = standUpKolu(new Map([[TERM_A, withAgent("awaiting_user")]]));

    // Drive the ACTUAL localhost pump with kolu as the source — no socket, no Nix.
    const reServe = buildReServe();
    const abort = new AbortController();
    const link: KoluLink = {
      client: kolu.client,
      ready: () => Promise.resolve(),
      isOpen: () => true,
      reconnect: () => {},
      dispose: () => {},
    };
    void runLocalMirror({ reServe, link, signal: abort.signal, log: () => {} });
    disposers.push(() => abort.abort());

    // Read the re-serve exactly as pulam-web's browser row does.
    const served = readServed(reServe.router, TERM_A);
    await waitFor(() => served() !== undefined);

    // THE DEDUP: the value pulam-web shows IS the value kolu serves — not a second,
    // separately-sensed value that could drift.
    const source = kolu.cache.get(TERM_A) as AwarenessValue;
    expect(served()).toEqual(source);

    // THE DOCK ≡ PULAM-WEB CONTRACT: both surfaces render from the shared
    // `agentProjection` fold over that ONE value, so they agree — concretely, an
    // `awaiting_user` agent reads needs-you / awaiting / notify on BOTH.
    const v = served();
    expect(agentUrgency(v?.agent)).toBe(agentUrgency(source.agent));
    expect(agentPaintClass(agentState(v))).toBe(
      agentPaintClass(agentState(source)),
    );
    expect(alertClass(agentState(v))).toBe(alertClass(agentState(source)));
    expect(agentUrgency(v?.agent)).toBe("need");
    expect(agentPaintClass(agentState(v))).toBe("awaiting");
    expect(alertClass(agentState(v))).toBe("notify");
  });

  it("tracks kolu's awareness deltas — a state change re-folds identically", async () => {
    const kolu = standUpKolu(new Map([[TERM_A, withAgent("thinking")]]));
    const reServe = buildReServe();
    const abort = new AbortController();
    void runLocalMirror({
      reServe,
      link: {
        client: kolu.client,
        ready: () => Promise.resolve(),
        isOpen: () => true,
        reconnect: () => {},
        dispose: () => {},
      },
      signal: abort.signal,
      log: () => {},
    });
    disposers.push(() => abort.abort());

    const served = readServed(reServe.router, TERM_A);

    // First snapshot: a working agent paints `working` on both surfaces.
    await waitFor(
      () =>
        served()?.agent != null &&
        agentPaintClass(agentState(served())) === "working",
    );

    // kolu's sensor flips the agent to awaiting-you — the SAME event the Dock sees
    // (published kolu-style: registry first, then fan-out).
    kolu.publish(TERM_A, withAgent("awaiting_user"));

    // pulam-web re-folds to the new state in lockstep — no stale `working` row, the
    // exact desync R9a fixes.
    await waitFor(() => agentUrgency(served()?.agent) === "need");
    expect(served()).toEqual(kolu.cache.get(TERM_A));
    expect(agentPaintClass(agentState(served()))).toBe("awaiting");
  });

  it("shows a terminal that appears AFTER the mirror connects, and drops one that leaves (live membership)", async () => {
    // The real-world case the live-verification caught: open pulam-web FIRST, then
    // start a terminal. The mirror connects with only TERM_A; TERM_B is born after.
    // Its key must reach the re-served `awareness` collection live — without a
    // mirror reconnect — or the dashboard freezes on its connect-time snapshot
    // (the membership half of the desync). kolu's awareness is a registry
    // PROJECTION (no-op upsert), so this only holds with the framework keys-delta
    // fix; a Map-backed stand-in would mask the bug.
    const kolu = standUpKolu(new Map([[TERM_A, withAgent("thinking")]]));
    const reServe = buildReServe();
    const abort = new AbortController();
    void runLocalMirror({
      reServe,
      link: {
        client: kolu.client,
        ready: () => Promise.resolve(),
        isOpen: () => true,
        reconnect: () => {},
        dispose: () => {},
      },
      signal: abort.signal,
      log: () => {},
    });
    disposers.push(() => abort.abort());

    // The browser reads the WHOLE re-served key set (a row per key), the way
    // `HostGroup` does — so a key born after connect must appear here on its own.
    let keys: readonly TerminalId[] = [];
    createRoot((dispose) => {
      disposers.push(dispose);
      const app = surfaceClient(pulamSurface, browserLink(reServe.router));
      const awareness = app.collections.awareness.use({});
      createEffect(() => {
        keys = awareness.keys() as TerminalId[];
      });
    });

    // Connect snapshot: only TERM_A is present.
    await waitFor(() => keys.includes(TERM_A));
    expect([...keys].sort()).toEqual([TERM_A]);

    // TERM_B is BORN in kolu after the mirror connected — it must surface live.
    kolu.publish(TERM_B, withAgent("awaiting_user"));
    await waitFor(() => keys.includes(TERM_B));
    expect([...keys].sort()).toEqual([TERM_A, TERM_B]);

    // And a terminal that LEAVES kolu drops from the dashboard live.
    kolu.drop(TERM_A);
    await waitFor(() => !keys.includes(TERM_A));
    expect([...keys].sort()).toEqual([TERM_B]);
  });

  it("forces a reconnect (never hot-loops) when the mirror drains on a still-OPEN incompatible link", async () => {
    // A link to a wrong/old kolu: the socket is OPEN but the server doesn't serve
    // the `terminalWorkspace` sibling, so EVERY per-primitive `get`/`keys` rejects.
    // `mirrorRemoteSurface` logs each as an upstream blip and settles, so `mirror.done`
    // resolves at once with no `version` handshake. The loop must NOT re-mirror on the
    // same dead-but-open socket (a tight CPU/log/connect hot loop, F1) — it must force
    // a reconnect so partysocket's backoff paces the retry.
    const rejecting = {
      surface: new Proxy(
        {},
        {
          get: () => ({
            get: () =>
              Promise.reject(new Error("no terminalWorkspace sibling")),
            keys: () =>
              Promise.reject(new Error("no terminalWorkspace sibling")),
          }),
        },
      ),
    } as unknown as KoluLink["client"];

    const reServe = buildReServe();
    const abort = new AbortController();
    disposers.push(() => abort.abort());
    let reconnects = 0;
    const link: KoluLink = {
      client: rejecting,
      ready: () => Promise.resolve(),
      // The socket stayed OPEN even though the mirror drained — the F1 trap.
      isOpen: () => true,
      // The loop's break: stop the test after one forced reconnect so the loop can't
      // spin unbounded if the fix regresses (a regressed loop would never call this).
      reconnect: () => {
        reconnects += 1;
        abort.abort();
      },
      dispose: () => {},
    };
    void runLocalMirror({ reServe, link, signal: abort.signal, log: () => {} });

    // The drain-on-open path forced exactly one reconnect (then aborted) — not a
    // re-mirror on the same socket.
    await waitFor(() => reconnects === 1);
    expect(reconnects).toBe(1);
  });
});

describe("startLocalKoluMirror — wires a local link, never an ssh/pulam spawn", () => {
  it("mirrors through the injected (local) link and exposes a browser handler", () => {
    // The injected `connect` IS the only connection path — `localKolu.ts` imports
    // no `getHostSession`/`pulam` spawn, so a localhost host can't start a second
    // sensor set by construction. The injection just lets the test see it run.
    const kolu = standUpKolu(
      new Map([[TERM_A, seedAwarenessValue("/work/repo")]]),
    );
    let connected = 0;
    let disposed = 0;
    const link: KoluLink = {
      client: kolu.client,
      ready: () => Promise.resolve(),
      isOpen: () => true,
      reconnect: () => {},
      dispose: () => {
        disposed += 1;
      },
    };
    const mirror = startLocalKoluMirror({
      koluUrl: "ws://127.0.0.1:7681/rpc/ws",
      connect: () => {
        connected += 1;
        return link;
      },
    });
    expect(connected).toBe(1);
    expect(mirror.handler).toBeDefined();

    mirror.destroy();
    expect(disposed).toBe(1);
  });
});
