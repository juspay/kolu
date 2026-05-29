/**
 * The `kolu --stdio` PTY-host **daemon** (#951 R4c).
 *
 * Same kolu binary as the HTTP server, branched at `--stdio` before any HTTP
 * setup. It owns **only `@kolu/pty-host`** — node-pty children, the
 * `@xterm/headless` mirror, and the raw VT taps. It runs **zero providers**:
 * git / PR / agent-detection live in kolu-server, which consumes these raw
 * taps over the socket and runs the provider DAG fresh on every restart. That
 * is the whole point of the redo — the long-lived daemon that survives a
 * deploy is *thin and version-stable*, so a surviving daemon can never serve
 * stale detection (the #1031 failure). See `docs/plans/remote-terminals.html`.
 *
 * It serves the `ptyHostSurface` contract over `$KOLU_STATE_DIR/pty-host.sock`
 * so kolu-server (and a second kolu-server on the same state dir after a
 * restart) connects via the socket and reattaches to the same live PTYs.
 *
 * Lifecycle:
 *  1. `tryAcquirePidFile` — atomic single-instance gate (acquired BEFORE
 *     binding the socket so only one daemon per state dir owns the PTYs).
 *  2. `ensureKoluRoot` — the per-terminal shell rc files live in the daemon's
 *     koluRoot (the daemon spawns the shells, so it writes them).
 *  3. `createPtyHost({ log })` — the owner of every local PTY.
 *  4. Build the `ptyHostSurface` router ONCE (its stream sources close over
 *     the shared host), then serve that same router over every accepted
 *     socket connection. The host (and its PTYs) is process-wide, so a
 *     kolu-server restart sees the same terminals.
 *  5. Clean up on SIGTERM — dispose the host, unlink socket + pid file.
 *
 * **The socket is the wire, not stdout.** The daemon's stdout/stderr are
 * redirected into `pty-host.log` by the supervisor's fd redirect, so pino
 * logging to stdout is fine here — unlike a stdio agent, this daemon does
 * NOT use process.stdout as the protocol channel.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { createPtyHost, type PtyId } from "@kolu/pty-host";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import { implement, ORPCError } from "@orpc/server";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import {
  PTY_HOST_CONTRACT_VERSION,
  ptyHostSurface,
} from "kolu-common/ptyHostSurface";
import {
  cleanEnv,
  configureNixShellEnv,
  koluIdentityEnv,
  prepareShellInit,
} from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { currentBuildId } from "../daemon/buildId.ts";
import { tryAcquirePidFile } from "../daemon/daemonUtils.ts";
import { ensureKoluRoot, koluShellDir } from "../koluRoot.ts";
import { daemonPaths } from "../koluState.ts";
import { log } from "../log.ts";

/** Daemon entrypoint — dispatched from `index.ts` on `--stdio`. */
export async function runAgent(): Promise<void> {
  // The daemon spawns the PTY shells, so it owns the nix-devshell env filter
  // — and it's a SEPARATE process from kolu-server, so the server's
  // `configureNixShellEnv` module state doesn't reach here. kolu-server
  // exports its resolved whitelist via `KOLU_NIX_SHELL_WHITELIST` when
  // spawning us (set in `server.ts`); absent in production → the production
  // safety net (passthrough unless `IN_NIX_SHELL`) applies, same as
  // kolu-server with no flag. Must run before the first `cleanEnv()`.
  configureNixShellEnv(process.env.KOLU_NIX_SHELL_WHITELIST);

  const { pidFile, socketPath } = daemonPaths();

  // Single-instance gate, acquired BEFORE binding the socket so only one
  // daemon per `$KOLU_STATE_DIR` ever owns the PTYs. A losing race exits
  // quietly — the winning daemon is the one kolu-server connects to.
  if (!tryAcquirePidFile(pidFile)) {
    log.info(
      { pidFile },
      "pty-host: another daemon owns the pid file — exiting",
    );
    process.exit(0);
  }

  // The per-terminal shell rc files live in the daemon's koluRoot — the
  // daemon spawns the shells, so it writes (and cleans up) their rc files.
  ensureKoluRoot();

  const startedAt = Date.now();
  const host = createPtyHost({ log });

  const fragment = implementSurface(ptyHostSurface, {
    channel: inMemoryChannelByName(),
    streams: {
      // Per-terminal output — snapshot then live deltas (streaming.md §2).
      terminalAttach: {
        source: async function* (input, signal) {
          const att = host.attach(input.id, signal);
          yield { kind: "snapshot" as const, data: att.snapshot };
          for await (const data of att.deltas) {
            yield { kind: "delta" as const, data };
          }
        },
      },
      cwd: {
        source: async function* (input, signal) {
          for await (const cwd of host.subscribeCwd(input.id, signal)) {
            yield { cwd };
          }
        },
      },
      title: {
        source: async function* (input, signal) {
          for await (const title of host.subscribeTitle(input.id, signal)) {
            yield { title };
          }
        },
      },
      commandRun: {
        source: async function* (input, signal) {
          for await (const command of host.subscribeCommandRun(
            input.id,
            signal,
          )) {
            yield { command };
          }
        },
      },
      // Foreground samples — subscribe-before-snapshot, then a current
      // snapshot so a (re)connecting kolu-server warms its foreground cache
      // immediately, then live deltas. A duplicate snapshot is harmless (the
      // consumer's reconcile is idempotent).
      foreground: {
        source: async function* (input, signal) {
          const sub = host.subscribeForeground(input.id, signal);
          yield {
            process: host.getProcess(input.id) ?? "",
            foregroundPid: host.getForegroundPid(input.id),
          };
          for await (const sample of sub) yield sample;
        },
      },
      // Natural exit — yields the exit code once, then the stream ends.
      exit: {
        source: async function* (input, signal) {
          const exitCode = await host.exitPromise(input.id);
          if (signal?.aborted) return;
          yield { exitCode };
        },
      },
    },
    procedures: {
      terminal: {
        // Env layering, ordered least → most authoritative (moved here from
        // kolu-server's `local.ts` — the daemon spawns the shells now):
        //   1. cleanEnv()        — parent env passthrough (Nix devshell filter).
        //   2. koluIdentityEnv() — Kolu's identity vars (stomps parent).
        //   3. shellInit.env     — per-PTY overrides (e.g. ZDOTDIR for zsh).
        spawn: async ({ input }) => {
          const env = cleanEnv();
          const shell = env.SHELL ?? "/bin/sh";
          const cwd = input.cwd || env.HOME || "/";
          Object.assign(env, koluIdentityEnv(pkg.version));
          // kolu-server mints the terminal id and passes it here so the
          // daemon PTY id == kolu-server terminal id (reattach-by-id across a
          // kolu-server restart). Generate one only if absent.
          const id = (input.id ?? randomUUID()) as PtyId;
          const shellInit = prepareShellInit({
            shell,
            home: env.HOME,
            terminalId: id,
            rcDir: koluShellDir,
          });
          Object.assign(env, shellInit.env);
          const res = host.spawn({
            id,
            shell,
            args: shellInit.args,
            env,
            cwd,
            cols: input.cols,
            rows: input.rows,
            scrollback: input.scrollback ?? DEFAULT_SCROLLBACK,
            onDispose: shellInit.cleanup,
          });
          return { id: res.id, pid: res.pid, cwd };
        },
        kill: async ({ input }) => {
          host.kill(input.id);
          return { ok: true };
        },
        killAll: async () => {
          const killed = host.list().length;
          host.dispose();
          return { killed };
        },
        write: async ({ input }) => {
          host.write(input.id, input.data);
          return { ok: true };
        },
        resize: async ({ input }) => {
          host.resize(input.id, input.cols, input.rows);
          return { ok: true };
        },
        list: async () => ({ entries: host.list() }),
        getScreenState: async ({ input }) => {
          // Throw on a missing PTY rather than return "" — an empty string is
          // a legitimate screen state (a PTY that hasn't drawn yet), so
          // masking server/daemon divergence as a blank terminal would hide a
          // real bug. NOT_FOUND lets kolu-server surface it.
          if (!host.getCwd(input.id)) {
            throw new ORPCError("NOT_FOUND", {
              message: `no PTY with id ${input.id}`,
            });
          }
          return { data: host.getScreenState(input.id) };
        },
        getScreenText: async ({ input }) => {
          if (!host.getCwd(input.id)) {
            throw new ORPCError("NOT_FOUND", {
              message: `no PTY with id ${input.id}`,
            });
          }
          return {
            text: host.getScreenText(input.id, input.startLine, input.endLine),
          };
        },
      },
      system: {
        version: async () => ({
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          buildId: currentBuildId(),
          pid: process.pid,
          startedAt,
        }),
        heartbeat: async () => ({ ts: Date.now() }),
      },
    },
  });

  // `implementSurface` returns a fragment under the `surface` key; passing it
  // straight to `StandardRPCHandler` double-prefixes the path
  // (`/surface/surface/...`) and every RPC 404s. Re-wrap once via
  // `implement(contract).router(...)` to flatten the prefix.
  const router = implement(ptyHostSurface.contract).router({
    ...fragment.router,
  });

  // Unlink any stale socket file before binding (a previous daemon that
  // crashed without its SIGTERM cleanup would leave one behind).
  rmSync(socketPath, { force: true });

  const server = createServer((socket) => {
    log.info("pty-host: client connected");
    socket.on("error", (err) => {
      log.warn({ err: err.message }, "pty-host: socket error");
    });
    // Serve the shared router over this connection. The host (and its PTYs)
    // is process-wide, so each accepted socket — including a kolu-server
    // reconnect — sees the same terminals.
    void serveOverStdio({
      // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread doesn't match Router<any, T> exactly; runtime shape is valid (same cast as kolu/server.ts and remote-process-monitor).
      router: router as any,
      transport: { read: socket, write: socket },
      onFirstRequest: () => log.info("pty-host: first RPC received"),
    }).catch((err) =>
      log.error(
        { err: (err as Error).message },
        "pty-host: serveOverStdio threw",
      ),
    );
  });

  server.on("error", (err) => {
    log.error({ err: err.message }, "pty-host: server error");
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    log.info("pty-host: SIGTERM — shutting down");
    host.dispose();
    server.close();
    try {
      unlinkSync(socketPath);
    } catch {
      // already gone
    }
    try {
      unlinkSync(pidFile);
    } catch {
      // already gone
    }
    process.exit(0);
  });

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o700);
    } catch {
      // best-effort tighten; the parent dir is already 0700
    }
    log.info({ socketPath, pid: process.pid }, "pty-host daemon listening");
  });
}
