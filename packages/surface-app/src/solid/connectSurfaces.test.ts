/**
 * `connectSurfaces` — the MULTI-surface seam: one wire → a `surfaceClients`
 * bundle + ONE default-on heartbeat probing the first sibling's reserved
 * `system/live` tag, with the one wire's liveness folded into the combined
 * `surfaceClientsHealth().live`. The hand-built admin path (a bare socket +
 * status + `surfaceClients` with NO heartbeat) is what this replaces, so half-open
 * detection is no longer a function of which constructor a consumer called.
 *
 * Three properties are pinned: the combined `live` tracks the one wire (NOT a
 * constant `true`), the heartbeat probes the FIRST sibling's reserved liveness TAG
 * (the scoped tag must be the one `implementSurfaces` binds), and an empty surface
 * map fails fast (no sibling ⇒ no probe target). The socket is faked through the
 * link's own `connect` seam — no module mocking — and `createHeartbeat` is
 * captured so the probe thunk can be fired without waiting on its interval.
 */

import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  heartbeatProbe: undefined as undefined | (() => Promise<unknown>),
}));

// Mock the heartbeat PRIMITIVE (capture the probe thunk so the test can fire it
// without waiting on the 15s interval). `connectSurfaces` wires the watchdog
// through `createLiveSignal` (`@kolu/surface`), which uses THIS primitive — so the
// capture lives here, not on surface-app's `../connect` wrapper.
vi.mock("@kolu/surface/heartbeat", async (importActual) => {
  const actual = await importActual<typeof import("@kolu/surface/heartbeat")>();
  return {
    ...actual,
    createHeartbeat: (opts: { probe: () => Promise<unknown> }) => {
      mocked.heartbeatProbe = opts.probe;
      return { dispose: () => {}, wake: () => {} };
    },
  };
});

import { FakeWebSocket } from "../fakeSocket.testlib";
import { connectSurfaces } from "./connectSurfaces";

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ s: Schema.String }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

function dialRecorder() {
  const dialled: FakeWebSocket[] = [];
  return {
    dialled,
    connect: (url: string) => {
      const ws = new FakeWebSocket(url);
      dialled.push(ws);
      return ws as unknown as WebSocket;
    },
    nth: async (n: number): Promise<FakeWebSocket> => {
      await expect
        .poll(() => dialled.length, { timeout: 3_000 })
        .toBeGreaterThanOrEqual(n);
      const ws = dialled[n - 1];
      if (ws === undefined) throw new Error(`no socket #${n}`);
      return ws;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("connectSurfaces — one wire, multi-surface, heartbeat by construction", () => {
  it("folds the ONE wire's liveness into the merged surfaceClientsHealth().live", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        connect: d.connect,
      });
      // Pre-open: `connecting` → not live (NOT a constant `true` the hand-built
      // path would leave when `{ live }` was forgotten).
      expect(conn.health().live).toBe(false);
      const first = await d.nth(1);
      first.open();
      await settle();
      expect(conn.health().live).toBe(true);
      // A drop / silent half-open → not live, for EVERY sibling (AND-reduce).
      first.close(1006);
      await settle();
      expect(conn.health().live).toBe(false);
      (await d.nth(2)).open();
      await settle();
      expect(conn.health().live).toBe(true);
      await conn.dispose();
      dispose();
    });
  });

  it("wires the default-on heartbeat to probe the FIRST sibling's reserved system/live TAG", async () => {
    const d = dialRecorder();
    mocked.heartbeatProbe = undefined;
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        connect: d.connect,
      });
      // The heartbeat is default-ON: `createLiveSignal` handed `createHeartbeat`
      // a probe thunk.
      expect(typeof mocked.heartbeatProbe).toBe("function");
      const ws = await d.nth(1);
      ws.open();
      await settle();
      // Firing it puts ONE request on the wire, addressed to the first sibling's
      // scoped reserved liveness member — `surface/a/system/live`, exactly the tag
      // `implementSurfaces({ a, b })` binds. Nothing answers (the fake peer is
      // silent), so we read the FRAME rather than the result.
      // The real `createHeartbeat` always attaches handlers to the probe promise
      // (it races it against a timer); this stand-in doesn't, and `dispose()`
      // INTERRUPTS an in-flight probe — so swallow the interruption rejection
      // here rather than leave it unhandled.
      mocked.heartbeatProbe?.().catch(() => {});
      await expect
        .poll(() => ws.sent.length, { timeout: 3_000 })
        .toBeGreaterThan(0);
      const frames = ws.sent.map((f) => String(f)).join("");
      expect(frames).toContain('"tag":"surface/a/system/live"');
      expect(frames).not.toContain('"tag":"surface/b/system/live"');
      await conn.dispose();
      dispose();
    });
  });

  it("fails fast on an empty surface map — no sibling, no probe target", async () => {
    await expect(
      connectSurfaces({ surfaces: {}, url: "ws://test" }),
    ).rejects.toThrow(/no sibling/);
  });
});
