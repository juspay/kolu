/**
 * `createServerLifecycle` — the transport+probe → lifecycle derivation. Covered
 * here (not in `index.test.ts`) because it pulls in `solid-js` reactive
 * primitives; the pure-kernel suite stays Solid-free. Node env is fine: this
 * uses signals + a fake transport, no DOM.
 */

import { shouldNotRetryORPCError } from "@kolu/surface/client";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createServerLifecycle,
  DISCONNECT_OVERLAY_GRACE_MS,
  retireSocket,
  type WsLike,
} from "./index";

/** A minimal transport whose `open`/`close` we fire by hand. `close` can carry a
 *  code so the restart-close-code path is exercisable. `readyState` defaults to
 *  NON-`OPEN` so the now-default-on liveness heartbeat's tick early-returns and
 *  never probes — the lifecycle-derivation cases test that in isolation (the
 *  heartbeat has its own cases below, which pass `readyState: 1`). `reconnect` is
 *  a spy so those cases can assert the half-open watchdog fired. */
function fakeWs(readyState = 0) {
  const listeners: Record<
    "open" | "close",
    Array<(event?: { code?: number }) => void>
  > = { open: [], close: [] };
  const reconnect = vi.fn();
  const ws: WsLike & {
    reconnect(): void;
    readyState: number;
    readonly OPEN: number;
  } = {
    addEventListener: (type, fn) => listeners[type].push(fn),
    removeEventListener: (type, fn) => {
      listeners[type] = listeners[type].filter((l) => l !== fn);
    },
    reconnect,
    readyState,
    OPEN: 1,
  };
  return {
    ws,
    reconnect,
    fire: (type: "open" | "close", code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of listeners[type].slice()) l(event);
    },
    count: (type: "open" | "close") => listeners[type].length,
  };
}

describe("createServerLifecycle — default-on liveness heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("forces ws.reconnect() on a half-open socket — the watchdog is on by default", () => {
    const t = fakeWs(1); // OPEN, so the heartbeat tick probes
    createRoot((dispose) => {
      // A probe that never settles ⇒ the socket is silently half-open.
      createServerLifecycle({
        ws: t.ws,
        probe: () => new Promise<{ processId: string }>(() => {}),
      });
      // One interval (default 15s) arms the probe; one timeout (default 10s)
      // with no answer declares it half-open and forces a reconnect.
      vi.advanceTimersByTime(15_000);
      expect(t.reconnect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(t.reconnect).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it("`heartbeat: false` opts out — no watchdog, no reconnect", () => {
    const t = fakeWs(1);
    createRoot((dispose) => {
      createServerLifecycle({
        ws: t.ws,
        probe: () => new Promise<{ processId: string }>(() => {}),
        heartbeat: false,
      });
      vi.advanceTimersByTime(60_000);
      expect(t.reconnect).not.toHaveBeenCalled();
      dispose();
    });
  });

  it("dispose() stops the heartbeat so a late probe can't reconnect", () => {
    const t = fakeWs(1);
    createRoot((dispose) => {
      createServerLifecycle({
        ws: t.ws,
        probe: () => new Promise<{ processId: string }>(() => {}),
      });
      vi.advanceTimersByTime(15_000); // arm a probe
      dispose(); // tears down the lifecycle AND its heartbeat
      vi.advanceTimersByTime(60_000);
      expect(t.reconnect).not.toHaveBeenCalled();
    });
  });
});

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

  it("a throwing onProcessId does not poison the lifecycle transition", async () => {
    const t = fakeWs();
    const errors: unknown[] = [];
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        // An observer that throws must not convert a successful probe into a
        // probe failure: the transition is already committed before it runs, and
        // the throw is reported via onProbeError instead of unwinding it.
        onProcessId: () => {
          throw new Error("observer blew up");
        },
        onProbeError: (err) => errors.push(err),
      });
      t.fire("open");
      await Promise.resolve();
      // Lifecycle still reached `connected`; the throw surfaced separately.
      expect(lifecycle()).toEqual({ kind: "connected", processId: "p1" });
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("observer blew up");
      dispose();
    });
  });
});

describe("createServerLifecycle — presentingDown overlay grace window", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a sub-second down→live cycle never trips presentingDown — a forced reconnect doesn't flash the overlay", async () => {
    const t = fakeWs();
    await createRoot(async (dispose) => {
      const { status, presentingDown } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        heartbeat: false, // isolate the lifecycle; the watchdog has its own cases
      });
      t.fire("open");
      await Promise.resolve();
      expect(status()).toBe("live");
      expect(presentingDown()).toBe(false);

      // Drop: `status()` flips to `down` INSTANTLY, but the overlay predicate waits.
      t.fire("close");
      expect(status()).toBe("down");
      expect(presentingDown()).toBe(false);

      // Reconnect well within the grace window — the overlay never armed.
      vi.advanceTimersByTime(300);
      t.fire("open");
      await Promise.resolve();
      expect(status()).toBe("live");
      expect(presentingDown()).toBe(false);

      // The cancelled show-timer can't fire even after the window fully elapses.
      vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS * 5);
      expect(presentingDown()).toBe(false);
      dispose();
    });
  });

  it("a sustained down DOES trip presentingDown once the grace window elapses, and recovery hides it instantly", async () => {
    const t = fakeWs();
    await createRoot(async (dispose) => {
      const { status, presentingDown } = createServerLifecycle({
        ws: t.ws,
        probe: () => Promise.resolve({ processId: "p1" }),
        heartbeat: false,
      });
      t.fire("open");
      await Promise.resolve();
      t.fire("close");
      expect(status()).toBe("down");
      // Just before the window closes: still held back.
      vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS - 1);
      expect(presentingDown()).toBe(false);
      // Past it: a genuine sustained outage surfaces.
      vi.advanceTimersByTime(1);
      expect(presentingDown()).toBe(true);
      // Recovery hides it instantly (no second grace window on the way back).
      t.fire("open");
      await Promise.resolve();
      expect(presentingDown()).toBe(false);
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
