import { Effect, Layer } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { describe, expect, it, vi } from "vitest";
import {
  buildAppRouter,
  type BuildAppRouterDeps,
  CurrentViewer,
} from "../router.ts";

const ZEST: HostKey = { kind: "remote", target: "zest" };

function harness(answer: HostKey | null = null) {
  const viewerHost = vi.fn(async () => answer);
  const deps: BuildAppRouterDeps = {
    drainBoundPadi: () => Effect.void,
    addHost: async () => {},
    removeHost: async () => {},
    reconnectHost: () => {},
    renewHostDaemon: () => Effect.void,
    listStateBackups: () => ({ backups: [] }),
    restoreStateBackup: async () => ({ hostFailures: [] }),
    viewerHost,
  };
  return { viewerHost, handlers: buildAppRouter(deps).handlers };
}

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
