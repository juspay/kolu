/**
 * Kolu local-PTY-host agent. Same kolu binary as the HTTP server,
 * branched at `process.argv.includes("--stdio")` before any HTTP
 * setup. Owns all node-pty children for local terminals, serves the
 * `agentSurface` contract over a unix socket so kolu-server (and a
 * future second kolu-server on the same `$KOLU_STATE_DIR`) connects
 * via `agent.sock`.
 *
 * Lifecycle:
 *  1. `tryAcquirePidFile` — atomic single-instance gate.
 *  2. `prepareSocket` — unlink stale socket if present.
 *  3. `createPtyHost` — the in-process owner of every local PTY.
 *  4. Bind `agent.sock` (mode 0700). The `implementSurface` router is
 *     built ONCE (its sources close over the shared `PtyHost`); each
 *     accepted connection serves that same router over `serveOverStdio`.
 *     The `PtyHost` is shared across connections, so a kolu-server
 *     restart sees the same PTYs.
 *  5. Clean up on SIGTERM/SIGINT — unlink socket + pid file.
 */

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import { createPtyHost } from "@kolu/pty-host";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import { implement } from "@orpc/server";
import { AGENT_CONTRACT_VERSION, agentSurface } from "kolu-common/agentSurface";
import {
  cleanEnv,
  configureNixShellEnv,
  koluIdentityEnv,
  prepareShellInit,
} from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { ensureKoluRoot, koluShellDir } from "../koluRoot.ts";
import { daemonPaths } from "../koluState.ts";

const STARTED_AT = Date.now();

interface LogFields {
  [key: string]: unknown;
}

function logLine(level: string, msg: string, fields?: LogFields): void {
  const line = JSON.stringify({
    ts: Date.now(),
    level,
    msg,
    ...(fields ?? {}),
  });
  process.stderr.write(`${line}\n`);
}

/** Atomically claim the pid file. Returns true if this process is the
 *  authoritative owner; false if another live daemon already owns it.
 *  Stale pid files (recorded pid no longer alive) are cleaned up and
 *  the gate is retried — keeps the gate working across crashes without
 *  external cleanup. */
function tryAcquirePidFile(pidFile: string): boolean {
  mkdirSync(dirname(pidFile), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = openSync(pidFile, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    let recordedPid = 0;
    try {
      recordedPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    } catch {
      // Unreadable; treat as stale.
    }
    if (Number.isFinite(recordedPid) && recordedPid > 0) {
      try {
        process.kill(recordedPid, 0);
        return false; // Another daemon is alive.
      } catch (sigErr) {
        if ((sigErr as NodeJS.ErrnoException).code !== "ESRCH") throw sigErr;
        // Stale — owner is gone. Fall through to unlink + retry.
      }
    }
    try {
      unlinkSync(pidFile);
    } catch {
      // Race: another process unlinked it first; loop and retry create.
    }
  }
  // Couldn't claim after several attempts — treat as already-owned.
  return false;
}

function prepareSocket(socketPath: string): void {
  if (!existsSync(socketPath)) return;
  try {
    unlinkSync(socketPath);
  } catch (err) {
    logLine("warn", "unable to unlink stale socket", {
      socketPath,
      err: (err as Error).message,
    });
  }
}

interface AgentLogger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (bindings: unknown) => AgentLogger;
}

function makeLogger(): AgentLogger {
  function emit(level: string, args: unknown[]): void {
    const [first, second] = args;
    if (typeof first === "string") {
      logLine(level, first);
    } else if (first && typeof first === "object") {
      const msg = typeof second === "string" ? second : "";
      logLine(level, msg, first as LogFields);
    } else {
      logLine(level, String(first ?? ""));
    }
  }
  const logger: AgentLogger = {
    debug: (...args) => emit("debug", args),
    info: (...args) => emit("info", args),
    warn: (...args) => emit("warn", args),
    error: (...args) => emit("error", args),
    child: () => logger,
  };
  return logger;
}

