/**
 * `createServerLifecycle` — the transport+probe → lifecycle derivation. Covered
 * here (not in `index.test.ts`) because it pulls in `solid-js` reactive
 * primitives; the pure-kernel suite stays Solid-free. Node env is fine: this
 * uses signals + a fake transport, no DOM.
 */

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createServerLifecycle, type WsLike } from "./index";

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
      expect(lifecycle().kind).toBe("restarted"); // changed id
      expect(status()).toBe("restarted");

      dispose();
    });
  });

  it("a restart close code goes straight to `restarted`, not `disconnected`", async () => {
    const t = fakeWs();
    await createRoot(async (dispose) => {
      const { lifecycle, status } = createServerLifecycle({
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

      // The dedicated restart code is definitive — straight to `restarted`,
      // carrying the last-known id (the new one isn't observable).
      t.fire("close", 4001);
      expect(lifecycle()).toEqual({ kind: "restarted", processId: "p1" });
      expect(status()).toBe("restarted");

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
});
