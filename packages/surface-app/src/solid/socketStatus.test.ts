/**
 * `createSocketStatus` — the transport-status derivation for a reconnecting
 * socket with no identity probe (the `connectSurface` shape). Pins: it starts
 * `connecting`, goes `live` on open, `reconnecting` on a transient close, and
 * `down` ONLY on a stale-close the socket was retired on.
 */

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import { createSocketStatus } from "./socketStatus";

/** A socket reduced to the open/close listeners `createSocketStatus` reads, fired
 *  by hand. */
function fakeWs() {
  const listeners: Record<
    "open" | "close",
    Array<(event?: { code?: number }) => void>
  > = { open: [], close: [] };
  const ws = {
    addEventListener: (
      type: "open" | "close",
      fn: (event?: { code?: number }) => void,
    ) => listeners[type].push(fn),
  };
  return {
    ws,
    fire: (type: "open" | "close", code?: number) => {
      const event = code === undefined ? undefined : { code };
      for (const l of listeners[type].slice()) l(event);
    },
  };
}

describe("createSocketStatus", () => {
  it("connecting → live on open → reconnecting on a transient close → live again", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      const status = createSocketStatus(t.ws);
      expect(status()).toBe("connecting");
      t.fire("open");
      expect(status()).toBe("live");
      t.fire("close", 1006); // abnormal closure — a transient drop
      expect(status()).toBe("reconnecting");
      t.fire("open"); // partysocket reconnected
      expect(status()).toBe("live");
      dispose();
    });
  });

  it("goes `down` on a stale-close the socket was RETIRED on (won't reconnect)", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      const status = createSocketStatus(t.ws, {
        retireOnStaleClose: true,
        restartCloseCode: STALE_PROCESS_CLOSE_CODE,
      });
      t.fire("open");
      t.fire("close", STALE_PROCESS_CLOSE_CODE);
      expect(status()).toBe("down");
      dispose();
    });
  });

  it("a stale-close WITHOUT retireOnStaleClose is a transient reconnect, not `down`", () => {
    const t = fakeWs();
    createRoot((dispose) => {
      // No `retireOnStaleClose` ⇒ partysocket reconnects through the 4001 too.
      const status = createSocketStatus(t.ws, {
        restartCloseCode: STALE_PROCESS_CLOSE_CODE,
      });
      t.fire("open");
      t.fire("close", STALE_PROCESS_CLOSE_CODE);
      expect(status()).toBe("reconnecting");
      dispose();
    });
  });
});