async function main(): Promise<void> {
  configureNixShellEnv(process.env.KOLU_NIX_ENV_WHITELIST ?? "default");

  const { pidFile, socketPath, stateDir } = daemonPaths();

  if (!tryAcquirePidFile(pidFile)) {
    logLine("info", "another daemon already owns the pid file — exiting", {
      pidFile,
    });
    process.exit(0);
  }

  prepareSocket(socketPath);
  ensureKoluRoot();

  const log = makeLogger();
  logLine("info", "agent starting", {
    pid: process.pid,
    contract: AGENT_CONTRACT_VERSION,
    pkgVersion: pkg.version,
    user: userInfo().username,
    stateDir,
  });

  const ptyHost = createPtyHost({
    // biome-ignore lint/suspicious/noExplicitAny: agent logger matches kolu-shared.Logger structurally
    log: log as any,
  });

  // Built once and shared across connections — `agentSurface` has only
  // streams + procedures whose sources close over the process-wide
  // `ptyHost`, and the async-iterator protocol already isolates each
  // subscription per `source()` call, so there's no per-connection
  // state to allocate. (A kolu-server restart reconnects to the same
  // `ptyHost`, which is the whole point.)
  const fragment = implementSurface(agentSurface, {
    channel: inMemoryChannelByName(),
    streams: {
      terminalAttach: {
        source: async function* (input, signal) {
          const { snapshot, deltas } = await ptyHost.attach(input.id, signal);
          yield { kind: "snapshot" as const, data: snapshot };
          for await (const chunk of deltas) {
            yield { kind: "delta" as const, data: chunk };
          }
        },
      },
      terminalCwd: {
        source: async function* (input, signal) {
          const current = ptyHost.getCwd(input.id);
          if (current !== undefined) yield current;
          yield* ptyHost.subscribeCwd(input.id, signal);
        },
      },
      terminalTitle: {
        source: async function* (input, signal) {
          for await (const title of ptyHost.subscribeTitle(input.id, signal)) {
            // Sample foreground process + pid at title-change time —
            // the title event is exactly the moment the foreground
            // process changes (kolu's preexec hook emits OSC 2), so
            // these reads are fresh.
            yield {
              title,
              process: ptyHost.getProcess(input.id) ?? "",
              foregroundPid: ptyHost.getForegroundPid(input.id),
            };
          }
        },
      },
      terminalCommandRun: {
        source: async function* (input, signal) {
          yield* ptyHost.subscribeCommandRun(input.id, signal);
        },
      },
      terminalExit: {
        source: async function* (input, _signal) {
          const code = await ptyHost.exitPromise(input.id);
          yield { exitCode: code };
        },
      },
    },
    procedures: {
      terminal: {
        spawn: async ({ input }) => {
          const env = cleanEnv();
          const shell = env.SHELL ?? "/bin/sh";
          const cwd =
            input.cwd && input.cwd.length > 0 ? input.cwd : (env.HOME ?? "/");
          Object.assign(env, koluIdentityEnv(input.termProgramVersion));
          // Use the kolu-server-minted id so the daemon PTY id ==
          // kolu-server terminal id (reattach-by-id across restart).
          const terminalId = input.id ?? randomUUID();
          const shellInit = prepareShellInit({
            shell,
            home: env.HOME,
            terminalId,
            rcDir: koluShellDir,
          });
          Object.assign(env, shellInit.env);
          const result = ptyHost.spawn({
            id: terminalId,
            shell,
            args: shellInit.args,
            env,
            cwd,
            cols: input.cols,
            rows: input.rows,
            scrollback: input.scrollback,
            onDispose: shellInit.cleanup,
          });
          return {
            id: result.id,
            pid: result.pid,
            cwd,
            process: ptyHost.getProcess(result.id) ?? shell,
          };
        },
        kill: async ({ input }) => {
          ptyHost.kill(input.id);
          return { ok: true };
        },
        killAll: async () => {
          const before = ptyHost.list();
          for (const e of before) ptyHost.kill(e.id);
          return { killed: before.length };
        },
        write: async ({ input }) => {
          ptyHost.write(input.id, input.data);
          return { ok: true };
        },
        resize: async ({ input }) => {
          ptyHost.resize(input.id, input.cols, input.rows);
          return { ok: true };
        },
        list: async () => ({ entries: ptyHost.list() }),
        getForegroundPid: async ({ input }) => {
          const pid = ptyHost.getForegroundPid(input.id);
          return { pid };
        },
        getScreenState: async ({ input }) => {
          return { data: ptyHost.getScreenState(input.id) };
        },
        getScreenText: async ({ input }) => {
          return {
            text: ptyHost.getScreenText(
              input.id,
              input.startLine,
              input.endLine,
            ),
          };
        },
      },
      system: {
        version: async () => ({
          contractVersion: AGENT_CONTRACT_VERSION,
          pkgVersion: pkg.version,
          pid: process.pid,
          startedAt: STARTED_AT,
        }),
        heartbeat: async () => ({ ts: Date.now() }),
      },
    },
  });

  const rawRouter = implement(agentSurface.contract).router({
    ...fragment.router,
  });
  // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread doesn't match Router<any, T> exactly — runtime shape is valid (same `as any` cast as kolu/server.ts and remote-process-monitor).
  const router = rawRouter as any;

  const server = createServer((socket) => {
    logLine("info", "client connected");

    let closed = false;
    const onClose = () => {
      if (closed) return;
      closed = true;
      logLine("info", "client disconnected");
    };
    socket.on("close", onClose);
    socket.on("error", (err) => {
      logLine("warn", "socket error", { err: err.message });
    });

    serveOverStdio({
      router,
      transport: { read: socket, write: socket },
      onFirstRequest: () => logLine("info", "first RPC received"),
    })
      .catch((err) =>
        logLine("error", "serveOverStdio threw", {
          err: (err as Error).message,
        }),
      )
      .finally(onClose);
  });

  server.on("error", (err) => {
    logLine("error", "server error", { err: err.message });
    process.exit(1);
  });

  function cleanup(): void {
    try {
      ptyHost.dispose();
    } catch (err) {
      logLine("warn", "ptyHost.dispose threw", {
        err: (err as Error).message,
      });
    }
    try {
      server.close();
    } catch (err) {
      logLine("warn", "server.close threw", { err: (err as Error).message });
    }
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(pidFile);
    } catch {
      // ignore
    }
  }

  process.on("SIGTERM", () => {
    logLine("info", "SIGTERM — shutting down");
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    logLine("info", "SIGINT — shutting down");
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o700);
    } catch (err) {
      logLine("warn", "chmod socket threw", { err: (err as Error).message });
    }
    logLine("info", "agent listening", { socketPath });
  });
}

main().catch((err) => {
  logLine("error", "fatal", {
    err: (err as Error).message,
    stack: (err as Error).stack,
  });
  process.exit(1);
});
