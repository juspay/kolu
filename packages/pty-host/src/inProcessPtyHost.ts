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
 * downstream changes. See `docs/atlas/src/content/atlas/pty-daemon.mdx`.
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
import { implement, ORPCError, type Router } from "@orpc/server";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import type { Logger } from "kolu-shared";
import { currentPtyHostIdentity } from "./buildId.ts";
import { createPtyHost, type PtyId } from "./ptyHost.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostListEntry,
  ptyHostSurface,
} from "./ptyHostSurface.ts";

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
        // Map each host entry into the wire shape explicitly (annotated to the
        // inferred type) so a host/schema drift is a compile error here rather
        // than a silent zod field-strip: adding a field to TerminalListEntrySchema
        // without populating it, or dropping one from PtyListEntry, fails to type-check.
        list: async () => ({
          entries: host.list().map(
            (e): PtyHostListEntry => ({
              id: e.id,
              pid: e.pid,
              cwd: e.cwd,
              lastActivity: e.lastActivity,
              title: e.title,
              foregroundProcess: e.foregroundProcess,
            }),
          ),
        }),
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
            text: host.getScreenText(
              input.id,
              input.startLine,
              input.endLine,
              input.tailLines,
            ),
          };
        },
      },
      system: {
        version: async () => ({
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          pid: process.pid,
          startedAt,
          identity: currentPtyHostIdentity(),
        }),
        heartbeat: async () => ({ ts: Date.now() }),
      },
    },
  });
}

/** The raw `implementSurface` fragment router — the `.router` field of
 *  `servePtyHost`. `directLink` consumes this fragment directly (the
 *  in-process web client); over-the-wire serving needs it wrapped first — see
 *  `createInProcessPtyHost`'s `servedRouter`. */
export type PtyHostRouter = ReturnType<typeof servePtyHost>["router"];

/** Build the in-process pty-host ONCE and return three views of the same host:
 *   - `client` — the no-wire `directLink` client kolu-server's web path uses;
 *   - `servedRouter` — the host's router wrapped in a top-level contract router,
 *     ready to hand straight to `serveOverStdio` (the unix socket for kolu-tui;
 *     the ssh stdio for a daemon). The bare fragment can't route over the wire
 *     (the StandardRPCHandler answers "Not Found"), so the wrap lives here —
 *     once, beside the contract it references — rather than at every serving
 *     call site;
 *   - `router` — the raw fragment, for advanced in-process use.
 *  Call once per process; calling twice spawns two independent hosts. */
export function createInProcessPtyHost(deps: InProcessPtyHostDeps): {
  router: PtyHostRouter;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param — the contract-wrapped served router's context type doesn't line up, though the runtime shape is exactly what serving wants.
  servedRouter: Router<any, any>;
  client: PtyHostClient;
} {
  const router = servePtyHost(deps).router;
  // Wrap the implementSurface fragment in a top-level contract router so the
  // StandardRPCHandler can route it over the wire; narrow the result back to
  // the `Router<any, any>` serving wants (the fragment's procedure-context type
  // doesn't line up with implement().router()'s contract-derived param, though
  // the runtime shape is exactly correct — the same unavoidable mismatch as
  // serveOverSocket.ts:125 and mini-ci's served router).
  const servedRouter = implement(ptyHostSurface.contract).router(
    // biome-ignore lint/suspicious/noExplicitAny: fragment procedure-context vs. contract-derived param mismatch (see above); runtime shape is correct.
    router as any,
    // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param (see above).
  ) as Router<any, any>;
  return {
    router,
    servedRouter,
    client: directLink<typeof ptyHostSurface.contract>(router),
  };
}
