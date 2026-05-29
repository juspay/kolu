/**
 * The `kolu --stdio` local-PTY-host **daemon** (R4c).
 *
 * Same kolu binary as the HTTP server, branched at `--stdio` before any
 * HTTP setup. It WRAPS the in-process R4b agent (`../terminalBackend/agent.ts`,
 * `createAgent`): the agent already owns `@kolu/pty-host` AND the per-terminal
 * provider DAG, so the daemon's only job is to *encode* that already-drawn
 * boundary onto a unix socket. R4c is an encoding, not a new boundary.
 *
 * It serves the `agentSurface` contract (`kolu-common/agentSurface`) over
 * `$KOLU_STATE_DIR/agent.sock` so kolu-server (and a second kolu-server on
 * the same state dir after a restart) connects via the socket and reattaches
 * to the same live PTYs.
 *
 * Lifecycle:
 *  1. `tryAcquirePidFile` — atomic single-instance gate (acquired BEFORE
 *     binding the socket so only one daemon per state dir owns the PTYs).
 *  2. `ensureKoluRoot` — the per-terminal shell rc files live in the
 *     daemon's koluRoot (the daemon spawns the shells, so it writes them).
 *  3. `createAgent({ log })` — the in-process owner of every local PTY +
 *     its provider DAG.
 *  4. Build the `agentSurface` router ONCE (its stream sources close over
 *     the shared agent), then serve that same router over every accepted
 *     socket connection. The agent is shared across connections, so a
 *     kolu-server restart sees the same PTYs and warm metadata.
 *  5. Clean up on SIGTERM — dispose the agent, unlink socket + pid file.
 *
 * **The socket is the wire, not stdout.** The daemon's stdout/stderr are
 * redirected into `agent.log` by the supervisor's fd redirect, so pino
 * logging to stdout is fine here — unlike a stdio agent, this daemon does
 * NOT use process.stdout as the protocol channel.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, rmSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import { implement } from "@orpc/server";
import { AGENT_CONTRACT_VERSION, agentSurface } from "kolu-common/agentSurface";
import type { TerminalId } from "kolu-common/surface";
import type { TerminalHandle } from "kolu-common/terminalBackend";
import {
  cleanEnv,
  configureNixShellEnv,
  koluIdentityEnv,
  prepareShellInit,
} from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { tryAcquirePidFile } from "../daemon/daemonUtils.ts";
import { ensureKoluRoot, koluShellDir } from "../koluRoot.ts";
import { daemonPaths } from "../koluState.ts";
import { log } from "../log.ts";
// The persisted/live metadata projections are owned by `agent.ts` (it owns
// `TerminalServerMetadata`), so importing them keeps the exhaustiveness
// compile-check single-source across the daemon ⇆ kolu-server boundary.
import {
  createAgent,
  liveFields,
  persistedFields,
} from "../terminalBackend/agent.ts";

/** Daemon entrypoint — dispatched from `index.ts` on `--stdio`. */
export async function runAgent(): Promise<void> {
  // The daemon spawns the PTY shells, so it owns the nix-devshell env
  // filter — and it's a SEPARATE process from kolu-server, so the server's
  // `configureNixShellEnv` module state doesn't reach here. kolu-server
  // exports its resolved whitelist via `KOLU_NIX_SHELL_WHITELIST` when
  // spawning us (set in `server.ts`); absent in production → the
  // production safety net (passthrough unless `IN_NIX_SHELL`) applies, same
  // as kolu-server with no flag. Must run before the first `cleanEnv()`.
  configureNixShellEnv(process.env.KOLU_NIX_SHELL_WHITELIST);

  const { pidFile, socketPath } = daemonPaths();

  // Single-instance gate, acquired BEFORE binding the socket so only one
  // daemon per `$KOLU_STATE_DIR` ever owns the PTYs. A losing race exits
  // quietly — the winning daemon is the one kolu-server connects to.
  if (!tryAcquirePidFile(pidFile)) {
    log.info({ pidFile }, "agent: another daemon owns the pid file — exiting");
    process.exit(0);
  }

  // The per-terminal shell rc files live in the daemon's koluRoot — the
  // daemon spawns the shells, so it writes (and cleans up) their rc files.
  ensureKoluRoot();

  const startedAt = Date.now();
  const agent = createAgent({ log });

  // id → byte-stream control handle (write/resize/getScreenState/
  // getScreenText). `agent.spawn` returns the handle; we hold it so the
  // imperative RPCs below can reach the right PTY. Same lifetime as the
  // terminal — dropped on kill / killAll.
  const handles = new Map<TerminalId, TerminalHandle>();

  const fragment = implementSurface(agentSurface, {
    channel: inMemoryChannelByName(),
    streams: {
      // Per-terminal output — snapshot then live deltas (streaming.md §2).
      terminalAttach: {
        source: async function* (input, signal) {
          const att = agent.attach(input.id, signal);
          yield { kind: "snapshot" as const, data: att.snapshot };
          for await (const data of att.deltas) {
            yield { kind: "delta" as const, data };
          }
        },
      },
      // The single multiplexed metadata + lifecycle stream. EAGER-SUBSCRIBE
      // before snapshotting: register the live subscription FIRST so events
      // fired between the snapshot and the subscribe are buffered rather
      // than lost (subscribe-before-snapshot is load-bearing — duplicates
      // are harmless under the consumer's idempotent Object.assign, MISSING
      // events are the danger). Then replay current state as
      // `metadataPersisted` + `metadataLive` per live terminal so a
      // reconnecting kolu-server gets warm metadata without a re-detection
      // storm, then forward live deltas.
      agentMetadata: {
        source: async function* (_input, signal) {
          const sub = agent.metadata.subscribe(signal);
          for (const { id, meta } of agent.snapshot()) {
            yield {
              kind: "metadataPersisted" as const,
              id,
              fields: persistedFields(meta),
            };
            yield {
              kind: "metadataLive" as const,
              id,
              fields: liveFields(meta),
            };
          }
          for await (const ev of sub) yield ev;
        },
      },
    },
    procedures: {
      terminal: {
        // Env layering, ordered least → most authoritative (moved here
        // from kolu-server's `local.ts` — the daemon spawns the shells now):
        //   1. cleanEnv()        — parent env passthrough (Nix devshell filter).
        //   2. koluIdentityEnv() — Kolu's identity vars (stomps parent).
        //   3. shellInit.env     — per-PTY overrides (e.g. ZDOTDIR for zsh).
        spawn: async ({ input }) => {
          const env = cleanEnv();
          const shell = env.SHELL ?? "/bin/sh";
          const cwd = input.cwd || env.HOME || "/";
          Object.assign(env, koluIdentityEnv(pkg.version));
          // kolu-server mints the terminal id and passes it here so the
          // daemon PTY id == kolu-server terminal id (reattach-by-id across
          // a kolu-server restart). Generate one only if absent.
          const id = (input.id ?? randomUUID()) as TerminalId;
          const shellInit = prepareShellInit({
            shell,
            home: env.HOME,
            terminalId: id,
            rcDir: koluShellDir,
          });
          Object.assign(env, shellInit.env);
          const res = agent.spawn({
            id,
            shell,
            args: shellInit.args,
            env,
            cwd,
            cols: input.cols,
            rows: input.rows,
            scrollback: input.scrollback,
            onDispose: shellInit.cleanup,
            restoredActivityAt: input.restoredActivityAt,
          });
          handles.set(res.id, res.handle);
          return { id: res.id, pid: res.pid, meta: res.meta };
        },
        kill: async ({ input }) => {
          agent.kill(input.id);
          handles.delete(input.id);
          return { ok: true };
        },
        killAll: async () => {
          const killed = agent.list().length;
          agent.killAll();
          handles.clear();
          return { killed };
        },
        write: async ({ input }) => {
          const handle = handles.get(input.id);
          handle?.write(input.data);
          return { ok: handle !== undefined };
        },
        resize: async ({ input }) => {
          const handle = handles.get(input.id);
          handle?.resize(input.cols, input.rows);
          return { ok: handle !== undefined };
        },
        list: async () => ({ entries: agent.list() }),
        getScreenState: async ({ input }) => ({
          data: (await handles.get(input.id)?.getScreenState()) ?? "",
        }),
        getScreenText: async ({ input }) => ({
          text:
            (await handles
              .get(input.id)
              ?.getScreenText(input.startLine, input.endLine)) ?? "",
        }),
      },
      system: {
        version: async () => ({
          contractVersion: AGENT_CONTRACT_VERSION,
          pkgVersion: pkg.version,
          pid: process.pid,
          startedAt,
        }),
        heartbeat: async () => ({ ts: Date.now() }),
      },
    },
  });

  // `implementSurface` returns a fragment under the `surface` key; passing
  // it straight to `StandardRPCHandler` double-prefixes the path
  // (`/surface/surface/...`) and every RPC 404s. Re-wrap once via
  // `implement(contract).router(...)` to flatten the prefix.
  const router = implement(agentSurface.contract).router({
    ...fragment.router,
  });

  // Unlink any stale socket file before binding (a previous daemon that
  // crashed without its SIGTERM cleanup would leave one behind).
  rmSync(socketPath, { force: true });

  const server = createServer((socket) => {
    log.info("agent: client connected");
    socket.on("error", (err) => {
      log.warn({ err: err.message }, "agent: socket error");
    });
    // Serve the shared router over this connection. The agent (and its
    // PTYs) is process-wide, so each accepted socket — including a
    // kolu-server reconnect — sees the same terminals.
    void serveOverStdio({
      // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread doesn't match Router<any, T> exactly; runtime shape is valid (same cast as kolu/server.ts and remote-process-monitor).
      router: router as any,
      transport: { read: socket, write: socket },
      onFirstRequest: () => log.info("agent: first RPC received"),
    }).catch((err) =>
      log.error({ err: (err as Error).message }, "agent: serveOverStdio threw"),
    );
  });

  server.on("error", (err) => {
    log.error({ err: err.message }, "agent: server error");
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    log.info("agent: SIGTERM — shutting down");
    agent.dispose();
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
    log.info({ socketPath, pid: process.pid }, "agent listening");
  });
}
