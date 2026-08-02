/**
 * The WIRE seam of the viewer-host question: what `hosts.viewer` reads off the
 * request and hands on.
 *
 * The pure comparison is covered in `viewerHost.test.ts`. What is covered HERE
 * is the half that test cannot see — that the handler actually reads BOTH facts
 * a proxied request carries (the direct peer AND the forwarded-for header) and
 * passes them along. The first cut of this feature read only the peer, which is
 * exactly why it never fired once behind tailscale serve: the peer belonged to
 * the proxy, and the fact that would have identified the viewer was sitting
 * unread in a header.
 *
 * A per-caller fact can only ride a per-caller call, so this drives the root RPC
 * with a context the way the HTTP and websocket entry points populate it.
 */

import { Effect, Layer } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { describe, expect, it, vi } from "vitest";
import {
  buildAppRouter,
  type BuildAppRouterDeps,
  CurrentViewer,
} from "../router.ts";

const ZEST: HostKey = { kind: "remote", target: "zest" };

/** The bound root handlers, plus a spy on the one dep this exercises. */
function harness(answer: HostKey | null = null) {
  const viewerHost = vi.fn(async () => answer);
  const deps: BuildAppRouterDeps = {
    drainBoundPadi: async () => {},
    addHost: async () => {},
    removeHost: async () => {},
    reconnectHost: () => {},
    renewHostDaemon: async () => {},
    viewerHost,
  };
  return { viewerHost, handlers: buildAppRouter(deps).handlers };
}

/** Drive the `hosts/viewer` handler with the per-connection service the transport
 *  mount provides — the Effect successor of the oRPC per-call `context`. The
 *  handler is dispatched straight off the runtime record (no link, no wire): a
 *  tag carries its own route, so there is nothing between the record and the
 *  handler for a test to stand in for. */
function callViewer(
  handlers: ReturnType<typeof harness>["handlers"],
  viewer: { viewerAddress?: string; forwardedFor?: string },
): Promise<{ host: HostKey | null }> {
  const handler = handlers["hosts/viewer"];
  if (handler === undefined) throw new Error("hosts/viewer is not bound");
  return Effect.runPromise(
    (handler(undefined) as Effect.Effect<{ host: HostKey | null }>).pipe(
      Effect.provide(
        Layer.succeed(CurrentViewer)({
          viewerAddress: viewer.viewerAddress,
          forwardedFor: viewer.forwardedFor,
        }),
      ),
    ),
  );
}

describe("hosts.viewer", () => {
  it("hands on BOTH the direct peer and the forwarded header", async () => {
    // The field defect in one assertion. Reading only `viewerAddress` is what
    // made this feature dead on the real deployment: behind tailscale serve the
    // peer is the kolu host's own address and the viewer's is in the header.
    const h = harness();
    await callViewer(h.handlers, {
      viewerAddress: "100.122.32.106",
      forwardedFor: "100.90.229.113",
    });

    expect(h.viewerHost).toHaveBeenCalledWith({
      peerAddress: "100.122.32.106",
      forwardedFor: "100.90.229.113",
    });
  });

  it("passes an absent header through as absent, never as an empty string", async () => {
    // A direct (unproxied) connection. `undefined` and `""` are different facts
    // downstream — one is "no proxy said anything", the other is a header that
    // parses to nothing — so the seam must not flatten them.
    const h = harness();
    await callViewer(h.handlers, { viewerAddress: "10.0.0.9" });

    expect(h.viewerHost).toHaveBeenCalledWith({
      peerAddress: "10.0.0.9",
      forwardedFor: undefined,
    });
  });

  it("returns the host it was given", async () => {
    const h = harness(ZEST);
    await expect(
      callViewer(h.handlers, { viewerAddress: "100.122.32.106" }),
    ).resolves.toEqual({ host: ZEST });
  });

  it("returns null when kolu cannot tell — the safe answer", async () => {
    const h = harness(null);
    await expect(callViewer(h.handlers, {})).resolves.toEqual({ host: null });
  });
});
