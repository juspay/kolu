/**
 * `createServerLifecycle` — the transport+probe → lifecycle derivation. Covered
 * here (not in `index.test.ts`) because it pulls in `solid-js` reactive
 * primitives; the pure-kernel suite stays Solid-free. Node env is fine: this
 * uses signals + a fake transport, no DOM.
 */

import { shouldNotRetryORPCError } from "@kolu/surface/client";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createServerLifecycle, retireSocket, type WsLike } from "./index";

/** A minimal transport whose `open`/`close` we fire by hand. `close` can carry a
 *  code so the restart-close-code path is exercisable. */
function fakeWs() {
  const listeners: Record<
    "open" | "close",
    Array<(event?: { code?: number }) => void>
  > = { open: [], close: [] };
  const ws: WsLike = {
    addEventListener: (type, fn) => listeners[type].push(fn),
    removeEventListener: (type, fn) => {
      listeners[type] = listeners[type].filter((l) => l !== fn);
    },
  };
  return {
    ws,
    fire: (type: "open" | "close", code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of listeners[type].slice()) l(event);
    },
    count: (type: "open" | "close") => listeners[type].length,
  };
}

describe("createServerLifecycle", () => {
  it("first open is connected; same id reconnects, changed id restarts", async () => {
    const t = fakeWs();
    let id = "p1";
    await createRoot(async (dispose) => {
      const { lifecycle, status } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: id }),
      });
      expect(lifecycle().kind).toBe("connecting");

      t.fire("open");
      await Promise.resolve();
      expect(lifecycle().kind).toBe("connected");
      expect(status()).toBe("live");

      t.fire("close");
      expect(lifecycle().kind).toBe("disconnected");
      expect(status()).toBe("down");

      t.fire("open");
      await Promise.resolve();
      expect(lifecycle().kind).toBe("reconnected"); // same id

      id = "p2";
      t.fire("open");
      await Promise.resolve();
      // Probe-driven restart: socket is open against the fresh process.
      expect(lifecycle()).toEqual({
        kind: "restarted",
        processId: "p2",
        transport: "open",
      });
      expect(status()).toBe("restarted");

      dispose();
    });
  });

  it("a restart close code goes straight to `restarted`, not `disconnected`", async () => {
    const t = fakeWs();
    await createRoot(async (dispose) => {
      const { lifecycle, status, serverProcessId } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        restartCloseCode: 4001,
      });

      t.fire("open");
      await Promise.resolve();
      expect(lifecycle().kind).toBe("connected");

      // An ordinary close is a transient drop.
      t.fire("close");
      expect(lifecycle().kind).toBe("disconnected");

      // The dedicated restart code is definitive — straight to `restarted`. The
      // new id isn't observable (socket closed before any probe) and the
      // last-known id is the dead process we were detached from, so the closed
      // shape carries NO `processId` and `serverProcessId()` reports `undefined`
      // rather than a stale "current" id.
      t.fire("close", 4001);
      expect(lifecycle()).toEqual({
        kind: "restarted",
        transport: "closed",
      });
      expect(serverProcessId()).toBeUndefined();
      expect(status()).toBe("restarted");

      dispose();
    });
  });

  it("fires onStaleRestart on a stale-close restart, but NOT on a probe-driven one", async () => {
    const t = fakeWs();
    let staleRestarts = 0;
    let id = "p1";
    await createRoot(async (dispose) => {
      createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: id }),
        restartCloseCode: 4001,
        onStaleRestart: () => staleRestarts++,
      });
      t.fire("open");
      await Promise.resolve();

      // A probe-driven restart (socket open against a fresh process) does NOT
      // fire it — that socket is alive, nothing to retire.
      id = "p2";
      t.fire("open");
      await Promise.resolve();
      expect(staleRestarts).toBe(0);

      // A stale-close restart fires it synchronously, at the close decode.
      t.fire("close", 4001);
      expect(staleRestarts).toBe(1);
      dispose();
    });
  });

  it("a restart close code before any identity is established is ignored", async () => {
    const t = fakeWs();
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        restartCloseCode: 4001,
      });
      // No open/probe yet → no relationship to lose; stay put.
      t.fire("close", 4001);
      expect(lifecycle().kind).toBe("connecting");
      dispose();
    });
  });

  it("a failed first probe doesn't consume the initial connect — next success is still `connected`", async () => {
    const t = fakeWs();
    const errors: unknown[] = [];
    let fail = true;
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        ws: t.ws,
        probe: () =>
          fail
            ? Promise.reject(new Error("probe down"))
            : Promise.resolve({ processId: "p1" }),
        onProbeError: (err) => errors.push(err),
      });

      // First open, probe fails: no identity established, stay put.
      t.fire("open");
      await Promise.resolve();
      await Promise.resolve();
      expect(lifecycle().kind).toBe("connecting");
      expect(errors).toHaveLength(1);

      // A close before any identity never reports a drop (no relationship lost).
      t.fire("close");
      expect(lifecycle().kind).toBe("connecting");

      // Next open, probe succeeds: this is the INITIAL connect, not a reconnect.
      fail = false;
      t.fire("open");
      await Promise.resolve();
      expect(lifecycle().kind).toBe("connected");

      dispose();
    });
  });

  it("reports a failed probe through onProbeError without transitioning", async () => {
    const t = fakeWs();
    const errors: unknown[] = [];
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.reject(new Error("boom")),
        onProbeError: (err) => errors.push(err),
      });
      t.fire("open");
      await Promise.resolve();
      await Promise.resolve();
      // Probe failed: stay in the prior state, surface the error.
      expect(lifecycle().kind).toBe("connecting");
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("boom");
      dispose();
    });
  });

  it("dispose detaches the transport listeners (no leak across remounts)", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      const lc = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
      });
      expect(t.count("open")).toBe(1);
      lc.dispose();
      expect(t.count("open")).toBe(0);
      expect(t.count("close")).toBe(0);
      dispose();
    });
  });

  it("publishes each observed processId via onProcessId (so the consumer can echo it)", async () => {
    const t = fakeWs();
    const seen: string[] = [];
    let id = "p1";
    await createRoot(async (dispose) => {
      createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: id }),
        onProcessId: (pid) => seen.push(pid),
      });
      t.fire("open");
      await Promise.resolve();
      // A restart: the hook still fires with the NEW id — and keeps firing the
      // last observed id even though `serverProcessId()` would diverge on a
      // stale close (that's why the echo reads this, not the accessor).
      id = "p2";
      t.fire("open");
      await Promise.resolve();
      expect(seen).toEqual(["p1", "p2"]);
      dispose();
    });
  });
});

