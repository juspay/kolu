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
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
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
  HelperReadFileParamsSchema,
  HelperStatMtimeMsParamsSchema,
  HelperSubscribeForegroundParamsSchema,
  HelperUnsubscribeForegroundParamsSchema,
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
const TOKEN_PATH = join(HELPER_DIR, "daemon.token");
const LOCK_PATH = join(HELPER_DIR, "daemon.lock");

/** First line every relay must send before any other frame: a single
 *  JSON object `{"auth":"<token>"}\n`. The daemon disconnects on
 *  mismatched / missing / malformed auth before any PTY ops are exposed.
 *
 *  The token is generated once per daemon, stored at `daemon.token`
 *  (mode 0600 inside a 0700 HELPER_DIR), and read by relays through the
 *  same path. Both files live on the helper user's HOME — only that
 *  user (and root) can read them. */
const AUTH_FRAME_MAX_BYTES = 256;

const isDaemon = process.argv.includes("--daemon-mode");

if (isDaemon) {
  runDaemon();
} else {
  void runRelay();
}

// ─── Daemon ────────────────────────────────────────────────────────────

function runDaemon(): void {
  mkdirSync(HELPER_DIR, { recursive: true });
  // 0700 — only this user can enter the dir, so the secret-bearing
  // `daemon.token` (mode 0600) is also unreadable to other system users.
  try {
    chmodSync(HELPER_DIR, 0o700);
  } catch {
    // best-effort — bind-mounted dirs may refuse chmod
  }

  // Lock acquisition: O_CREAT|O_EXCL. If the file already exists and
  // points to a live process, refuse to start (Reviewer #5: prevents a
  // racing second daemon from `unlink`-ing the live socket and orphaning
  // the in-flight client's PTYs). If the PID isn't alive any more,
  // remove the stale lock and try again.
  if (!acquireDaemonLock()) {
    process.stderr.write(
      "kolu-helper daemon: another daemon already holds the lock; exiting\n",
    );
    process.exit(2);
  }

  // Generate the per-daemon auth token. Written 0600 inside the 0700
  // HELPER_DIR. Same process reads it back when authorizing client
  // connections — short-circuits the case where a hostile process on
  // the same machine tries to connect to the socket without knowing
  // the secret.
  const authToken = randomBytes(32).toString("hex");
  try {
    const fd = openSync(TOKEN_PATH, "w", 0o600);
    try {
      writeFileSync(fd, authToken);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    process.stderr.write(
      `kolu-helper daemon: failed to write auth token: ${(err as Error).message}\n`,
    );
    process.exit(2);
  }

  // The socket-cleanup-then-listen dance is now safe: the lock above
  // prevents a concurrent daemon from racing us through this gap.
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
    // is slightly less precise; correctness rides on the lock + socket
  }

  let currentClient: net.Socket | null = null;
  function writeToClient(frame: HelperFrame): void {
    if (!currentClient || currentClient.destroyed || !currentClient.writable) {
      return;
    }
    try {
      // The socket can transition to "broken pipe" between our `destroyed`
      // check and the actual syscall (relay process exit, SSH drop, etc.).
      // Node escalates EPIPE to an `'error'` event; without this guard the
      // unhandled error tears down the daemon and every PTY with it.
      currentClient.write(`${JSON.stringify(frame)}\n`, (err) => {
        if (err && currentClient && !currentClient.destroyed) {
          currentClient.destroy();
        }
      });
    } catch {
      // Synchronous throws (rare — usually EBADF) — leave the socket; its
      // 'close' handler will null `currentClient`.
    }
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
          const { events, gap } = manager.replay(params.ptyId, params.sinceSeq);
          if (gap && params.sinceSeq !== undefined) {
            // Emit the gap signal BEFORE the replayed events so the
            // controller can clear scrollback before applying the new
            // bytes. Reviewer #7.
            writeToClient({
              method: "replayGap",
              params: { ptyId: params.ptyId, sinceSeq: params.sinceSeq },
            });
          }
          for (const event of events) writeToClient(event);
          respond(req.id, { replayed: events.length, gap });
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
          manager
            .watch(params)
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
        case "readFile": {
          const params = HelperReadFileParamsSchema.parse(req.params);
          manager
            .readFile(params)
            .then((result) => respond(req.id, result))
            .catch((err) =>
              respondError(
                req.id,
                "not-found",
                err instanceof Error ? err.message : String(err),
              ),
            );
          return;
        }
        case "statMtimeMs": {
          const params = HelperStatMtimeMsParamsSchema.parse(req.params);
          manager
            .statMtimeMs(params.path)
            .then((mtimeMs) => respond(req.id, { mtimeMs }))
            .catch((err) =>
              respondError(
                req.id,
                "not-found",
                err instanceof Error ? err.message : String(err),
              ),
            );
          return;
        }
        case "subscribeForeground": {
          const params = HelperSubscribeForegroundParamsSchema.parse(
            req.params,
          );
          manager.subscribeForeground(params.ptyId);
          respond(req.id, {});
          return;
        }
        case "unsubscribeForeground": {
          const params = HelperUnsubscribeForegroundParamsSchema.parse(
            req.params,
          );
          manager.unsubscribeForeground(params.ptyId);
          respond(req.id, {});
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
    // Attach error / close handlers BEFORE anything else so a half-open
    // socket can't escalate to an uncaught exception.
    sock.on("error", () => {});

    const rl = createInterface({ input: sock, crlfDelay: Infinity });
    rl.on("error", () => {});

    // Auth-pending state — the client must send `{"auth": "<token>"}`
    // as its first frame. Until then, this socket is NOT the
    // `currentClient`; it can't receive events and can't issue
    // commands. A racing hostile process that connects without the
    // token gets disconnected here, without observing the daemon's
    // ready frame (which would leak the helper's PID + version).
    let authed = false;
    const authTimeout = setTimeout(() => {
      if (authed) return;
      sock.destroy();
    }, 5_000);

    function adoptAsCurrentClient(): void {
      // One client at a time. A fresh SSH reconnect lands a new (now-
      // authed) connection BEFORE the previous relay's socket has
      // noticed it's dead — close the old one so every server-pushed
      // event goes to the new client only.
      if (currentClient && currentClient !== sock && !currentClient.destroyed) {
        currentClient.destroy();
      }
      currentClient = sock;
      sock.on("close", () => {
        if (currentClient === sock) currentClient = null;
      });
      sock.on("error", () => {
        if (currentClient === sock) currentClient = null;
      });

      // Now the socket is safe to write to. Announce ready so the
      // controller can transition to "connected" without waiting for
      // its first request to round-trip.
      writeToClient({
        method: "ready",
        params: { version: HELPER_VERSION },
      });
    }

    rl.on("line", (line) => {
      if (line.length > AUTH_FRAME_MAX_BYTES && !authed) {
        // Oversized first frame from an un-authed client — drop. Real
        // requests are small; this catches log-pasting / corruption.
        sock.destroy();
        return;
      }
      if (line.trim().length === 0) return;
      if (!authed) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          sock.destroy();
          return;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          typeof (parsed as { auth?: unknown }).auth !== "string" ||
          (parsed as { auth: string }).auth !== authToken
        ) {
          sock.destroy();
          return;
        }
        authed = true;
        clearTimeout(authTimeout);
        adoptAsCurrentClient();
        return;
      }
      try {
        const parsed = JSON.parse(line);
        const req = HelperRequestSchema.safeParse(parsed);
        if (req.success) handleRequest(req.data);
      } catch {
        // malformed input from a client; daemon stays up.
      }
    });
  });

  server.listen(SOCKET_PATH);

  // Graceful shutdown only on explicit signal. SSH drops translate to
  // a closed client socket, not a daemon death — that's the whole
  // point of the daemon.
  process.on("SIGTERM", () => {
    manager.shutdown();
    for (const p of [SOCKET_PATH, LOCK_PATH, TOKEN_PATH, PID_PATH]) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
    process.exit(0);
  });

  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `kolu-helper daemon: unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`,
    );
  });
  // Belt-and-braces: a synchronous throw from any socket / fs callback we
  // missed must not kill the daemon. The daemon's whole reason for existing
  // is to outlive transient client failures.
  process.on("uncaughtException", (err) => {
    process.stderr.write(
      `kolu-helper daemon: uncaught exception: ${err instanceof Error ? err.stack : String(err)}\n`,
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

  // Read the daemon's auth token (mode 0600 inside HELPER_DIR mode
  // 0700). The relay's stdin is the controller's SSH session, and the
  // controller can't read this file directly — so the relay prepends
  // the auth frame to the controller's stream. From the daemon's
  // perspective, the first line on every connection is the auth
  // handshake.
  let authToken: string;
  try {
    authToken = readFileSync(TOKEN_PATH, "utf8").trim();
  } catch (err) {
    process.stderr.write(
      `kolu-helper relay: cannot read daemon token (${(err as Error).message})\n`,
    );
    process.exit(1);
  }

  const sock = net.connect(SOCKET_PATH);
  sock.on("connect", () => {
    sock.write(`${JSON.stringify({ auth: authToken })}\n`);
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

/** Acquire the per-user daemon lock. Returns true if we got it (no live
 *  daemon was running). Returns false if another live daemon holds it.
 *
 *  Strategy:
 *   - Try `open(O_WRONLY|O_CREAT|O_EXCL, 0o600)` — atomic test-and-set.
 *   - If that succeeds, write our PID into it.
 *   - If it fails with EEXIST, read the existing pid; if that process
 *     isn't alive (`kill(pid, 0)` throws ESRCH), the lock is stale —
 *     unlink it and retry once. Otherwise fail.
 *
 *  Avoids both the lockless race (two relays racing to spawn daemons,
 *  each `unlink`ing the other's socket — Reviewer #5) and the stuck-
 *  lock-after-crash case (`unlink`-then-retry on dead PID). */
function acquireDaemonLock(): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, "wx", 0o600);
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        process.stderr.write(
          `kolu-helper daemon: lock acquisition failed: ${(e as Error).message}\n`,
        );
        return false;
      }
    }
    // EEXIST — check whether the holder is alive. If not, unlink + retry.
    let holderPid: number | undefined;
    try {
      const raw = readFileSync(LOCK_PATH, "utf8").trim();
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) holderPid = parsed;
    } catch {
      // unreadable lock — treat as stale
    }
    if (holderPid !== undefined) {
      let isLive = false;
      try {
        process.kill(holderPid, 0);
        isLive = true;
      } catch (sigErr) {
        // ESRCH: no such process — definitely stale; clean up + retry.
        // EPERM: process exists but isn't ours — refuse (the PID was
        // recycled to a different user; that's a race we can't safely
        // resolve from here).
        const code = (sigErr as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") return false;
      }
      if (isLive) return false;
    }
    try {
      unlinkSync(LOCK_PATH);
    } catch {
      // race — another daemon just removed it; retry
    }
  }
  return false;
}
