/**
 * The **yesterday-daemon fixture** — construct "a daemon left by a previous
 * build" WITHOUT needing an old build.
 *
 * Mixed-version production windows look like this: a long-lived child still
 * holds the gate + socket (and maybe a session blob on the state-root), while a
 * NEWER supervisor arrives and must recycle / adopt / refuse by name. Every
 * existing suite boots both sides from one checkout, so they can never disagree.
 * This fixture plants a real OS process plus caller-shaped on-disk artifacts so
 * recycle / session / contract tests can drive the window without a real old
 * binary (the previous-release e2e is the one place that boots a real old
 * kaval — see `previousRelease.e2e.test.ts`).
 *
 * Artifacts written into an owner-only tmpdir:
 *   - gate file (pid-as-decimal text by default; caller can plant garbage)
 *   - socket (optional real unix listener so `socketAccepting` sees a live peer)
 *   - session / config blob under a state-root (optional)
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import { KAVAL_GATE_FILE, PTY_HOST_SOCK_FILE } from "kaval";

/** Gate content shapes the recycle path can meet. */
export type GateShape =
  /** Current master format: decimal pid + newline (see `acquirePidGate`). */
  | { kind: "current" }
  /** Foreign / garbage — unparsable by `gatePid` (returns undefined). */
  | { kind: "foreign"; content: string }
  /** Absent — no gate file at all. */
  | { kind: "absent" }
  /** Explicit bytes (e.g. a multi-field future format). */
  | { kind: "bytes"; content: string };

export interface YesterdayDaemonOpts {
  /** Prefix for the mkdtemp dir. */
  label?: string;
  /** Gate shape. Default: current (decimal pid of the live child). */
  gate?: GateShape;
  /**
   * When true (default), accept on a real unix socket so the supervisor's
   * `socketAccepting` probe treats the gate holder as a live serving daemon.
   * When false, only the gate/child exist (stale-gate / dead-socket arm).
   */
  withSocket?: boolean;
  /**
   * Optional previous-shape (or current-shape) session blob written under
   * `stateRoot/config.json` as the `session` key of a padi conf store.
   * Pass a raw object (conf stores unvalidated JSON).
   */
  session?: unknown;
  /**
   * Full padi conf payload (session + activityFeed + …). When set, overrides
   * a bare `session` write — use this to plant a complete previous-build
   * `config.json`.
   */
  conf?: Record<string, unknown>;
  /**
   * Gate / socket filenames. Default: kaval's real names so recycle paths that
   * hard-code `KAVAL_GATE_FILE` / `PTY_HOST_SOCK_FILE` find them.
   */
  gateFile?: string;
  sockFile?: string;
}

export interface YesterdayDaemon {
  /** Owner-only rendezvous dir holding gate + socket. */
  dir: string;
  gatePath: string;
  socketPath: string;
  /** State-root dir (created when session/conf is planted). */
  stateRoot: string | undefined;
  /** Absolute path of the planted conf file, if any. */
  confPath: string | undefined;
  /** The long-lived child (or undefined when gate is absent / foreign-only). */
  child: ChildProcess | undefined;
  /** The child's pid (always a live process when `child` is set). */
  pid: number | undefined;
  /** The in-process accept server (when `withSocket`). */
  server: Server | undefined;
  /** Kill the child, close the socket, remove the dir. Safe to call twice. */
  dispose: () => Promise<void>;
}

/** Spawn a long-lived inert child whose pid we can plant in a gate. */
function liveChild(): ChildProcess {
  assertDaemonSpawnAllowed("yesterday-daemon fixture child");
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 600_000)"],
    {
      stdio: "ignore",
    },
  );
  if (child.pid === undefined) {
    throw new Error("yesterday-daemon fixture: child failed to start");
  }
  return child;
}

/** Is `pid` still alive? `kill(pid, 0)` probes without signalling. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Plant a "daemon left by a previous build": real pid, owner-only dir, optional
 * accepting socket, optional previous-shape session/config on a state-root.
 */
