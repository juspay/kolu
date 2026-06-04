/**
 * `createServerLifecycle` — the transport+probe → lifecycle derivation. Covered
 * here (not in `index.test.ts`) because it pulls in `solid-js` reactive
 * primitives; the pure-kernel suite stays Solid-free. Node env is fine: this
 * uses signals + a fake transport, no DOM.
 */

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createServerLifecycle, type WsLike } from "./index";

/** A minimal transport whose `open`/`close` we fire by hand. */
function fakeWs() {
  const listeners: Record<"open" | "close", Array<() => void>> = {
    open: [],
    close: [],
  };
  const ws: WsLike = {
    addEventListener: (type, fn) => listeners[type].push(fn),
    removeEventListener: (type, fn) => {
      listeners[type] = listeners[type].filter((l) => l !== fn);
    },
  };
  return {
    ws,
    fire: (type: "open" | "close") =>
      listeners[type].slice().forEach((l) => l()),
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
