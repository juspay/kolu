/**
 * The in-process `@kolu/pty-host`, consumed through its own wire contract.
 *
 * kolu-server owns the PTYs in-process today, but it talks to them through
 * `ptyHostSurface` — the same typed contract a surviving daemon (over a unix
 * socket) or a remote ssh pty-host will later serve. The link here is the
 * *identity* one: `inProcessSurfaceClient` composes the surface handlers with
 * a direct `createRouterClient`, so `client.surface.terminal.spawn(...)` is a
 * direct (microtask-deferred) call into `createPtyHost`, with no wire. The
 * point of routing through the contract now — rather than calling `PtyHost`
 * methods directly — is that the *consumer* (`./local.ts`) is written against
 * `PtyHostClient`, so a later step swaps only this module (in-process →
 * socket-served) and the consumer is unchanged. See
 * `docs/plans/remote-terminals.pty-daemon.html` (#fresh-approach).
 *
 * Env layering for spawned shells lives in the `spawn` handler here — the
 * pty-host owns the shells it forks, so it (not kolu-server) prepares their
 * environment. Across a socket the contract carries no env; the host fills it.
 */

import {
  createPtyHost,
  type PtyId,
  PTY_HOST_CONTRACT_VERSION,
  ptyHostSurface,
} from "@kolu/pty-host";
import {
  inMemoryChannelByName,
  inProcessSurfaceClient,
} from "@kolu/surface/server";
import { randomUUID } from "node:crypto";
import type { ContractRouterClient } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import type { Logger } from "kolu-shared";
import pkg from "../../package.json" with { type: "json" };
import { koluShellDir } from "../koluRoot.ts";

/** The typed client for talking to a pty-host. In-process today (this module);
 *  the identical type backs a socket-served daemon later — so the consumer is
 *  invariant under that swap. */
export type PtyHostClient = ContractRouterClient<
  typeof ptyHostSurface.contract
>;

/** Build the in-process pty-host and return a contract-typed client over it.
 *  The `createPtyHost` instance is captured by the surface handlers (held for
 *  the process's life via the returned client), so it owns every local PTY for
 *  as long as kolu-server runs — one host per process. */
export function createInProcessPtyHost(deps: { log: Logger }): PtyHostClient {
  const { log } = deps;
  const host = createPtyHost({ log });
  const startedAt = Date.now();

  const { client } = inProcessSurfaceClient(ptyHostSurface, {
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
          } catch {
            // Aborted (teardown) — end quietly; the waiter is already removed.
            return;
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
          Object.assign(env, koluIdentityEnv(pkg.version));
          // kolu-server mints the terminal id and passes it here so the
          // pty-host's PTY id == kolu-server's terminal id (reattach-by-id
          // across a kolu-server restart, later). Generate one only if absent.
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
        // No kill-then-wait here (that's a reattach concern): the consumer
        // (`./local.ts`) aborts the exit tap before calling kill, so an
        // intentional kill stays silent. The kill RPC's response drives the
        // UI cleanup.
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
        }),
        heartbeat: async () => ({ ts: Date.now() }),
      },
    },
  });

  return client;
}