describe("retireSocket", () => {
  it("closes the socket and replaces send with a throwing stub", () => {
    let closed = 0;
    const ws = {
      close: () => {
        closed++;
      },
      send: (() => {}) as unknown,
    };
    retireSocket(ws);
    expect(closed).toBe(1);
    // The replacement send THROWS — so oRPC's ClientPeer rejects a post-stale
    // request instead of awaiting a response that never arrives.
    expect(() => (ws.send as (d: string) => void)("anything")).toThrow(
      /stale tab/,
    );
  });

  it("throws a NON-retriable error so STREAM_RETRY consumers settle instead of looping", () => {
    const ws = { close: () => {}, send: (() => {}) as unknown };
    retireSocket(ws);
    let thrown: unknown;
    try {
      (ws.send as (d: string) => void)("anything");
    } catch (err) {
      thrown = err;
    }
    // The surface family's shared retry fence must classify this as non-retriable
    // (`shouldRetry` → false). A plain `Error` would pass the fence (`true`) and
    // re-subscribe forever, each retry firing the terminal stream's `onRetry` →
    // `terminal.reset()` behind the reload overlay.
    const fence = shouldNotRetryORPCError as (a: { error: unknown }) => boolean;
    expect(fence({ error: thrown })).toBe(false);
  });
});
