/**
 * `SurfaceAppProvider` — the model it hands to `useSurfaceApp()`. Covered here
 * (not in `index.test.ts`) because it pulls in `solid-js` reactive primitives;
 * the pure-kernel suite stays Solid-free. Node env is fine: the provider is
 * built with `createComponent` (no JSX) and driven through the `{ status }`
 * connection source, so there's no DOM, transport, or probe to fake.
 *
 * The focus is `updateReady` — the skew-OR-restart predicate the model owns so
 * consumers read it instead of re-deriving `status() === "restarted" || stale()`.
 */

import {
  type Accessor,
  createComponent,
  createRoot,
  createSignal,
} from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
  type ConnectionStatus,
  type ControlPlane,
  type SurfaceAppModel,
  SurfaceAppProvider,
  useSurfaceApp,
  type WsLike,
} from "./index";

/** A minimal transport whose `open`/`close` we fire by hand, with an optional
 *  close code — the turnkey `{ ws, probe }` path's analogue of `lifecycle.test`'s
 *  `fakeWs`. */
function fakeWs() {
  const listeners: Record<
    "open" | "close",
    Array<(event?: { code?: number }) => void>
  > = { open: [], close: [] };
  let closed = 0;
  let reconnects = 0;
  // The turnkey `{ ws, probe }` source owns teardown AND liveness, so its `ws` is
  // `WsLike & { close, send, reconnect, readyState, OPEN }` — the fake carries all
  // of them so it satisfies the type and the auto-retire / heartbeat-reconnect are
  // observable. `readyState` starts OPEN (1) so the heartbeat actually probes.
  const ws: WsLike & {
    close(): void;
    send: unknown;
    reconnect(): void;
    readyState: number;
    readonly OPEN: number;
  } = {
    addEventListener: (type, fn) => listeners[type].push(fn),
    close: () => {
      closed++;
    },
    send: (() => {}) as unknown,
    reconnect: () => {
      reconnects++;
    },
    readyState: 1,
    OPEN: 1,
  };
  return {
    ws,
    closedCount: () => closed,
    reconnectCount: () => reconnects,
    sendThrows: () => {
      try {
        (ws.send as (d: string) => void)("x");
        return false;
      } catch {
        return true;
      }
    },
    fire: (type: "open" | "close", code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of listeners[type].slice()) l(event);
    },
  };
}

/** A `controlPlane` whose `buildInfo` cell yields a fixed server commit. */
function fakeControlPlane(serverCommit: string): ControlPlane {
  return {
    cells: {
      buildInfo: {
        use: () => ({ value: () => ({ commit: serverCommit }) }),
      },
    },
  };
}

/** Mount the provider with a caller-supplied `status` accessor and capture the
 *  model a child reads back out of context. */
function mountModel(opts: {
  serverCommit: string;
  clientCommit: string;
  status: Accessor<ConnectionStatus>;
  dispose: () => void;
}): SurfaceAppModel {
  let captured!: SurfaceAppModel;
  createComponent(SurfaceAppProvider, {
    controlPlane: fakeControlPlane(opts.serverCommit),
    clientCommit: opts.clientCommit,
    status: opts.status,
    get children() {
      captured = useSurfaceApp();
      return null;
    },
  });
  return captured;
}

describe("SurfaceAppProvider — updateReady", () => {
  it("flips on a `restarted` status (deploy caught live), even when not stale", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal<ConnectionStatus>("live");
      // Same commit on both sides → never stale; only the status drives it.
      const model = mountModel({
        serverCommit: "0784979",
        clientCommit: "0784979",
        status,
        dispose,
      });

      expect(model.stale()).toBe(false);
      expect(model.updateReady()).toBe(false);

      setStatus("restarted");
      expect(model.updateReady()).toBe(true);

      dispose();
    });
  });

  it("forwards `restartCloseCode` through the turnkey `{ ws, probe }` source", async () => {
    const t = fakeWs();
    await createRoot(async (dispose) => {
      let captured!: SurfaceAppModel;
      createComponent(SurfaceAppProvider, {
        controlPlane: fakeControlPlane("0784979"),
        clientCommit: "0784979",
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        restartCloseCode: 4001,
        get children() {
          captured = useSurfaceApp();
          return null;
        },
      });

      t.fire("open");
      await Promise.resolve();
      expect(captured.status()).toBe("live");

      // The dedicated restart code reaches `createServerLifecycle` and surfaces
      // as `restarted` — the turnkey path now matches the manual one.
      t.fire("close", 4001);
      expect(captured.status()).toBe("restarted");
      expect(captured.updateReady()).toBe(true);
      // …and the turnkey source OWNS the socket, so it retires it on the
      // stale-restart: closed once, and further sends throw (so oRPC rejects
      // rather than the offline buffer growing). A `{ status }` consumer would
      // wire this itself; the turnkey path gets it free. Fired synchronously from
      // the lifecycle's close decode (`onStaleRestart`), so no tick needed.
      expect(t.closedCount()).toBe(1);
      expect(t.sendThrows()).toBe(true);

      dispose();
    });
  });

  it("forwards `onProcessId` through the turnkey `{ ws, probe }` source", async () => {
    const t = fakeWs();
    const seen: string[] = [];
    await createRoot(async (dispose) => {
      createComponent(SurfaceAppProvider, {
        controlPlane: fakeControlPlane("0784979"),
        clientCommit: "0784979",
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        onProcessId: (id: string) => seen.push(id),
        get children() {
          useSurfaceApp();
          return null;
        },
      });
      t.fire("open");
      await Promise.resolve();
      // The provider derives the lifecycle internally, but still publishes the
      // observed id outward so the turnkey caller can echo the `pid` param.
      expect(seen).toEqual(["p1"]);
      dispose();
    });
  });

  it("starts a heartbeat in the turnkey source — a half-open socket forces a reconnect", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeWs();
      await createRoot(async (dispose) => {
        // The open probe resolves (lifecycle goes live); the NEXT probe — the
        // heartbeat's — hangs, modelling a silently half-open socket.
        let calls = 0;
        const probe = () => {
          calls += 1;
          return calls === 1
            ? Promise.resolve({ processId: "p1" })
            : new Promise<{ processId: string }>(() => {});
        };
        createComponent(SurfaceAppProvider, {
          controlPlane: fakeControlPlane("0784979"),
          clientCommit: "0784979",
          ws: t.ws,
          probe,
          get children() {
            useSurfaceApp();
            return null;
          },
        });
        t.fire("open");
        await vi.advanceTimersByTimeAsync(0); // flush the open probe
        expect(t.reconnectCount()).toBe(0);
        // One heartbeat interval (default 15s) fires a probe that never answers;
        // after the default 10s timeout the watchdog forces a reconnect — the
        // turnkey consumer (drishti's admin socket) gets this with zero wiring.
        await vi.advanceTimersByTimeAsync(15_000 + 10_000);
        expect(t.reconnectCount()).toBe(1);
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flips on staleness (cached old bundle) while the link is otherwise live", () => {
    createRoot((dispose) => {
      // Two clean refs that disagree → stale, even though status stays `live`.
      const model = mountModel({
        serverCommit: "0784979",
        clientCommit: "abc1234",
        status: () => "live",
        dispose,
      });

      expect(model.status()).toBe("live");
      expect(model.stale()).toBe(true);
      expect(model.updateReady()).toBe(true);

      dispose();
    });
  });
});
