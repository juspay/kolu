/**
 * Serving of `ptyHostSurface` — the contract's *implementation*, co-located
 * with the contract (`./ptyHostSurface.ts`) and the primitive (`./ptyHost.ts`)
 * it serves.
 *
 * `servePtyHost` builds the surface router over `createPtyHost` (transport-
 * agnostic — reused over a socket by the daemon and over ssh by R-2), and
 * `servePtyHostRouter` wraps that fragment in a top-level contract router ready
 * to serve over a wire. Every live path now reaches the host over the socket
 * (`servePtyHostOverUnixSocket`): the daemon serves it, and both kolu-server's
 * web path and kolu-tui dial the socket. The no-wire `directLink` client is
 * now a test-only concern — `inProcessPtyHost.test.ts` builds it directly off
 * `servePtyHost(deps).router` to exercise the surface without a socket.
 *
 * The consumer (kolu-server / kolu-tui) holds a `PtyHostClient` and is written
 * against that type alone — the identical type backs the socket-served daemon,
 * so nothing downstream changes when the link is the wire.
 * See `docs/atlas/src/content/atlas/pty-daemon.mdx`.
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

/** The typed client for talking to a pty-host. The same type backs every link
 *  — the socket-served daemon the consumer dials, and the no-wire `directLink`
 *  client the tests build — so the consumer is invariant under the link. */
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
 *  ctx }`: wrap the router with `servePtyHostRouter` to serve it over the wire,
 *  or feed it to `directLink` for the no-wire (test-only) in-process client. The
 *  `createPtyHost` instance is captured by the surface handlers, so it owns
 *  every local PTY for as long as the router (and any client over it) lives —
 *  one host per call. */
export function servePtyHost(deps: InProcessPtyHostDeps) {
  const { log, shellDir, version } = deps;
  const host = createPtyHost({ log });
  const startedAt = Date.now();

  // The id-existence policy, owned once: a missing PTY is a clean NOT_FOUND
  // (not `requireEntry`'s opaque internal error). kolu-tui's attach re-attach
  // loop leans on this shape — NOT_FOUND reads as "the PTY is gone" (vs a
  // dropped stream) and falls through to the exit tombstone for the real code.
  // Handlers below compose this rather than each re-deriving it (`exit` alone
  // opts out — see its comment).
  const requirePty = (id: PtyId): void => {
    if (!host.has(id)) {
      throw new ORPCError("NOT_FOUND", { message: `no PTY with id ${id}` });
    }
  };

  return implementSurface(ptyHostSurface, {
    channel: inMemoryChannelByName(),
    streams: {
      // Per-terminal output — snapshot then live deltas (streaming.md §2).
      terminalAttach: {
        source: async function* (input, signal) {
          requirePty(input.id as PtyId);
          const att = host.attach(input.id, signal);
          yield { kind: "snapshot" as const, data: att.snapshot };
          for await (const data of att.deltas) {
            yield { kind: "delta" as const, data };
          }
        },
      },
      cwd: {
        source: async function* (input, signal) {
          requirePty(input.id as PtyId);
          for await (const cwd of host.subscribeCwd(input.id, signal)) {
            yield { cwd };
          }
        },
      },
      title: {
        source: async function* (input, signal) {
          requirePty(input.id as PtyId);
          for await (const title of host.subscribeTitle(input.id, signal)) {
            yield { title };
          }
        },
      },
      commandRun: {
        source: async function* (input, signal) {
          requirePty(input.id as PtyId);
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
          requirePty(input.id as PtyId);
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
      // RPC, so an intentional kill never yields here). Deliberately NOT
      // guarded by `requirePty`: dead ids are this stream's legitimate input —
      // kolu-tui fetches the exit tombstone AFTER the PTY is gone.
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
          requirePty(input.id as PtyId);
          return { data: host.getScreenState(input.id) };
        },
        getScreenText: async ({ input }) => {
          requirePty(input.id as PtyId);
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
 *  `servePtyHostRouter`. */
export type PtyHostRouter = ReturnType<typeof servePtyHost>["router"];

/** Wrap an `implementSurface` fragment in a top-level contract router so the
 *  `StandardRPCHandler` can route it over the wire (the bare fragment answers
 *  "Not Found"). The fragment's procedure-context type doesn't line up with
 *  `implement().router()`'s contract-derived param, though the runtime shape is
 *  exactly correct — so the cast (and its biome-ignores) live here, once, rather
 *  than at every serving call site (the same unavoidable mismatch as
 *  `serveOverSocket.ts` and mini-ci's served router). */
function asServedRouter(fragment: PtyHostRouter): Router<any, any> {
  return implement(ptyHostSurface.contract).router(
    // biome-ignore lint/suspicious/noExplicitAny: fragment procedure-context vs. contract-derived param mismatch (see above); runtime shape is correct.
    fragment as any,
    // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param (see above).
  ) as Router<any, any>;
}

/** Serve `ptyHostSurface` over a fresh host and return the **contract-wrapped,
 *  top-level router** — ready to hand straight to `servePtyHostOverUnixSocket`
 *  (the surviving daemon) or `serveOverStdio` (the R-2 ssh host). The
 *  a wire server has no use for an in-process `directLink` client, so this
 *  returns *only* the served router (one host per call, owned by the surface
 *  handlers for the router's life). */
export function servePtyHostRouter(
  deps: InProcessPtyHostDeps,
): Router<any, any> {
  return asServedRouter(servePtyHost(deps).router);
}