export async function plantYesterdayDaemon(
  opts: YesterdayDaemonOpts = {},
): Promise<YesterdayDaemon> {
  const label = opts.label ?? "yesterday-daemon-";
  const dir = mkdtempSync(join(tmpdir(), label));
  // Owner-only — mirrors production gate/socket privacy (`isPrivateOwnedDir`).
  chmodSync(dir, 0o700);

  const gateFile = opts.gateFile ?? KAVAL_GATE_FILE;
  const sockFile = opts.sockFile ?? PTY_HOST_SOCK_FILE;
  const gatePath = join(dir, gateFile);
  const socketPath = join(dir, sockFile);
  const gate: GateShape = opts.gate ?? { kind: "current" };
  const withSocket = opts.withSocket ?? true;

  let child: ChildProcess | undefined;
  let pid: number | undefined;
  let server: Server | undefined;
  let stateRoot: string | undefined;
  let confPath: string | undefined;

  // A live child is needed whenever the gate should name a real pid (current
  // shape) OR when we want a live process for recycle-to-kill proofs even with
  // a foreign gate (caller can plant foreign content while we still hold a
  // child they can observe).
  if (
    gate.kind === "current" ||
    gate.kind === "foreign" ||
    gate.kind === "bytes"
  ) {
    child = liveChild();
    pid = child.pid as number;
  }

  switch (gate.kind) {
    case "current":
      writeFileSync(gatePath, `${pid}\n`, { mode: 0o600 });
      break;
    case "foreign":
      writeFileSync(gatePath, gate.content, { mode: 0o600 });
      break;
    case "bytes":
      writeFileSync(gatePath, gate.content, { mode: 0o600 });
      break;
    case "absent":
      // no file
      break;
  }

  if (withSocket) {
    server = createServer((sock) => {
      // Accept and hold — the real handshake is injected by the test's
      // `connect`, not the wire (same idiom as endpoint.test.ts's fakeDaemon).
      sock.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(socketPath, () => {
        server?.off("error", reject);
        resolve();
      });
    });
  }

  if (opts.conf !== undefined || opts.session !== undefined) {
    stateRoot = mkdtempSync(join(tmpdir(), "yesterday-sr-"));
    chmodSync(stateRoot, 0o700);
    confPath = join(stateRoot, "config.json");
    // Plant through conf's own store so the on-disk shape matches what
    // `openPadiStateStores` reads (projectVersion metadata, key layout). A
    // hand-rolled JSON blob can land keys conf then silently defaults.
    // Dynamic import keeps this fixture free of a hard top-level cycle with
    // stateStore (the fixture is also imported by stateStore-adjacent tests).
    const { openPadiStateStores } = await import("../session/stateStore.ts");
    const stores = openPadiStateStores(stateRoot);
    if (opts.conf !== undefined) {
      for (const [k, v] of Object.entries(opts.conf)) {
        stores.conf.set(k as "session", v as never);
      }
    } else {
      stores.conf.set("session", opts.session as never);
      stores.conf.set("importedLegacyConfig", true);
    }
  }

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
        // Force-close established peers so close() settles.
        server?.closeAllConnections?.();
      });
    }
    if (child !== undefined && child.pid !== undefined && isAlive(child.pid)) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      await new Promise<void>((resolve) => {
        child?.once("exit", () => resolve());
        // If already exited between the probe and the listener, resolve next tick.
        if (child?.exitCode !== null) resolve();
      });
    }
    rmSync(dir, { recursive: true, force: true });
    if (stateRoot !== undefined) {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  };

  return {
    dir,
    gatePath,
    socketPath,
    stateRoot,
    confPath,
    child,
    pid,
    server,
    dispose,
  };
}

/** Ensure a private parent dir exists for a gate path (for callers that plant
 *  only a gate file without the full fixture). */
export function ensurePrivateGateDir(gatePath: string): void {
  const dir = dirname(gatePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}
