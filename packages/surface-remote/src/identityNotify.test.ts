/**
 * F1 regression — the reserved `system.identity` lands ASYNCHRONOUSLY (a separate
 * RPC fired from `markConnected`, decoupled from the `connected` frame), so
 * `makeSession` must PUBLISH a state frame when the probe resolves. Otherwise a
 * consumer that derives PUBLISHED state from `identity()` inside `onState`
 * (kolu-server's padi uptime / surface version / build commit, read in
 * `padiSession.onState`) samples the pre-probe `disconnected` identity on the
 * `connected` frame and never resamples the landed value — a stale readout until
 * some unrelated transition. The pre-S9 binding set identity synchronously ON the
 * `connected` frame, so its `onState` listeners saw it immediately; this pins the
 * parity across the async-probe boundary.
 *
 * Mocks `node:child_process` + `nixCopy` (same approach as `liveness.test.ts`) so
 * no real ssh / `nix copy` runs; the child serves the real surface over a loopback
 * pair, so `implementSurface` auto-answers `system.identity` (as `anonymous` — no
 * build declared) with no hand-wiring.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { defineSurface } from "@kolu/surface/define";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { directAgentDerivation, provisionAgent } from "./nixCopy";
import { makeSession } from "./session";
import { type AgentClient, type SshProv, sshConnector } from "./sshConnector";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const surface = defineSurface({
  cells: { v: { schema: z.object({ n: z.number() }), default: { n: 0 } } },
});
type SurfaceContract = typeof surface.contract;

/** A child serving the real surface over a loopback pair — it answers the reserved
 *  `system.identity` (auto-served `anonymous`) — and stays alive until killed. */
function healthyChild() {
  const pair = createLoopbackPair();
  const { router } = implementSurface(surface, {
    cells: { v: { store: inMemoryStore({ n: 0 }) } },
  });
  void serveOverStdio({ router: router as never, transport: pair.server });
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = pair.client.write;
  child.stdout = pair.client.read;
  child.stderr = new PassThrough();
  child.pid = 1234;
  child.kill = vi.fn(() => {
    pair.server.write.end();
    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    return true;
  });
  return child;
}

describe("makeSession identity republish (F1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/x-agent",
    } as never);
    vi.mocked(spawn).mockImplementation(() => healthyChild() as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("publishes a state frame when the async system.identity probe lands, so onState consumers resample", async () => {
    const session = makeSession<AgentClient<SurfaceContract>, SshProv>({
      initialConnection: "probing",
      connectOnce: sshConnector<SurfaceContract>({
        host: "testhost",
        binary: "agent",
        localEnv: {},
        resolveDrvPath: () =>
          Promise.resolve(directAgentDerivation("/nix/store/x-agent.drv")),
      }),
      reconnectDelayMs: 50,
      liveness: false,
      label: "testhost",
    });

    // Sample `identity()` on EVERY onState frame — exactly how a consumer
    // (`padiSession.onState` → `padiStartedAt()` etc.) derives its published readout.
    const sampled: string[] = [];
    session.onState(() => sampled.push(session.identity().kind));

    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    // The bridge marks connected after the first RPC — simulate it.
    session.markConnected();
    // On the `connected` frame the async probe hasn't resolved yet → `disconnected`.
    // (`updateState({connected})` is scheduled BEFORE the `p.then(pollIdentity)`
    // microtask, so the connected frame is always delivered with the pre-probe id.)
    expect(session.identity().kind).toBe("disconnected");

    // Let the reserved `system.identity` round-trip resolve.
    await vi.advanceTimersByTimeAsync(50);

    // identity() now reads the landed value…
    expect(session.identity().kind).toBe("anonymous");
    // …AND a fresh onState frame fired carrying it (the F1 fix). Without the
    // republish, the last delivered frame is the `connected` one — sampled with the
    // pre-probe `disconnected` identity — and `anonymous` never appears.
    expect(sampled).toContain("anonymous");
    expect(sampled.at(-1)).toBe("anonymous");

    session.destroy();
  });
});
