/**
 * `nudge()` — the H2 wake verb (juspay/kolu#2101, the lid-close field test).
 *
 * The incident: a laptop slept for five minutes, its remote host session backed
 * off to the 60s cap, and the browser reconnected 15s before the next scheduled
 * tick. Nothing told the session that the world had changed, so the worst case
 * for a waking laptop is a full minute of dead remote panes. `nudge()` is the
 * signal: *a scheduled reconnect fires NOW*.
 *
 * What this suite exists to pin is the DIFFERENCE from `recheck()`, which is why
 * `recheck()` could not be reused as the wake verb:
 *
 *   - `recheck()` calls the failure ledger's `success()` — it REFILLS the
 *     bounded `"remote"` give-up budget, so a client that reconnects often turns a terminal fault
 *     into an eternal one. `nudge()` fires the SAME attempt that was already
 *     scheduled, keeping its attempt number and its budget position (falsifier
 *     iii, with the `recheck()` contrast right beside it).
 *   - `recheck()` force-cycles a LIVE link and revives a `failed` session.
 *     `nudge()` no-ops on both (falsifiers iv, v).
 *
 * Mocks `node:child_process` + `nixCopy` (the `recheck.test.ts` / `reconnect-
 * spin.test.ts` approach) so no real ssh / remote-store Nix command runs.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import { defineSurface } from "@kolu/surface/define";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { writeStdioReadiness } from "@kolu/surface/links/readiness";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface } from "@kolu/surface/server";
import { Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directAgentDerivation } from "./agentDerivation";
import { provisionAgent } from "./nixCopy";
import {
  type DownSessionState,
  makeSession,
  type Session,
  type SessionState,
} from "./session";
import { type AgentClient, type SshProv, sshConnector } from "./sshConnector";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

/** Mirrors `MAX_CONSECUTIVE_FAILURES` in `session.ts` (module-private on purpose —
 *  it is not a knob). The budget test asserts the give-up lands at exactly this
 *  many TOTAL attempts however many nudges arrive in between. */
const MAX_CONSECUTIVE_FAILURES = 5;

/** The capped backoff (`scheduleReconnect`'s `Math.min(…, 60_000)`) — the exact
 *  wait the field incident was stuck behind. */
const BACKOFF_CAP_MS = 60_000;

