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

import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { surfaceClient } from "@kolu/surface/solid";
import { seedAwarenessValue } from "@kolu/terminal-workspace";
import {
  agentPaintClass,
  agentUrgency,
  alertClass,
} from "@kolu/terminal-workspace/agentProjection";
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import { createEffect, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PulamBrowserContract, pulamSurface } from "../shared/contract.ts";
import {
  type KoluLink,
  runLocalMirror,
  startLocalKoluMirror,
} from "./localKolu.ts";
import { type PulamContract, buildReServe } from "./reserve.ts";

const TERM_A = "11111111-1111-4111-8111-111111111111" as TerminalId;

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

/**
 * Stand up a stand-in for the LOCAL kolu: a real `terminalWorkspaceSurface` served
 * over `directLink`, its `awareness` collection backed by a Map the test drives
 * through the returned `ctx` (`ctx.collections.awareness.upsert/remove`) — exactly
 * what kolu serves on `terminalWorkspace.awareness`. Every other primitive is
 * implemented minimally so `implementSurface`'s fail-fast construction passes; none
 * but `awareness`/`version`/`activity` is exercised here.
 */
function standUpKolu(seed: ReadonlyMap<TerminalId, AwarenessValue>) {
  const cache = new Map(seed);
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
      // Quiet live-set (kolu serves `quietActivity` until R9) — one empty frame.
      activity: {
        source: async function* () {
          yield [];
        },
      },
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
                branch: { name: "main", upstream: null, ahead: 0, behind: 0 },
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
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — the implementSurface router's Lazy<Router> spread isn't accepted by directLink's input type; the runtime shape is valid.
  const client = directLink<PulamContract>(router as any) as KoluLink["client"];
  return { cache, ctx, client };
}

/** A `directLink` to a re-serve router, typed over the BROWSER contract
 *  (`pulamSurface` = base + connection) — the same read the browser leg makes. */
function browserLink(router: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — runtime shape is valid.
  return directLink<PulamBrowserContract>(router as any);
}

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

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000 } = {},
): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), {
    timeout: timeoutMs,
  });
}

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

    // kolu's sensor flips the agent to awaiting-you — the SAME event the Dock sees.
    kolu.ctx.collections.awareness.upsert(TERM_A, withAgent("awaiting_user"));

    // pulam-web re-folds to the new state in lockstep — no stale `working` row, the
    // exact desync R9a fixes.
    await waitFor(() => agentUrgency(served()?.agent) === "need");
    expect(served()).toEqual(kolu.cache.get(TERM_A));
    expect(agentPaintClass(agentState(served()))).toBe("awaiting");
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
