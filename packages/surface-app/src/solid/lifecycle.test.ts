/**
 * `createServerLifecycle` — the wire-status + probe → lifecycle derivation.
 * Covered here (not in `index.test.ts`) because it pulls in `solid-js` reactive
 * primitives; the pure-kernel suite stays Solid-free. Node env is fine: this uses
 * signals + a fake wire, no DOM.
 *
 * The transport it observes is a `WatchableWire` now, not a socket: the close
 * CODE never leaves the link (PLAN D5 / review #5), so what used to be
 * `restartCloseCode` + `onStaleRestart` + `retireSocket` is ONE status —
 * `retired` — that the lifecycle reads as a definitive restart. The retire tests
 * became the "a retired wire is a restart" case below; the mechanism they used to
 * pin (a poisoned `send` the retry fence had to recognise) is gone with oRPC.
 */

import { Effect } from "effect";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeWire } from "../fakeSocket.testlib";
import { createServerLifecycle } from "./index";

/** Let a probe EFFECT settle through the lifecycle's run edge.
 *
 *  A microtask turn is no longer enough: the probe is an `Effect`, so
 *  `createServerLifecycle` runs it on a fiber and the settle lands a scheduler
 *  tick later than a bare `Promise.resolve()` did. A macrotask covers both. */
const flushProbe = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("createServerLifecycle — default-on liveness heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("forces wire.forceReconnect() on a half-open wire — the watchdog is on by default", () => {
    const w = fakeWire("open"); // open, so the heartbeat tick probes
    createRoot((dispose) => {
      // A probe that never settles ⇒ the wire is silently half-open.
      createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.never as Effect.Effect<{ processId: string }>,
      });
      // One interval (default 15s) arms the probe; one timeout (default 10s)
      // with no answer declares it half-open and forces a reconnect.
      vi.advanceTimersByTime(15_000);
      expect(w.reconnects()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(w.reconnects()).toBe(1);
      dispose();
    });
  });

  it("`heartbeat: false` opts out — no watchdog, no reconnect", () => {
    const w = fakeWire("open");
    createRoot((dispose) => {
      createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.never as Effect.Effect<{ processId: string }>,
        heartbeat: false,
      });
      vi.advanceTimersByTime(60_000);
      expect(w.reconnects()).toBe(0);
      dispose();
    });
  });

  it("dispose() stops the heartbeat so a late probe can't reconnect", () => {
    const w = fakeWire("open");
    createRoot((dispose) => {
      createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.never as Effect.Effect<{ processId: string }>,
      });
      vi.advanceTimersByTime(15_000); // arm a probe
      dispose(); // tears down the lifecycle AND its heartbeat
      vi.advanceTimersByTime(60_000);
      expect(w.reconnects()).toBe(0);
    });
  });
});

