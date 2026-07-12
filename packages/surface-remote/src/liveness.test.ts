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
import { provisionAgent } from "./nixCopy";
import {
  type ClosedInfo,
  type Connector,
  makeSession,
  type SessionState,
} from "./session";
import { type AgentClient, type SshProv, sshConnector } from "./sshConnector";

vi.mock("./nixCopy", () => ({ provisionAgent: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

// A minimal real surface — `defineSurface` injects `system.live`, and
// `implementSurface` auto-answers it, so the healthy child below responds to the
// watchdog's probe with no hand-wiring.
const surface = defineSurface({
  cells: { v: { schema: z.object({ n: z.number() }), default: { n: 0 } } },
});
type SurfaceContract = typeof surface.contract;

/** Synchronous `SessionState` snapshot — the `.current()` the Session role
 *  dropped. `onState` delivers the live value synchronously on subscribe, so a
 *  fresh subscribe/unsubscribe reads the current state without waiting on async
 *  delta delivery. */
function snap(session: {
  onState(cb: (s: SessionState<SshProv>) => void): () => void;
}): SessionState<SshProv> {
  let s!: SessionState<SshProv>;
  session.onState((state) => {
    s = state;
  })();
  return s;
}

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

function buildSession(extra: Record<string, unknown> = {}) {
  return makeSession<AgentClient<SurfaceContract>, SshProv>({
    initialConnection: "probing",
    connectOnce: sshConnector<SurfaceContract>({
      host: "testhost",
      binary: "agent",
      resolveDrvPath: () => Promise.resolve("/nix/store/x-agent.drv"),
    }),
    reconnectDelayMs: 50,
    // One `liveness` knob: tune the cadence as an object (the same 15s/10s the
    // shared `DEFAULT_HEARTBEAT_*` constants default to), or `false` to disable.
    liveness: { intervalMs: 15_000, timeoutMs: 10_000 },
    label: "testhost",
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
    const session = buildSession();
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(snap(session).phase).toBe("connecting");
    // The bridge marks `connected` after the first RPC — simulate it (the watchdog
    // is born here, so it can never probe before the first connect).
    session.markConnected();
    expect(snap(session).phase).toBe("connected");
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
    const session = buildSession();
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    expect(snap(session).phase).toBe("connected");

    // Two full probe cycles (interval+timeout each). The agent answers every
    // probe, so the link is never force-cycled and the child never respawns.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(kills[0]).not.toHaveBeenCalled();
    expect(snap(session).phase).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it("markConnected is idempotent — a second call (a consumer that marks on the hello AND on the first folded frame) is a no-op", async () => {
    // W3.1's remote padi arm marks connected on the successful control-core hello (to
    // reset the give-up budget so a deliberate drain-exit isn't counted as a connect
    // failure), and reServeSurface ALSO marks on the first folded frame — so
    // markConnected fires from two sites per spawn. Pin that the second call is a
    // no-op: exactly ONE `connected` transition (so the consecutiveFailures reset +
    // the liveness-watchdog birth happen once, never twice).
    vi.mocked(spawn).mockImplementation(() => healthyChild().child as never);
    const session = buildSession();
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(snap(session).phase).toBe("connecting");

    // Count genuine connecting→connected TRANSITIONS (a non-connected prior flipping
    // to connected), not raw connected frames: the async `system.identity` probe lands
    // AFTER the first markConnected and republishes the state (a connected→connected
    // frame, no transition) to wake onState consumers, so a raw connected-frame count
    // would over-count that republish and mask the idempotence this test pins.
    let connectedTransitions = 0;
    let prevConnection: string | null = null;
    const unsub = session.onState((s) => {
      if (s.phase === "connected" && prevConnection !== "connected")
        connectedTransitions++;
      prevConnection = s.phase;
    });

    session.markConnected(); // site 1 — the hello path: connecting → connected
    await vi.advanceTimersByTimeAsync(0); // flush the state-cell delivery
    expect(snap(session).phase).toBe("connected");
    session.markConnected(); // site 2 — the first-frame call: guard makes it a no-op
    await vi.advanceTimersByTimeAsync(0);
    expect(snap(session).phase).toBe("connected");

    expect(connectedTransitions).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);

    unsub();
    session.destroy();
  });

  it("liveness: false disables the watchdog entirely", async () => {
    const kills: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(spawn).mockImplementation(() => {
      const { child, kill } = wedgedChild();
      kills.push(kill);
      return child as never;
    });
    const session = buildSession({ liveness: false });
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

// ── The LOCAL arm — same-box process oracle (#1776) ──────────────────────────
//
// The local (stdio/endpoint) arm supplies a `processAlive` oracle the ssh arm above
// cannot: on a heartbeat timeout the watchdog consults the same-box process table
// instead of assuming death. A minimal stub connector whose liveness probe NEVER
// answers (the heartbeat-silent link) + a controllable `processAlive` drives the three
// arcs the #1776 ruling demands. (The ssh `describe` above already pins the fourth arc:
// NO oracle → force-cycle on the first timeout — the remote arm is provably untouched.)
//
// Each test below (like the ssh ones above) `pin()`s and swallows the rejection with
// `.catch(() => {})`: `pin()` resolves with the first client or rejects if the stub's
// first dial path throws — irrelevant here, since every assertion drives the watchdog
// through `vi.advanceTimersByTimeAsync` and reads state via `onState`, never through the
// `pin()` promise. Swallowing keeps an unhandled-rejection warning off the fake-timer run.

type LocalClient = Record<string, never>;

/** A LOCAL-arm connector stub: the transport comes up, but its liveness probe never
 *  answers (the wedge). `processAlive` is the same-box oracle under test; `connects` and
 *  `teardowns` observe (re)dials and force-cycles. */
function localArm(processAlive: () => boolean) {
  let connects = 0;
  let teardowns = 0;
  let isAliveCalls = 0;
  let resolveClosed: ((info: ClosedInfo) => void) | null = null;
  const connectOnce: Connector<LocalClient> = async (ctx) => {
    connects += 1;
    ctx.connecting();
    return {
      client: {} as LocalClient,
      closed: new Promise<ClosedInfo>((res) => {
        resolveClosed = res;
      }),
      // Never answers → every probe times out — the heartbeat-silent link #1776 is about.
      // Counted so a test can pin the concurrency cap (one reused probe, not one per cycle).
      isAlive: () => {
        isAliveCalls += 1;
        return new Promise<void>(() => {});
      },
      processAlive,
      teardown: () => {
        teardowns += 1;
        resolveClosed?.({ kind: "endpoint-down" });
      },
    };
  };
  return { connectOnce, stats: () => ({ connects, teardowns, isAliveCalls }) };
}

function localSession(processAlive: () => boolean) {
  const arm = localArm(processAlive);
  const session = makeSession<LocalClient>({
    initialConnection: "connecting",
    connectOnce: arm.connectOnce,
    reconnectDelayMs: 50,
    liveness: { intervalMs: 15_000, timeoutMs: 10_000 },
    label: "padi-local",
  });
  return { session, arm };
}

/** The current phase read synchronously off `onState` — the `Prov = never` twin of the
 *  ssh `snap` above. */
function localPhase(session: {
  onState(cb: (s: SessionState) => void): () => void;
}): string {
  let phase = "";
  session.onState((s) => {
    phase = s.phase;
  })();
  return phase;
}

describe("local arm liveness — same-box process oracle (#1776)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("timeout + oracle ALIVE → does NOT force-cycle (slow under load, not dead)", async () => {
    const { session, arm } = localSession(() => true);
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    expect(localPhase(session)).toBe("connected");
    expect(arm.stats().connects).toBe(1);

    // One full probe cycle (interval 15s + timeout 10s): the probe never answers, but the
    // oracle says the padi process is alive → the watchdog keeps probing, no force-cycle.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(arm.stats().teardowns).toBe(0);
    expect(arm.stats().connects).toBe(1);
    expect(localPhase(session)).toBe("connected");

    session.destroy();
  });

  it("timeout + oracle DEAD → force-cycles immediately", async () => {
    const alive = { v: true };
    const { session, arm } = localSession(() => alive.v);
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    alive.v = false; // the padi process is gone

    await vi.advanceTimersByTimeAsync(25_000); // probe times out → oracle says dead
    expect(arm.stats().teardowns).toBe(1);
    await vi.advanceTimersByTimeAsync(200); // routes through reconnect → a fresh dial
    expect(arm.stats().connects).toBe(2);

    session.destroy();
  });

  it("dead-man ceiling → force-cycles despite an ALIVE process after prolonged silence", async () => {
    const { session, arm } = localSession(() => true); // process always alive
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();

    // Below the ceiling, sustained heartbeat-silence with an alive process never cycles.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(arm.stats().teardowns).toBe(0);

    // Past the 60s dead-man ceiling (a deadlocked-but-alive padi), it force-cycles anyway.
    await vi.advanceTimersByTimeAsync(75_000);
    expect(arm.stats().teardowns).toBe(1);

    // Concurrency cap: across the whole ~100s hold-off the watchdog re-fired every cycle,
    // but only ONE `isAlive()` round-trip was ever outstanding — the pending probe was
    // reused, never piled a fresh `hello()` onto the already-slow padi each cycle.
    expect(arm.stats().isAliveCalls).toBe(1);

    session.destroy();
  });

  it("a REPLACED connection is probed with its OWN isAlive — a never-settling probe from the dead link never leaks onto the successor (#1776 F1)", async () => {
    // The heartbeat is session-scoped (one instance across every reconnect), so a
    // probe that never settled on the DEAD link must not stay cached and be handed
    // to the fresh link. Dial A's probe never answers and its oracle reports the
    // process gone (force-cycle immediately); dial B is healthy. Without the
    // close-time reset, B would reuse A's forever-pending promise, B's own
    // `isAlive()` would never be called, and B would be force-cycled despite health.
    let dial = 0;
    const bIsAliveCalls = { n: 0 };
    let resolveClosed: ((info: ClosedInfo) => void) | null = null;
    const connectOnce: Connector<LocalClient> = async (ctx) => {
      dial += 1;
      const thisDial = dial;
      ctx.connecting();
      return {
        client: {} as LocalClient,
        closed: new Promise<ClosedInfo>((res) => {
          resolveClosed = res;
        }),
        isAlive: () => {
          if (thisDial === 1) return new Promise<void>(() => {}); // A: never answers
          bIsAliveCalls.n += 1;
          return Promise.resolve(); // B: healthy round-trip
        },
        processAlive: () => thisDial !== 1, // A: process gone; B: alive
        teardown: () => resolveClosed?.({ kind: "endpoint-down" }),
      };
    };
    const session = makeSession<LocalClient>({
      initialConnection: "connecting",
      connectOnce,
      reconnectDelayMs: 50,
      liveness: { intervalMs: 15_000, timeoutMs: 10_000 },
      label: "padi-local-f1",
    });
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(1);
    session.markConnected();
    expect(localPhase(session)).toBe("connected");

    // A's probe times out; oracle says the process is gone → force-cycle, then reconnect.
    await vi.advanceTimersByTimeAsync(25_000); // interval + timeout → onStale → recheck
    await vi.advanceTimersByTimeAsync(200); // backoff → fresh dial B
    expect(dial).toBe(2);
    session.markConnected();
    expect(localPhase(session)).toBe("connected");

    // Drive one full watchdog cycle on B. With the leak fixed, the heartbeat calls
    // B's OWN `isAlive()` (which answers) → B stays connected. With the leak, it would
    // reuse A's never-settling promise → B's `isAlive()` is never called → B is cycled.
    bIsAliveCalls.n = 0;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(bIsAliveCalls.n).toBeGreaterThan(0);
    expect(localPhase(session)).toBe("connected");

    session.destroy();
  });
});
