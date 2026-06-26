/**
 * `connectSurfaces` — the MULTI-surface seam (move 3): one socket → a
 * `surfaceClients` bundle + ONE default-on heartbeat probing the first sibling's
 * reserved `system.live`, with the one socket's liveness folded into the combined
 * `surfaceClientsHealth().live`. The hand-built admin path (a bare socket + status
 * + `surfaceClients` with NO heartbeat) is what this replaces, so half-open
 * detection is no longer a function of which constructor a consumer called.
 *
 * Two properties are pinned: the combined `live` tracks the one socket (NOT a
 * constant `true`), and the heartbeat is wired to probe the FIRST sibling's scoped
 * rpc (the synth's flagged risk — the reserved `system.live` must be reachable
 * through the scoped link). The socket is faked at its two observable events (a
 * live partysocket flakes in node), and `createHeartbeat` is captured so the probe
 * thunk can be fired without waiting on its interval.
 */

import { defineSurface } from "@kolu/surface/define";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocked = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: fake socket stands in for a PartySocket.
  ws: undefined as any,
  heartbeatProbe: undefined as undefined | (() => Promise<unknown>),
  probedClients: [] as unknown[],
}));

// Mock the socket seam (hand back the fake ws).
vi.mock("../connect", async (importActual) => {
  const actual = await importActual<typeof import("../connect")>();
  return {
    ...actual,
    createSurfaceSocket: () => ({
      ws: mocked.ws,
      echo: { remember: () => {}, appendTo: (u: string) => u },
    }),
  };
});

// Mock the heartbeat PRIMITIVE (capture the probe thunk so the test can fire it
// without waiting on the 15s interval). `connectSurfaces` now wires the watchdog
// through `createLiveSignal` (`@kolu/surface`), which uses THIS primitive — so the
// capture lives here, not on surface-app's `../connect` wrapper.
vi.mock("@kolu/surface/heartbeat", async (importActual) => {
  const actual = await importActual<typeof import("@kolu/surface/heartbeat")>();
  return {
    ...actual,
    createHeartbeat: (opts: { probe: () => Promise<unknown> }) => {
      mocked.heartbeatProbe = opts.probe;
      return { dispose: () => {} };
    },
  };
});

// Mock the reserved probe so firing the heartbeat records which client's rpc it
// was handed, without sending a real RPC over the fake socket.
vi.mock("@kolu/surface/liveness", async (importActual) => {
  const actual = await importActual<typeof import("@kolu/surface/liveness")>();
  return {
    ...actual,
    probeSurfaceLive: (client: unknown) => {
      mocked.probedClients.push(client);
      return Promise.resolve();
    },
  };
});

import { connectSurfaces } from "./connectSurfaces";

const surface = defineSurface({
  cells: {
    conn: {
      schema: z.object({ s: z.string() }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** A socket reduced to listeners fired by hand — tolerant of arbitrary event
 *  types so it survives `websocketLink(ws)` construction (no RPC is ever sent). */
function fakeWs() {
  const listeners: Record<
    string,
    Array<(event?: { code?: number }) => void>
  > = {};
  return {
    ws: {
      addEventListener: (
        type: string,
        fn: (event?: { code?: number }) => void,
      ) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: (
        type: string,
        fn: (event?: { code?: number }) => void,
      ) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
      },
      send: () => {},
      close: () => {},
      readyState: 0,
      OPEN: 1,
    },
    fire: (type: string, code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of (listeners[type] ?? []).slice()) l(event);
    },
  };
}

describe("connectSurfaces — one socket, multi-surface, heartbeat by construction", () => {
  it("folds the ONE socket's liveness into the merged surfaceClientsHealth().live", () => {
    const t = fakeWs();
    mocked.ws = t.ws;
    createRoot((dispose) => {
      const conn = connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
      });
      // Pre-open: `connecting` → not live (NOT a constant `true` the hand-built
      // path would leave when `{ live }` was forgotten).
      expect(conn.health().live).toBe(false);
      t.fire("open");
      expect(conn.health().live).toBe(true);
      // A drop / silent half-open → not live, for EVERY sibling (AND-reduce).
      t.fire("close", 1006);
      expect(conn.health().live).toBe(false);
      t.fire("open");
      expect(conn.health().live).toBe(true);
      conn.dispose();
      dispose();
    });
  });

  it("wires the default-on heartbeat to probe the FIRST sibling's reserved system.live", () => {
    const t = fakeWs();
    mocked.ws = t.ws;
    mocked.probedClients = [];
    mocked.heartbeatProbe = undefined;
    createRoot((dispose) => {
      const conn = connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
      });
      // The heartbeat is default-ON: connectSurfaces handed `createHeartbeat` a
      // probe thunk.
      expect(typeof mocked.heartbeatProbe).toBe("function");
      // Firing it reaches `probeSurfaceLive` with the FIRST sibling's scoped rpc —
      // so the reserved `system.live` is probed through `clients.a.rpc`, never a
      // path that misses the scoped slice.
      void mocked.heartbeatProbe?.();
      expect(mocked.probedClients).toHaveLength(1);
      expect(mocked.probedClients[0]).toBe(conn.clients.a.rpc);
      conn.dispose();
      dispose();
    });
  });
});
