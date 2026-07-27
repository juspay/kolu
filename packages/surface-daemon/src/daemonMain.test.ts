/**
 * The daemon skeleton's lifecycle — driven entirely in-process, no real signals
 * and no forked children: the gate short-circuit, the serve→abort path, the
 * idle-timeout path, and the readiness hook. (A real spawned `kaval` over its
 * socket is exercised in kaval's e2e; this pins the mechanism in isolation,
 * including the `idleTimeout` lifetime that kaval itself never uses — the proof
 * the skeleton is parameterized, not a single program's internals.)
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DAEMON_BIND_PID_ENV,
  type DaemonSpec,
  daemonLifetimeFromEnv,
  daemonMain as daemonMainCore,
  lifetimeInfo,
} from "./daemonMain.ts";
import type { Logger } from "./logger.ts";
import { gatePid, isHolderLive } from "./pidGate.ts";

/** The supervisor's read, composed from the shared primitives: the live
 *  holder's pid, or `undefined` (absent, malformed, or stale). */
function liveHolder(gatePath: string): number | undefined {
  const pid = gatePid(gatePath);
  return pid !== undefined && isHolderLive(pid) ? pid : undefined;
}

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// The router is never invoked in these tests (no RPC is made) — only bound —
// so an empty object stands in for a real surface router.
const noRouter = {} as DaemonSpec["router"];
const SELF_IDENTITY = { pid: process.pid, startUnixUs: 1_000_000 };
const startTime = (pid: number) => pid * 1_000;
const daemonMain = (
  spec: Omit<DaemonSpec, "processIdentity" | "readProcessIdentity">,
) =>
  daemonMainCore({
    ...spec,
    processIdentity: SELF_IDENTITY,
    readProcessIdentity: (pid) =>
      pid === process.pid
        ? SELF_IDENTITY
        : isHolderLive(pid)
          ? { pid, startUnixUs: startTime(pid) }
          : undefined,
  });

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

function liveChild(): ChildProcess & { pid: number } {
  assertDaemonSpawnAllowed("a short-lived liveness-probe child");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  children.push(child);
  if (child.pid === undefined) throw new Error("child failed to start");
  return child as ChildProcess & { pid: number };
}

/** A pid that is DEFINITELY gone: spawn a process, kill it, and await its exit so
 *  the reap is complete before the pid is handed back. */
async function deadPid(): Promise<number> {
  const child = liveChild();
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGKILL");
  await exited;
  return child.pid;
}

/** A fresh private (0700) dir with gate + socket paths under it. */
function paths(): { dir: string; gatePath: string; socketPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "kaval-daemon-"));
  return {
    dir,
    gatePath: join(dir, "daemon.pid"),
    socketPath: join(dir, "daemon.sock"),
  };
}

