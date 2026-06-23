/**
 * The HostSession periodic liveness watchdog — the ssh-leg twin of the browser
 * leg's `createHeartbeat`. While `connected`, it probes the framework-reserved
 * `system.live` round-trip; a probe that TIMES OUT means the remote is silently
 * wedged (process alive, app hung — no stdio EOF, ssh keepalive ~30s away), so it
 * force-cycles the child through `recheck()`'s path. These pins:
 *   1. a wedged-but-OPEN link (transport up, never answers) is force-cycled;
 *   2. a healthy link (the agent answers `system.live`) is NOT cycled;
 *   3. `liveness: false` opts out.
 *
 * Mocks `node:child_process` + `nixCopy` (same approach as `recheck.test.ts`) so
 * no real ssh / `nix copy` runs.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { defineSurface } from "@kolu/surface/define";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { implement } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HostSession } from "./hostSession";
import { provisionAgent } from "./nixCopy";

vi.mock("./nixCopy", () => ({ provisionAgent: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

// A minimal real surface — `defineSurface` injects `system.live`, and
// `implementSurface` auto-answers it, so the healthy child below responds to the
// watchdog's probe with no hand-wiring.
const surface = defineSurface({
  cells: { v: { schema: z.object({ n: z.number() }), default: { n: 0 } } },
});
type SurfaceContract = typeof surface.contract;

/** A child serving the real surface over a loopback pair — it ANSWERS
 *  `system.live` — and stays alive until killed. */
function healthyChild() {
  const pair = createLoopbackPair();
  const { router } = implementSurface(surface, {
    channel: inMemoryChannelByName(),
    cells: { v: { store: inMemoryStore({ n: 0 }) } },
  });
  const wrapped = implement(surface.contract).router({
    ...router,
  } as never);
  void serveOverStdio({ router: wrapped as never, transport: pair.server });
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = pair.client.write;
  child.stdout = pair.client.read;
  child.stderr = new PassThrough();
  child.pid = 1234;
  const kill = vi.fn(() => {
    pair.server.write.end();
    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    return true;
  });
  child.kill = kill;
  return { child, kill };
}

/** A child whose transport is UP (stdout open, never exits) but which NEVER
 *  answers — a silently wedged remote. The probe request vanishes into a
 *  dangling stdin; no response is ever written to stdout. `kill` emits the
 *  `exit` the reconnect loop waits on. */
function wedgedChild() {
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = new PassThrough(); // requests buffer; nobody reads them
  child.stdout = new PassThrough(); // open, but nothing is ever written back
  child.stderr = new PassThrough();
  child.pid = 4321;
  const kill = vi.fn(() => {
    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    return true;
  });
  child.kill = kill;
  return { child, kill };
}

function makeSession(extra: Record<string, unknown> = {}) {
  return new HostSession<SurfaceContract>({
    host: "testhost",
    resolveDrvPath: () => Promise.resolve("/nix/store/x-agent.drv"),
    binary: "agent",
    reconnectDelayMs: 50,
    // One `liveness` knob: tune the cadence as an object (the same 15s/10s the
    // shared `DEFAULT_HEARTBEAT_*` constants default to), or `false` to disable.
    liveness: { intervalMs: 15_000, timeoutMs: 10_000 },
    ...extra,
  });
}

describe("HostSession liveness watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/x-agent",
    } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("force-cycles a silently-wedged but OPEN link (probe times out)", async () => {
    const kills: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(spawn).mockImplementation(() => {
      const { child, kill } = wedgedChild();
      kills.push(kill);
      return child as never;
    });
    const session = makeSession();
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(session.current().connection).toBe("connecting");
    // The bridge marks `connected` after the first RPC — simulate it (the watchdog
    // is born here, so it can never probe before the first connect).
    session.markConnected();
    expect(session.current().connection).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    // The watchdog probes at +15s; the wedged remote never answers.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(kills[0]).not.toHaveBeenCalled(); // probe armed, not yet timed out
    // At +10s the probe times out ⇒ the link is wedged ⇒ force-cycle.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(kills[0]).toHaveBeenCalledTimes(1);

    // …and the killed child routes through the reconnect loop → a fresh child.
    await vi.advanceTimersByTimeAsync(200);
    expect(spawn).toHaveBeenCalledTimes(2);

    session.destroy();
  });

  it("does NOT cycle a healthy link — the agent answers system.live", async () => {
    const kills: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(spawn).mockImplementation(() => {
      const { child, kill } = healthyChild();
      kills.push(kill);
      return child as never;
    });
    const session = makeSession();
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    expect(session.current().connection).toBe("connected");

    // Two full probe cycles (interval+timeout each). The agent answers every
    // probe, so the link is never force-cycled and the child never respawns.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(kills[0]).not.toHaveBeenCalled();
    expect(session.current().connection).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it("liveness: false disables the watchdog entirely", async () => {
    const kills: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(spawn).mockImplementation(() => {
      const { child, kill } = wedgedChild();
      kills.push(kill);
      return child as never;
    });
    const session = makeSession({ liveness: false });
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    // Even a wedged link is left alone when the watchdog is off.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(kills[0]).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);

    session.destroy();
  });
});
