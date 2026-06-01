/**
 * In-process serving of `ptyHostSurface` — the **identity link**.
 *
 * This is the contract's *implementation*, co-located with the contract
 * (`./ptyHostSurface.ts`) and the primitive (`./ptyHost.ts`) it serves.
 * `servePtyHost` builds the surface router over `createPtyHost` (transport-
 * agnostic — reused over a socket by the daemon and over ssh by R-2), and the
 * in-process client closes the loop with `directLink`, the no-wire member of
 * the surface link family — so `client.surface.terminal.spawn(...)` is a
 * direct (microtask-deferred) call into the host, no serialization.
 *
 * The consumer (kolu-server's `terminalBackend/local.ts`) holds the returned
 * `PtyHostClient` and is written against that type alone. A later phase swaps
 * only the link — this same `implementSurface` body is served over a unix
 * socket by the surviving `kolu --stdio` daemon (`serveOverStdio`), and the
 * consumer connects a socket-backed client of the identical type — so nothing
 * downstream changes. See `docs/plans/remote-terminals.pty-daemon.html`.
 *
 * Host-specific config (`shellDir`, `version`) is **injected**, not imported:
 * the package owns the PTY + the contract + the serving, but not kolu-server's
 * runtime paths. In-process the caller passes its own shell-dir; the future
 * daemon computes its own (from `kolu-shared`, the one relocation deferred to
 * that phase). Env/shell-init prep lives in the `spawn` handler because the
 * pty-host owns the shells it forks — across a socket the contract carries no
 * env, so the host fills it.
 */

import { randomUUID } from "node:crypto";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import type { ContractRouterClient } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import type { Logger } from "kolu-shared";
import { currentBuildId, currentCommitHash } from "./buildId.ts";
import { createPtyHost, type PtyId } from "./ptyHost.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

/** The typed client for talking to a pty-host. In-process today (this module);
 *  the identical type backs a socket-served daemon later — so the consumer is
 *  invariant under that swap. */
export type PtyHostClient = ContractRouterClient<
  typeof ptyHostSurface.contract
>;

export interface InProcessPtyHostDeps {
  log: Logger;
  /** Directory for the per-PTY wrapper rc files (`prepareShellInit`'s rcDir).
   *  Injected by the host so this module needs no `kolu-server` runtime-path
   *  import (which would be an import cycle). */
  shellDir: string;
  /** kolu version string, baked into each spawned shell's identity env. */
  version: string;
}

/** Serve `ptyHostSurface` over a fresh `createPtyHost` — the **transport-
 *  agnostic** half of the serving. Returns `implementSurface`'s `{ router,
 *  ctx }`: feed the router to `directLink` for an in-process client (below),
 *  or to `serveOverStdio` for the socket daemon / ssh host later. The
 *  `createPtyHost` instance is captured by the surface handlers, so it owns
 *  every local PTY for as long as the router (and any client over it) lives —
 *  one host per call. */