describe("createServerLifecycle", () => {
  it("first open is connected; same id reconnects, changed id restarts", async () => {
    const w = fakeWire();
    let id = "p1";
    await createRoot(async (dispose) => {
      const { lifecycle, status } = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: id }),
      });
      expect(lifecycle().kind).toBe("connecting");

      w.set("open");
      await flushProbe();
      expect(lifecycle().kind).toBe("connected");
      expect(status()).toBe("live");

      w.set("closed");
      expect(lifecycle().kind).toBe("disconnected");
      expect(status()).toBe("down");

      w.set("open");
      await flushProbe();
      expect(lifecycle().kind).toBe("reconnected"); // same id

      id = "p2";
      w.set("closed");
      w.set("open");
      await flushProbe();
      // Probe-driven restart: the wire is open against the fresh process.
      expect(lifecycle()).toEqual({
        kind: "restarted",
        processId: "p2",
        transport: "open",
      });
      expect(status()).toBe("restarted");

      dispose();
    });
  });

  it("probes a wire that was ALREADY open when the lifecycle was derived", async () => {
    // The status stream only reports CHANGES, and the link's dial runs on its own
    // fiber — so a caller that awaited `createSurfaceSocket` may well hold an
    // already-open wire. Without the construction-time read, that connection
    // would sit in `connecting` forever with no probe ever issued.
    const w = fakeWire("open");
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: "p1" }),
        heartbeat: false,
      });
      await flushProbe();
      expect(lifecycle()).toEqual({ kind: "connected", processId: "p1" });
      dispose();
    });
  });

  it("a RETIRED wire goes straight to `restarted`, not `disconnected`", async () => {
    const w = fakeWire();
    await createRoot(async (dispose) => {
      const { lifecycle, status, serverProcessId } = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: "p1" }),
      });

      w.set("open");
      await flushProbe();
      expect(lifecycle().kind).toBe("connected");

      // An ordinary close is a transient drop.
      w.set("closed");
      expect(lifecycle().kind).toBe("disconnected");

      // The link's terminal-close classifier retired the wire (the server
      // rejected this stale tab): definitive restart. The new id isn't
      // observable (the wire closed before any probe) and the last-known id is
      // the dead process we were detached from, so the closed shape carries NO
      // `processId` and `serverProcessId()` reports `undefined` rather than a
      // stale "current" id.
      w.set("retired");
      expect(lifecycle()).toEqual({
        kind: "restarted",
        transport: "closed",
      });
      expect(serverProcessId()).toBeUndefined();
      expect(status()).toBe("restarted");

      dispose();
    });
  });

  it("a retirement before any identity is established is ignored", async () => {
    const w = fakeWire();
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: "p1" }),
      });
      // No open/probe yet → no relationship to lose; stay put.
      w.set("retired");
      expect(lifecycle().kind).toBe("connecting");
      dispose();
    });
  });

  it("a failed first probe doesn't consume the initial connect — next success is still `connected`", async () => {
    const w = fakeWire();
    const errors: unknown[] = [];
    let fail = true;
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        wire: w.wire,
        probe: () =>
          fail
            ? Effect.fail(new Error("probe down"))
            : Effect.succeed({ processId: "p1" }),
        onProbeError: (err) => errors.push(err),
      });

      // First open, probe fails: no identity established, stay put.
      w.set("open");
      await flushProbe();
      expect(lifecycle().kind).toBe("connecting");
      expect(errors).toHaveLength(1);

      // A close before any identity never reports a drop (no relationship lost).
      w.set("closed");
      expect(lifecycle().kind).toBe("connecting");

      // Next open, probe succeeds: this is the INITIAL connect, not a reconnect.
      fail = false;
      w.set("open");
      await flushProbe();
      expect(lifecycle().kind).toBe("connected");

      dispose();
    });
  });

  it("reports a failed probe through onProbeError without transitioning", async () => {
    const w = fakeWire();
    const errors: unknown[] = [];
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.fail(new Error("boom")),
        onProbeError: (err) => errors.push(err),
      });
      w.set("open");
      await flushProbe();
      // Probe failed: stay in the prior state, surface the error.
      expect(lifecycle().kind).toBe("connecting");
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("boom");
      dispose();
    });
  });

  it("dispose detaches the wire subscription (no leak across remounts)", () => {
    const w = fakeWire();
    createRoot((dispose) => {
      const lc = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: "p1" }),
      });
      expect(w.watchers()).toBe(1);
      lc.dispose();
      expect(w.watchers()).toBe(0);
      dispose();
    });
  });

  it("publishes each observed processId via onProcessId (so the consumer can echo it)", async () => {
    const w = fakeWire();
    const seen: string[] = [];
    let id = "p1";
    await createRoot(async (dispose) => {
      createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: id }),
        onProcessId: (pid) => seen.push(pid),
      });
      w.set("open");
      await flushProbe();
      // A restart: the hook still fires with the NEW id — and keeps firing the
      // last observed id even though `serverProcessId()` would diverge on a
      // retirement (that's why the echo reads this, not the accessor).
      id = "p2";
      w.set("closed");
      w.set("open");
      await flushProbe();
      expect(seen).toEqual(["p1", "p2"]);
      dispose();
    });
  });

  it("a throwing onProcessId does not poison the lifecycle transition", async () => {
    const w = fakeWire();
    const errors: unknown[] = [];
    await createRoot(async (dispose) => {
      const { lifecycle } = createServerLifecycle({
        wire: w.wire,
        probe: () => Effect.succeed({ processId: "p1" }),
        // An observer that throws must not convert a successful probe into a
        // probe failure: the transition is already committed before it runs, and
        // the throw is reported via onProbeError instead of unwinding it.
        onProcessId: () => {
          throw new Error("observer blew up");
        },
        onProbeError: (err) => errors.push(err),
      });
      w.set("open");
      await flushProbe();
      // Lifecycle still reached `connected`; the throw surfaced separately.
      expect(lifecycle()).toEqual({ kind: "connected", processId: "p1" });
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("observer blew up");
      dispose();
    });
  });
});