describeDaemon("daemonMain", () => {
  it("yields to a live instance without serving (already-running)", async () => {
    const { gatePath, socketPath } = paths();
    const otherPid = liveChild().pid;
    writeFileSync(gatePath, `${otherPid}\t${startTime(otherPid)}\n`);

    const exit = await daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
    });

    expect(exit).toEqual({ kind: "already-running", pid: otherPid });
    // It never bound a socket of its own.
    expect(existsSync(socketPath)).toBe(false);
  });

  it("serves, then shuts down on abort — releasing the gate and socket", async () => {
    const { gatePath, socketPath } = paths();
    const ac = new AbortController();
    // Arm-before-announce, pinned in-process: by the time `onReady` fires, the
    // shutdown triggers must ALREADY be installed — a supervisor that reacts to
    // the announcement by signaling must find the daemon signal-safe, never the
    // kernel-default-disposition window (`waitForShutdown` installs its handlers
    // synchronously BEFORE the announcement in `daemonMain`).
    const sigtermBaseline = process.listenerCount("SIGTERM");
    let sigtermAtReady: number | undefined;
    let ready!: () => void;
    const readyP = new Promise<void>((r) => {
      ready = r;
    });

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
      signal: ac.signal,
      onReady: () => {
        sigtermAtReady = process.listenerCount("SIGTERM");
        ready();
      },
    });

    await readyP;
    expect(sigtermAtReady).toBe(sigtermBaseline + 1); // armed BEFORE announced
    expect(liveHolder(gatePath)).toBe(process.pid); // gate held while serving
    ac.abort();

    expect(await exitP).toEqual({ kind: "shutdown", reason: "abort" });
    expect(liveHolder(gatePath)).toBeUndefined(); // gate released
    expect(existsSync(socketPath)).toBe(false); // socket removed
  });

  it("shuts down on continuous idleness (idleTimeout)", async () => {
    const { gatePath, socketPath } = paths();
    const exit = await daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "idleTimeout", ms: 30, isIdle: () => true },
      log: silentLog,
    });
    expect(exit).toEqual({ kind: "shutdown", reason: "idle" });
    expect(liveHolder(gatePath)).toBeUndefined();
  });

  it("does not time out while activity keeps it busy", async () => {
    const { gatePath, socketPath } = paths();
    let busy = true;
    const ac = new AbortController();
    let ready!: () => void;
    const readyP = new Promise<void>((r) => {
      ready = r;
    });

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "idleTimeout", ms: 20, isIdle: () => !busy },
      log: silentLog,
      signal: ac.signal,
      onReady: () => ready(),
    });

    await readyP;
    // Stay busy well past the idle window, then confirm it is still serving.
    await new Promise((r) => setTimeout(r, 80));
    expect(liveHolder(gatePath)).toBe(process.pid);
    busy = false; // now let it go idle
    expect(await exitP).toEqual({ kind: "shutdown", reason: "idle" });
  });

  it("shuts down within one poll tick of the watched pid dying (boundToPid)", async () => {
    const { gatePath, socketPath } = paths();
    const watched = liveChild();
    let ready!: () => void;
    const readyP = new Promise<void>((r) => {
      ready = r;
    });

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "boundToPid", pid: watched.pid, pollMs: 20 },
      log: silentLog,
      onReady: () => ready(),
    });

    await readyP;
    expect(liveHolder(gatePath)).toBe(process.pid); // serving while the run lives
    watched.kill("SIGKILL"); // the run dies

    expect(await exitP).toEqual({ kind: "shutdown", reason: "pid-gone" });
    expect(liveHolder(gatePath)).toBeUndefined(); // gate released
    expect(existsSync(socketPath)).toBe(false); // socket removed
  });

  it("exits immediately when bound to an already-dead pid (boundToPid) — WITHOUT announcing readiness", async () => {
    const { gatePath, socketPath } = paths();
    let announced = 0;
    const exit = await daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      // A large poll would prove nothing here: the immediate check must fire
      // BEFORE the first tick, so a slow poll must not be able to mask it.
      lifetime: { kind: "boundToPid", pid: await deadPid(), pollMs: 60_000 },
      log: silentLog,
      // Shutdown won during arming, so the daemon was never meaningfully up:
      // announcing it would advertise an UNARMED process (the triggers
      // already stood down) — a readiness-triggered SIGTERM would take the
      // kernel's default disposition (exit 143) instead of the orderly path.
      onReady: () => {
        announced += 1;
      },
    });
    expect(exit).toEqual({ kind: "shutdown", reason: "pid-gone" });
    expect(announced).toBe(0);
    expect(liveHolder(gatePath)).toBeUndefined();
    expect(existsSync(socketPath)).toBe(false);
  });

  it("resolves an already-aborted external signal as a clean abort — WITHOUT announcing readiness", async () => {
    const { gatePath, socketPath } = paths();
    const ac = new AbortController();
    ac.abort(); // aborted before the daemon ever arms
    let announced = 0;
    const exit = await daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
      signal: ac.signal,
      onReady: () => {
        announced += 1;
      },
    });
    expect(exit).toEqual({ kind: "shutdown", reason: "abort" });
    expect(announced).toBe(0);
    expect(liveHolder(gatePath)).toBeUndefined();
    expect(existsSync(socketPath)).toBe(false);
  });

  it("rejects a boundToPid lifetime with an invalid pid — releasing the gate (fail-fast at consumption)", async () => {
    // A direct caller can construct any `pid`; an out-of-range value must crash
    // loudly, NOT be swallowed by `isHolderLive` into a clean "pid-gone" exit.
    for (const pid of [0, -1, 2.5, 2 ** 31]) {
      const { gatePath, socketPath } = paths();
      await expect(
        daemonMain({
          gatePath,
          socketPath,
          router: noRouter,
          lifetime: { kind: "boundToPid", pid },
          log: silentLog,
        }),
      ).rejects.toThrow(/boundToPid\.pid/);
      // The gate + socket the daemon bound before the throw are released by the
      // `finally`, so a retry is never blocked.
      expect(liveHolder(gatePath)).toBeUndefined();
      expect(existsSync(socketPath)).toBe(false);
    }
  });

  it("disarms the lifetime when onReady throws — rejecting, releasing gate + socket, leaving no listeners", async () => {
    const { gatePath, socketPath } = paths();
    // Baselines BEFORE the call: the armed handlers must be gone afterwards, or
    // a test running many daemons accumulates SIGTERM/SIGINT listeners — the
    // exact leak `disarm` exists to prevent on this one non-resolving path.
    const baseline = {
      SIGTERM: process.listenerCount("SIGTERM"),
      SIGINT: process.listenerCount("SIGINT"),
    };
    const boom = new Error("announce failed");

    await expect(
      daemonMain({
        gatePath,
        socketPath,
        router: noRouter,
        lifetime: { kind: "forever" },
        log: silentLog,
        onReady: () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    // The `finally` released the real side effects…
    expect(liveHolder(gatePath)).toBeUndefined();
    expect(existsSync(socketPath)).toBe(false);
    // …and `disarm` removed the signal handlers without resolving.
    expect(process.listenerCount("SIGTERM")).toBe(baseline.SIGTERM);
    expect(process.listenerCount("SIGINT")).toBe(baseline.SIGINT);
  });

  it("fires onReady with the socket path and pid once listening", async () => {
    const { gatePath, socketPath } = paths();
    const ac = new AbortController();
    const seen: Array<{ socketPath: string; pid: number }> = [];

    const exitP = daemonMain({
      gatePath,
      socketPath,
      router: noRouter,
      lifetime: { kind: "forever" },
      log: silentLog,
      signal: ac.signal,
      onReady: (info) => seen.push(info),
    });

    // Give the bind a beat, then tear down.
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await exitP;

    expect(seen).toEqual([{ socketPath, pid: process.pid }]);
  });
});

describe("daemonLifetimeFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  const forever = { kind: "forever" } as const;

  it("selects the fallback ONLY when the bind var is truly absent/unset (production untouched)", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, undefined);
    expect(daemonLifetimeFromEnv(forever)).toBe(forever);
  });

  it("crashes loudly on an empty bind var (present-but-invalid, not absence)", () => {
    // A broken harness/systemd expansion of `$SOMEPID` yields `""`: PRESENT and
    // invalid, not unset. Treating it as absence is exactly how the daemon leak
    // creeps back, so it must throw like any other malformed value — only a truly
    // unset var is absence.
    vi.stubEnv(DAEMON_BIND_PID_ENV, "");
    expect(() => daemonLifetimeFromEnv(forever)).toThrow(DAEMON_BIND_PID_ENV);
  });

  it("selects boundToPid for a valid positive-integer pid value", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, "4321");
    expect(daemonLifetimeFromEnv(forever)).toEqual({
      kind: "boundToPid",
      pid: 4321,
    });
  });

  it("lifetimeInfo projects each arm to its serializable shape (drops the closure/pollMs)", () => {
    expect(lifetimeInfo({ kind: "forever" })).toEqual({ kind: "forever" });
    // idleTimeout keeps `ms`, drops the `isIdle` closure.
    expect(
      lifetimeInfo({ kind: "idleTimeout", ms: 5000, isIdle: () => true }),
    ).toEqual({ kind: "idleTimeout", ms: 5000 });
    // boundToPid keeps `pid`, drops the test-only `pollMs`.
    expect(lifetimeInfo({ kind: "boundToPid", pid: 4321, pollMs: 20 })).toEqual(
      {
        kind: "boundToPid",
        pid: 4321,
      },
    );
  });

  it("crashes loudly on a malformed bind var (no silent degrade to fallback, no coercion)", () => {
    // Beyond the obvious garbage: non-canonical numeric spellings `Number()` would
    // silently coerce to the WRONG pid (`1e3`→1000, `0x10`→16, ` 10 `→10, `010`→10),
    // a fractional pid, and a value past `pid_t` range must all throw, not bind.
    for (const bad of [
      "nope",
      "0",
      "-5",
      "12.5",
      "1e3",
      "0x10",
      " 10 ",
      "010",
      "3000000000", // > 2**31 - 1
    ]) {
      vi.stubEnv(DAEMON_BIND_PID_ENV, bad);
      expect(() => daemonLifetimeFromEnv(forever)).toThrow(DAEMON_BIND_PID_ENV);
    }
  });
});