const tickSurface = defineSurface({
  streams: {
    tick: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** Narrow a `SessionState` snapshot to its DOWN arm — the UP arm carries no
 *  `error`/`cause` fields at all. */
function down(s: SessionState<SshProv>): DownSessionState {
  if (s.phase !== "disconnected" && s.phase !== "failed") {
    throw new Error(`expected a DOWN session state, got phase=${s.phase}`);
  }
  return s;
}

/** A child that never serves — it exits with `code` on the next tick, before any
 *  RPC. A non-255 exit that never connected is classified `"remote"`, so this is
 *  the fixture that walks the BOUNDED give-up budget. */
function crashingChild(code: number) {
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  setTimeout(
    () => (child as unknown as EventEmitter).emit("exit", code, null),
    1,
  );
  return child;
}

/** A child that serves a real agent over a loopback pair and stays alive until
 *  `kill()` — so a test can assert a LIVE link was (or was not) force-cycled. */
function controllableChild() {
  const pair = createLoopbackPair();
  const runtime = implementSurface(tickSurface, {
    streams: {
      tick: {
        source: () => Stream.concat(Stream.make({ n: 0 }), Stream.never),
      },
    },
  });
  void serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: pair.server,
  });
  writeStdioReadiness(pair.server.write, { verdict: "ready" });

  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdin = pair.client.write;
  child.stdout = pair.client.read;
  child.stderr = new PassThrough();
  const kill = vi.fn(() => {
    pair.server.write.end();
    (child as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    return true;
  });
  child.kill = kill;
  return { child, kill };
}

function buildSession(opts: {
  host: string;
  reconnectDelayMs: number;
  onLine?: (line: string) => void;
}): Session<AgentClient, SshProv> {
  return makeSession<AgentClient, SshProv>({
    initialConnection: "probing",
    connectOnce: sshConnector({
      surface: tickSurface,
      host: opts.host,
      binary: "agent",
      localEnv: {},
      resolveDrvPath: () =>
        Promise.resolve(
          directAgentDerivation(
            "/nix/store/deadbeef-agent.drv",
            TEST_BINARY_CACHE,
          ),
        ),
    }),
    reconnectDelayMs: opts.reconnectDelayMs,
    label: opts.host,
    log: collectLogger(opts.onLine ?? (() => {})),
  });
}

describe("Session.nudge — fast-forward an ALREADY-scheduled reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue({
      ok: true,
      agentPath: "/nix/store/deadbeef-agent",
    } as never);
    vi.mocked(spawn).mockImplementation(() => crashingChild(127) as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("(control) with no nudge, the retry waits out the WHOLE capped backoff — the field signature", async () => {
    // This is the incident, pinned: the session is down, the backoff is at its
    // 60s cap, and NOTHING short of the scheduled tick redials. A waking laptop
    // that misses the tick by a second waits the other 59.
    const session = buildSession({
      host: "control-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
    });
    session.pin().catch(() => {});

    await vi.advanceTimersByTimeAsync(5);
    expect(session.currentState().phase).toBe("disconnected");
    expect(spawn).toHaveBeenCalledTimes(1);

    // A full cap's worth of fake time after the failure (which landed a tick in),
    // one millisecond short of the scheduled tick: still nothing.
    await vi.advanceTimersByTimeAsync(BACKOFF_CAP_MS - 5);
    expect(spawn).toHaveBeenCalledTimes(1);
    // The tick, and only the tick, redials.
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(2);

    session.destroy();
  });

  it("(i) fires the scheduled reconnect NOW instead of waiting out the remaining backoff", async () => {
    const lines: string[] = [];
    const session = buildSession({
      host: "nudge-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
      onLine: (line) => lines.push(line),
    });
    session.pin().catch(() => {});

    // Down, with the full 60s cap armed.
    await vi.advanceTimersByTimeAsync(5);
    expect(session.currentState().phase).toBe("disconnected");
    expect(spawn).toHaveBeenCalledTimes(1);

    // A second into the wait — 59s still to go on the schedule.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(1);

    // The wake signal. The next dial must land within a tick of fake time, not
    // 59 seconds later.
    session.nudge();
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(2);

    // It narrates through the session journal (the field-test evidence channel),
    // and the line states that the budget did NOT move.
    const fired = lines.filter((l) => l.includes("firing the scheduled retry"));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain("attempt 1");
    expect(fired[0]).toContain("give-up budget unchanged");

    session.destroy();
  });

  it("(ii) a nudge storm coalesces to exactly ONE dial", async () => {
    const session = buildSession({
      host: "storm-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
    });
    session.pin().catch(() => {});

    await vi.advanceTimersByTimeAsync(5);
    expect(spawn).toHaveBeenCalledTimes(1);

    // Ten clients reconnect at once (a wake storms every open tab). The first
    // nudge disarms the timer and dials; the rest meet an in-flight dial and are
    // no-ops — the coalescing IS the no-op arm, not a separate lock.
    for (let i = 0; i < 10; i++) session.nudge();
    await vi.advanceTimersByTimeAsync(5);
    expect(spawn).toHaveBeenCalledTimes(2);

    // …and still one, well past the point a second dial would have shown up.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(2);

    session.destroy();
  });

  it("(iii) does NOT refill the give-up budget — a nudged 'remote' session still gives up at the ceiling", async () => {
    // THE reason `recheck()` is the wrong verb. Every attempt here fails
    // `"remote"` (exit 127, never connected). Nudging after each failure must
    // fast-forward the wait WITHOUT refilling the ledger's remote run, so the
    // terminal verdict still arrives at exactly MAX_CONSECUTIVE_FAILURES total
    // attempts.
    const session = buildSession({
      host: "budget-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
    });
    session.pin().catch(() => {});

    for (let i = 0; i < 12 && session.currentState().phase !== "failed"; i++) {
      await vi.advanceTimersByTimeAsync(5);
      if (session.currentState().phase === "disconnected") session.nudge();
    }

    expect(session.currentState().phase).toBe("failed");
    expect(down(session.currentState()).cause).toBe("remote");
    expect(spawn).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);

    session.destroy();
  });

  it("(iii-contrast) recheck() in the same loop never gives up — it refills the budget", async () => {
    // The falsifier for the verb choice itself: swap `nudge()` for `recheck()`
    // in the identical loop and the bounded `"remote"` give-up never arrives,
    // because `recheck()` refills the whole failure ledger every time. A wake signal
    // wired to `recheck()` would make a permanently-broken host retry forever.
    const session = buildSession({
      host: "recheck-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
    });
    session.pin().catch(() => {});

    for (let i = 0; i < 12 && session.currentState().phase !== "failed"; i++) {
      await vi.advanceTimersByTimeAsync(5);
      if (session.currentState().phase === "disconnected") session.recheck();
    }

    expect(session.currentState().phase).not.toBe("failed");
    expect(vi.mocked(spawn).mock.calls.length).toBeGreaterThan(
      MAX_CONSECUTIVE_FAILURES,
    );

    session.destroy();
  });

  it("(iv) a `failed` session stays failed — no dial", async () => {
    const session = buildSession({
      host: "failed-host",
      reconnectDelayMs: 10,
    });
    session.pin().catch(() => {});

    // Five bounded `"remote"` failures at a tiny backoff → terminal.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(session.currentState().phase).toBe("failed");
    const dialsAtGiveUp = vi.mocked(spawn).mock.calls.length;

    // Reviving a terminal verdict is `reconnect()`'s job, not a wake signal's:
    // there is no scheduled attempt to fast-forward.
    session.nudge();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.currentState().phase).toBe("failed");
    expect(vi.mocked(spawn).mock.calls.length).toBe(dialsAtGiveUp);

    session.destroy();
  });

  it("(v) a connected session is untouched — no cycle (the difference from recheck)", async () => {
    const children: Array<{ kill: ReturnType<typeof vi.fn> }> = [];
    vi.mocked(spawn).mockImplementation(() => {
      const { child, kill } = controllableChild();
      children.push({ kill });
      return child as never;
    });

    const session = buildSession({
      host: "live-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
    });
    session.pin().catch(() => {});

    await vi.advanceTimersByTimeAsync(1);
    expect(session.currentState().phase).toBe("connecting");
    session.markConnected();
    expect(session.currentState().phase).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    // `recheck()` would kill this child. `nudge()` must not: a live link has no
    // scheduled reconnect to fire, and a wake signal is not evidence the link is
    // stale.
    session.nudge();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(children[0]?.kill).not.toHaveBeenCalled();
    expect(session.currentState().phase).toBe("connected");
    expect(spawn).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it("is a no-op on an unreferenced session (no spawn, no throw)", () => {
    const session = buildSession({
      host: "unpinned-host",
      reconnectDelayMs: BACKOFF_CAP_MS,
    });
    // Never pinned ⇒ refCount 0. A wake sweeping every host must not spin up a
    // session nobody asked for.
    session.nudge();
    expect(spawn).not.toHaveBeenCalled();
    session.destroy();
  });
});
