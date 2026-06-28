/**
 * `connectTerminalWorkspace` — the client twin of `serveTerminalWorkspace`. Pins
 * the one thing it exists to own: SELECTING the `terminalWorkspace` sibling out of
 * a kolu link that multiplexes several surfaces, so a consumer never reconstructs
 * `composeSurfaceContracts` or names the sibling.
 *
 * The pulam-web mirror tests inject a pre-scoped `directLink` client, so they
 * bypass this scoping entirely. Here a REAL multi-sibling surface — a decoy plus
 * the real `terminalWorkspaceSurface`, multiplexed via `composeSurfaceContracts` /
 * `implementSurfaces` exactly as kolu mounts them — is served over `directLink`,
 * and `connectTerminalWorkspace`'s output is asserted to reach the
 * `terminalWorkspace` awareness (a known key), NOT the decoy. The partysocket seam
 * is faked (a live partysocket flakes in node — the same reason `connectSurfaces`'s
 * test fakes it); the SCOPING under test is transport-agnostic, so the directLink
 * roundtrip exercises it faithfully.
 */

import { implement } from "@orpc/server";
import { directLink } from "@kolu/surface/links/direct";
import {
  type Channel,
  composeSurfaceContracts,
  implementSurfaces,
  inMemoryChannel,
  inMemoryStore,
} from "@kolu/surface/server";
import { defineSurface } from "@kolu/surface/define";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { seedAwarenessValue } from "./index.ts";
import { type TerminalId, terminalWorkspaceSurface } from "./surface.ts";
import {
  quietActivity,
  serveTerminalWorkspace,
} from "./serveTerminalWorkspace.ts";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";

// A terminal present in the served terminalWorkspace's awareness — the marker a
// correctly-scoped client reads back. A valid UUID (the awareness key schema).
const KNOWN_ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

/** Shared holder the faked `websocketLink` hands back — set per test to the real
 *  multi-sibling `directLink` client (vi.mock factories are hoisted above the test
 *  body, so the client is threaded through this). */
const mocked = vi.hoisted(() => ({
  link: undefined as unknown,
}));

// Fake the partysocket seam: `createSurfaceSocket` returns a minimal open socket
// (no real connect — a live partysocket flakes in node), `createHeartbeat` is a
// no-op (its probe never fires without the interval).
vi.mock("@kolu/surface-app/connect", async (importActual) => {
  const actual =
    await importActual<typeof import("@kolu/surface-app/connect")>();
  return {
    ...actual,
    createSurfaceSocket: () => ({
      ws: { readyState: 1, OPEN: 1, reconnect: () => {}, close: () => {} },
      echo: { remember: () => {}, appendTo: (u: string) => u },
    }),
    createHeartbeat: () => ({ dispose: () => {}, wake: () => {} }),
  };
});

// `websocketLink` hands back the real multi-sibling directLink client instead of
// building an oRPC client over the fake socket — so the scoping runs against a
// genuine `composeSurfaceContracts` client, just over an in-process transport.
vi.mock("@kolu/surface/links/websocket", () => ({
  websocketLink: () => mocked.link,
}));

import { connectTerminalWorkspace } from "./connect.ts";

/** Serve a kolu-shaped multiplex: a `decoy` sibling AND the real
 *  `terminalWorkspace` (seeded with `KNOWN_ID`), keyed exactly as kolu's
 *  `implementSurfaces` does, reachable via an in-process `directLink`. */
function serveMultiSibling() {
  const decoy = defineSurface({
    cells: {
      marker: {
        schema: z.object({ who: z.string() }),
        default: { who: "decoy" },
        verbs: ["get"],
      },
    },
  });
  const surfaces = { decoy, terminalWorkspace: terminalWorkspaceSurface };
  const awareness = new Map([[KNOWN_ID, seedAwarenessValue("/work/known")]]);
  const { router } = implementSurfaces(
    surfaces,
    { channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>() },
    {
      decoy: { cells: { marker: { store: inMemoryStore({ who: "decoy" }) } } },
      terminalWorkspace: serveTerminalWorkspace({
        awareness: {
          readAll: () => awareness,
          upsert: () => {},
          remove: () => {},
        },
        activity: quietActivity,
        // fs/git are wired but never invoked by this test (it reads awareness),
        // so a bare endpoint stub suffices (as serveTerminalWorkspace.test does).
        endpoint: {} as TerminalWorkspaceEndpoint,
        log: { level: "silent" } as never,
      }),
    },
  );
  const contract = composeSurfaceContracts(surfaces);
  // biome-ignore lint/suspicious/noExplicitAny: implementSurfaces' Lazy<Router> spread isn't accepted by oRPC's input type; the runtime shape is a valid router.
  const wrapped = implement(contract).router({ ...router } as any);
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — the runtime shape is a valid client.
  return directLink<typeof contract>(wrapped as any);
}

describe("connectTerminalWorkspace — selects the terminalWorkspace sibling", () => {
  it("scopes a multi-sibling kolu client to terminalWorkspace's awareness, not the decoy", async () => {
    mocked.link = serveMultiSibling();

    const conn = connectTerminalWorkspace("ws://test/rpc/ws");

    // The scoped client reads terminalWorkspace's awareness keys — proving it
    // picked the `terminalWorkspace` sibling. A mis-scope to `decoy` (which has no
    // `awareness` collection) would throw "no such entry" rather than yield this.
    const keysStream = await (
      conn.client as unknown as {
        surface: {
          awareness: {
            keys: (
              i: unknown,
              o: { signal?: AbortSignal },
            ) => Promise<AsyncIterable<TerminalId[]>>;
          };
        };
      }
    ).surface.awareness.keys({}, {});
    const first = await keysStream[Symbol.asyncIterator]().next();
    expect(first.value).toEqual([KNOWN_ID]);

    conn.dispose();
  });

  it("exposes a socket whose lifecycle a consumer can drive (open/reconnect/close)", () => {
    mocked.link = serveMultiSibling();
    const conn = connectTerminalWorkspace("ws://test/rpc/ws");
    // The transport handle is the generic WS face — no kolu-composition knowledge.
    expect(conn.socket.readyState).toBe(conn.socket.OPEN);
    expect(typeof conn.socket.reconnect).toBe("function");
    expect(typeof conn.dispose).toBe("function");
    conn.dispose();
  });
});
