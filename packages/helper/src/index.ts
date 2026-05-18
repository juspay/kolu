#!/usr/bin/env node
/**
 * `kolu-helper` — the remote arm of a Kolu remote terminal.
 *
 * Two modes:
 *
 *   --serve         (default — kolu invokes this over SSH)
 *                   Detect-or-spawn the daemon, then RELAY this SSH
 *                   session's stdin/stdout to/from the daemon over a
 *                   Unix domain socket. When SSH drops, the relay
 *                   process dies but the daemon stays alive — PTYs
 *                   survive across SSH reconnects.
 *
 *   --daemon-mode   (internal — relay spawns this detached)
 *                   The long-lived process. Owns node-pty children,
 *                   the per-PTY ring buffer, and a Unix socket at
 *                   `~/.kolu-helper/daemon.sock`. Accepts one client
 *                   at a time; a new connection replaces the old one
 *                   (handles the case where kolu reconnects via a
 *                   fresh SSH session before the previous relay's
 *                   socket has timed out).
 *
 * Talk-mode plan called this "v1" and the prototype was meant to
 * skip it; the user (rightly) pulled it back in because without it
 * every SSH blip kills every remote PTY.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  HelperAttachParamsSchema,
  HelperDisposeParamsSchema,
  HelperExecParamsSchema,
  HelperForegroundPidParamsSchema,
  type HelperFrame,
  HelperListPtysParamsSchema,
  HelperProcessNameParamsSchema,
  type HelperPtyEvent,
  HelperQueryDbParamsSchema,
  HelperRequestSchema,
  HelperResizeParamsSchema,
  HelperSpawnPtyParamsSchema,
  HelperUnwatchParamsSchema,
  HelperWatchParamsSchema,
  HelperWriteParamsSchema,
} from "kolu-common/helper-protocol";
import pkg from "../package.json" with { type: "json" };
import { createManager } from "./manager.ts";

const HELPER_VERSION: string = pkg.version;
const HELPER_DIR = join(homedir(), ".kolu-helper");
const SOCKET_PATH = join(HELPER_DIR, "daemon.sock");
const LOG_PATH = join(HELPER_DIR, "daemon.log");
const PID_PATH = join(HELPER_DIR, "daemon.pid");

const isDaemon = process.argv.includes("--daemon-mode");

if (isDaemon) {
  runDaemon();
} else {
  void runRelay();
}

// ─── Daemon ────────────────────────────────────────────────────────────

function runDaemon(): void {
  mkdirSync(HELPER_DIR, { recursive: true });
  // Clean up any stale socket from a previous run that didn't exit
  // cleanly. If a real daemon was already bound here, `listen` below
  // would have failed first.
  if (existsSync(SOCKET_PATH)) {
    try {
      unlinkSync(SOCKET_PATH);
    } catch {
      // ignore
    }
  }
  try {
    writeFileSync(PID_PATH, String(process.pid));
  } catch {
    // best-effort — losing the PID file just means stale-detection
    // is slightly less precise; correctness rides on the socket itself
  }

  let currentClient: net.Socket | null = null;
  function writeToClient(frame: HelperFrame): void {
    if (!currentClient || currentClient.destroyed) return;
    currentClient.write(`${JSON.stringify(frame)}\n`);
  }

  const manager = createManager((event) => writeToClient(event));

  function respond(id: number, result: unknown): void {
    writeToClient({ id, result });
  }
  function respondError(
    id: number,
    kind: "not-found" | "spawn-failed" | "exec-failed" | "invalid",
    message: string,
  ): void {
    writeToClient({ id, error: { kind, message } });
  }

  function handleRequest(req: {
    id: number;
    method: string;
    params: unknown;
  }): void {
    try {
      switch (req.method) {
        case "spawnPty": {
          const params = HelperSpawnPtyParamsSchema.parse(req.params);
          const { ptyId, pid } = manager.spawn(params);
          respond(req.id, { ptyId, pid });
          return;
        }
        case "write": {
          const params = HelperWriteParamsSchema.parse(req.params);
          manager.write(params.ptyId, params.data);
          respond(req.id, {});
          return;
        }
        case "resize": {
          const params = HelperResizeParamsSchema.parse(req.params);
          manager.resize(params.ptyId, params.cols, params.rows);
          respond(req.id, {});
          return;
        }
        case "dispose": {
          const params = HelperDisposeParamsSchema.parse(req.params);
          manager.dispose(params.ptyId);
          respond(req.id, {});
          return;
        }
        case "attach": {
          const params = HelperAttachParamsSchema.parse(req.params);
          const events = manager.replay(params.ptyId, params.sinceSeq);
          for (const event of events) writeToClient(event);
          respond(req.id, { replayed: events.length });
          return;
        }
        case "detach": {
          respond(req.id, {});
          return;
        }
        case "foregroundPid": {
          const params = HelperForegroundPidParamsSchema.parse(req.params);
          respond(req.id, { pid: manager.foregroundPid(params.ptyId) });
          return;
        }
        case "processName": {
          const params = HelperProcessNameParamsSchema.parse(req.params);
          respond(req.id, { name: manager.processName(params.ptyId) });
          return;
        }
        case "listPtys": {
          HelperListPtysParamsSchema.parse(req.params);
          respond(req.id, { ptys: manager.list() });
          return;
        }
        case "exec": {
          const params = HelperExecParamsSchema.parse(req.params);
          manager
            .exec(params)
            .then((result) => respond(req.id, result))
            .catch((err) =>
              respondError(
                req.id,
                "exec-failed",
                err instanceof Error ? err.message : String(err),
              ),
            );
          return;
        }
        case "watch": {
          const params = HelperWatchParamsSchema.parse(req.params);
          const result = manager.watch(params);
          respond(req.id, result);
          return;
        }
        case "unwatch": {
          const params = HelperUnwatchParamsSchema.parse(req.params);
          manager.unwatch(params.subId);
          respond(req.id, {});
          return;
        }
        case "queryDb": {
          const params = HelperQueryDbParamsSchema.parse(req.params);
          manager
            .queryDb(params)
            .then((result) => respond(req.id, result))
            .catch((err) =>
              respondError(
                req.id,
                "exec-failed",
                err instanceof Error ? err.message : String(err),
              ),
            );
          return;
        }
        default:
          respondError(req.id, "invalid", `unknown method: ${req.method}`);
      }
    } catch (err) {
      respondError(
        req.id,
        err && typeof err === "object" && "issues" in err
          ? "invalid"
          : "spawn-failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const server = net.createServer((sock) => {
    // One client at a time. A fresh kolu-side SSH reconnect lands a
    // new client connection BEFORE the previous relay's socket has
    // necessarily noticed it's dead — close the old socket here so
    // every server-pushed event goes to the new client only.
    if (currentClient && !currentClient.destroyed) {
      currentClient.destroy();
    }
    currentClient = sock;

    // Immediately announce ready so the controller can transition to
    // "connected" without waiting for its first request to round-trip.
    writeToClient({
      method: "ready",
      params: { version: HELPER_VERSION },
    });

    const rl = createInterface({ input: sock, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (line.trim().length === 0) return;
      try {
        const parsed = JSON.parse(line);
        const req = HelperRequestSchema.safeParse(parsed);
        if (req.success) handleRequest(req.data);
      } catch {
        // malformed input from a client; daemon stays up.
      }
    });

    sock.on("close", () => {
      if (currentClient === sock) currentClient = null;
    });
    sock.on("error", () => {
      if (currentClient === sock) currentClient = null;
    });
  });

  server.listen(SOCKET_PATH);

  // Graceful shutdown only on explicit signal. SSH drops translate to
  // a closed client socket, not a daemon death — that's the whole
  // point of the daemon.
  process.on("SIGTERM", () => {
    manager.shutdown();
    try {
      unlinkSync(SOCKET_PATH);
    } catch {
      // ignore
    }
    process.exit(0);
  });

  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `kolu-helper daemon: unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`,
    );
  });
}

// ─── Relay (per-SSH-session client) ────────────────────────────────────

async function runRelay(): Promise<void> {
  // Detect a live daemon by trying to connect.
  if (!(await daemonReachable())) {
    spawnDetachedDaemon();
    if (!(await waitForDaemon(10_000))) {
      process.stderr.write("kolu-helper: daemon failed to come up\n");
      process.exit(1);
    }
  }

  const sock = net.connect(SOCKET_PATH);
  sock.on("connect", () => {
    process.stdin.pipe(sock);
    sock.pipe(process.stdout);
  });
  sock.on("error", (err) => {
    process.stderr.write(`kolu-helper relay: ${err.message}\n`);
    process.exit(1);
  });
  sock.on("close", () => {
    process.exit(0);
  });
}

function daemonReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(SOCKET_PATH);
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 1000);
  });
}

function spawnDetachedDaemon(): void {
  mkdirSync(HELPER_DIR, { recursive: true });
  const fd = openSync(LOG_PATH, "a");
  // Re-invoke the same script with `--daemon-mode`. Detached + ignored
  // stdio so the daemon outlives this relay (and outlives the SSH
  // session, which is the whole point).
  const child = spawn(
    process.execPath,
    [...process.argv.slice(1).filter((a) => a !== "--serve"), "--daemon-mode"],
    {
      detached: true,
      stdio: ["ignore", fd, fd],
    },
  );
  child.unref();
}

async function waitForDaemon(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await daemonReachable()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
