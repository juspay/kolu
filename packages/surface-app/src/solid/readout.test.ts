/**
 * The readout, through the REAL seam: `connectSurface`'s own socket, link,
 * watchdog and client — only the WebSocket is faked (via the link's `connect`
 * seam, no module mocking).
 *
 * `readout` replaced a transport-only `status`, and these are the four claims
 * that replacement is worth making:
 *   - an OPEN socket over an ERRORING enrolled subscription reads `degraded`,
 *     NAMING the member — the state the transport cannot see, and the one whose
 *     absence let a dead collection render as an empty one under a green light;
 *   - it heals: the sub's self-clearing `error()` clears, and the readout is
 *     green again with nothing latched;
 *   - PENDING does not degrade — an enrolled sub still waiting for its first
 *     frame over a live socket is what every page load looks like;
 *   - a retired wire still reads `retired`, and carries `needsReload`.
 */

import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import { connectSurface } from "./connectSurface";
import { dialRecorder } from "./dialRecorder.testlib";

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ s: Schema.String }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

/** The readout is derived through Solid signals the WIRE's status callback sets,
 *  so give the reactive graph a turn after driving the socket. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("connectSurface().readout", () => {
  it("reads degraded — naming the member — while the socket is open under a stopped subscription", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurface({
        surface,
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      // Cold start: the first dial has not answered. Not an alarm, and not
      // degraded — nothing has had a chance to arrive yet.
      expect(conn.readout()).toEqual({
        status: "connecting",
        needsReload: false,
      });

      const ws = await d.nth(1);
      ws.open();
      await settle();
      expect(conn.readout().status).toBe("live");

      // A subscription that owns its own pending/error, joined to the fact the
      // framework birth sites enrol into automatically. PENDING first: this is
      // every page load, and the readout must stay green through it.
      const [pending, setPending] = createSignal(true);
      const [error, setError] = createSignal<Error | undefined>(undefined);
      conn.client.enroll("documents.keys", { pending, error });
      expect(conn.readout().status).toBe("live");

      // Now it STOPS — the socket is still open and answering, which is exactly
      // the shape of lie a transport-only `status` had no way to report.
      setPending(false);
      setError(new Error("Internal server error"));
      const degraded = conn.readout();
      expect(degraded.status).toBe("degraded");
      expect(degraded.stopped).toEqual(["documents.keys"]);
      // Degraded heals on its own (the fence re-subscribes) — a reload is not the
      // recovery on offer here.
      expect(degraded.needsReload).toBe(false);

      // The stream re-delivers: the sub's error() self-clears, and so does the
      // readout. Nothing latches at this altitude that does not latch beneath.
      setError(undefined);
      expect(conn.readout()).toEqual({ status: "live", needsReload: false });

      await conn.dispose();
      dispose();
    });
  });

  it("still reports the wire when the wire is the news — a drop, then a retirement", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurface({
        surface,
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const first = await d.nth(1);
      first.open();
      await settle();
      const [error, setError] = createSignal<Error | undefined>(undefined);
      conn.client.enroll("documents.keys", {
        pending: () => false,
        error,
      });
      expect(conn.readout().status).toBe("live");

      // A transient drop. The sub fails with it — but that failure is a
      // CONSEQUENCE of the socket going away, not separate news, so the readout
      // reports the wire and names nothing.
      first.close(1006);
      setError(new Error("transport closed"));
      await settle();
      expect(conn.readout()).toEqual({
        status: "reconnecting",
        needsReload: false,
      });

      // The link's own re-dial heals it (the sub's error clears with its next
      // frame, as the fence re-subscribes).
      (await d.nth(2)).open();
      setError(undefined);
      await settle();
      expect(conn.readout().status).toBe("live");

      // The server retires this tab: bound to a process that is gone, the link
      // will never dial again. Terminal, and the ONE state whose recovery is a
      // reload — which the readout carries rather than leaving an app to
      // re-derive which states are terminal.
      (await d.nth(2)).close(STALE_PROCESS_CLOSE_CODE);
      await settle();
      expect(conn.readout()).toEqual({ status: "retired", needsReload: true });

      await conn.dispose();
      dispose();
    });
  });
});
