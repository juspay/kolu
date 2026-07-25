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

import { createRouterClient } from "@orpc/server";
import type { HostKey } from "kolu-common/hostKey";
import { describe, expect, it, vi } from "vitest";
import { buildAppRouter, type BuildAppRouterDeps } from "../router.ts";

const ZEST: HostKey = { kind: "remote", target: "zest" };

/** The router under test, plus a spy on the one dep this exercises. */
function harness(answer: HostKey | null = null) {
  const viewerHost = vi.fn(async () => answer);
  const deps: BuildAppRouterDeps = {
    surfaceRouter: { surface: {} },
    drainBoundPadi: async () => {},
    addHost: async () => {},
    removeHost: async () => {},
    reconnectHost: () => {},
    renewHostDaemon: async () => {},
    viewerHost,
  };
  const router = buildAppRouter(deps);
  return { viewerHost, router };
}

/** Call `hosts.viewer` with the context an entry point would have built. */
function callViewer(
  router: ReturnType<typeof harness>["router"],
  context: { viewerAddress?: string; forwardedFor?: string },
) {
  const client = createRouterClient(
    router as Parameters<typeof createRouterClient>[0],
    { context },
    // biome-ignore lint/suspicious/noExplicitAny: the test walks the assembled router structurally (hosts.viewer).
  ) as any;
  return client.hosts.viewer() as Promise<{ host: HostKey | null }>;
}

describe("hosts.viewer", () => {
  it("hands on BOTH the direct peer and the forwarded header", async () => {
    // The field defect in one assertion. Reading only `viewerAddress` is what
    // made this feature dead on the real deployment: behind tailscale serve the
    // peer is the kolu host's own address and the viewer's is in the header.
    const h = harness();
    await callViewer(h.router, {
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
    await callViewer(h.router, { viewerAddress: "10.0.0.9" });

    expect(h.viewerHost).toHaveBeenCalledWith({
      peerAddress: "10.0.0.9",
      forwardedFor: undefined,
    });
  });

  it("returns the host it was given", async () => {
    const h = harness(ZEST);
    await expect(
      callViewer(h.router, { viewerAddress: "100.122.32.106" }),
    ).resolves.toEqual({ host: ZEST });
  });

  it("returns null when kolu cannot tell — the safe answer", async () => {
    const h = harness(null);
    await expect(callViewer(h.router, {})).resolves.toEqual({ host: null });
  });
});