export function servePtyHost(deps: InProcessPtyHostDeps) {
  const { log, shellDir, version } = deps;
  const host = createPtyHost({ log });
  const startedAt = Date.now();

  return implementSurface(ptyHostSurface, {
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
      // Foreground samples — a current snapshot first so a freshly-wired
      // consumer warms its cache immediately, then live deltas (a duplicate
      // snapshot is harmless: the consumer's reconcile is idempotent).
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
      // Natural exit — yields the exit code once, then ends. The signal aborts
      // the host-side waiter on teardown (a kill aborts this before the kill
      // RPC, so an intentional kill never yields here).
      exit: {
        source: async function* (input, signal) {
          try {
            const exitCode = await host.exitPromise(input.id, signal);
            yield { exitCode };
          } catch (err) {
            // Abort (teardown / socket close) is the EXPECTED rejection — end
            // quietly; the waiter is already removed. Anything else is not:
            // in-process `exitPromise` only rejects on abort, but a
            // socket-served one could reject on transport error, and silently
            // ending the stream there would leave the consumer's terminal
            // never cleaned up. Surface it instead of swallowing.
            if (signal?.aborted) return;
            log.error(
              { err, id: input.id },
              "pty-host exitPromise rejected unexpectedly (non-abort)",
            );
            throw err;
          }
        },
      },
    },
    procedures: {
      terminal: {
        // Env layering, ordered least → most authoritative (the pty-host
        // spawns the shells, so it prepares their env):
        //   1. cleanEnv()        — parent env passthrough (Nix devshell filter).
        //   2. koluIdentityEnv() — Kolu's identity vars (stomps parent).
        //   3. shellInit.env     — per-PTY overrides (e.g. ZDOTDIR for zsh).
        spawn: async ({ input }) => {
          const env = cleanEnv();
          const shell = env.SHELL ?? "/bin/sh";
          const cwd = input.cwd || env.HOME || "/";
          Object.assign(env, koluIdentityEnv(version));
          // The caller mints the terminal id and passes it here so the
          // pty-host's PTY id == the caller's terminal id (reattach-by-id
          // across a restart, later). Generate one only if absent.
          const id = (input.id ?? randomUUID()) as PtyId;
          const shellInit = prepareShellInit({
            shell,
            home: env.HOME,
            terminalId: id,
            rcDir: shellDir,
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
        // No kill-then-wait here (that's a reattach concern): the consumer
        // aborts the exit tap before calling kill, so an intentional kill stays
        // silent. The kill RPC's response drives the UI cleanup.
        kill: async ({ input }) => {
          host.kill(input.id);
          return { ok: true };
        },
        killAll: async () => {
          const ids = host.list().map((e) => e.id);
          for (const id of ids) host.kill(id);
          return { killed: ids.length };
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
          // masking a divergence as a blank terminal would hide a real bug.
          if (!host.has(input.id)) {
            throw new ORPCError("NOT_FOUND", {
              message: `no PTY with id ${input.id}`,
            });
          }
          return { data: host.getScreenState(input.id) };
        },
        getScreenText: async ({ input }) => {
          if (!host.has(input.id)) {
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
          pid: process.pid,
          startedAt,
          identity: {
            staleKey: currentBuildId(),
            navigableCommit: currentCommitHash(),
          },
        }),
        heartbeat: async () => ({ ts: Date.now() }),
      },
    },
  });
}

/** The transport-agnostic pty-host router — the `.router` field of
 *  `servePtyHost`. The same value feeds `directLink` (the in-process web
 *  client) AND `serveOverStdio` (a unix-socket listener for `kolu-tui`), so
 *  both transports share one PTY host. */
export type PtyHostRouter = ReturnType<typeof servePtyHost>["router"];

/** Build the in-process pty-host ONCE and return both its router (the
 *  transport-agnostic seam) and a contract-typed identity-link client over
 *  it. kolu-server consumes `.client` for the web path (no wire, via
 *  `directLink`) and serves the SAME `.router` over a unix socket for
 *  `kolu-tui` (R-4 Phase 1) — one PTY host, two transports, byte-identical
 *  handlers. Call this once per process; calling it twice spawns two
 *  independent hosts. */
export function createInProcessPtyHost(deps: InProcessPtyHostDeps): {
  router: PtyHostRouter;
  client: PtyHostClient;
} {
  const router = servePtyHost(deps).router;
  return {
    router,
    client: directLink<typeof ptyHostSurface.contract>(router),
  };
}

/** Build the in-process pty-host and return a contract-typed client over it —
 *  the **identity link**: `directLink` consumes `servePtyHost`'s router with
 *  no wire, so the consumer (kolu-server) holds the exact `PtyHostClient` type
 *  a socket-served daemon would later hand it. Swapping `directLink` for a
 *  socket link is the only change that decoupling needs. (Prefer
 *  `createInProcessPtyHost` when you also need the router to serve over a
 *  socket — this is the client-only shorthand.) */
export function createInProcessPtyHostClient(
  deps: InProcessPtyHostDeps,
): PtyHostClient {
  return createInProcessPtyHost(deps).client;
}
