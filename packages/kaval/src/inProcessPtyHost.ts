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
 * The consumer (kolu-server's `terminalEndpoint/local.ts`) holds the returned
 * `PtyHostClient` and is written against that type alone. A later phase swaps
 * only the link — this same `implementSurface` body is served over a unix
 * socket by the surviving `kolu --stdio` daemon (`serveOverStdio`), and the
 * consumer connects a socket-backed client of the identical type — so nothing
 * downstream changes. See `docs/atlas/src/content/atlas/pty-daemon.mdx`.
 *
 * Host-specific config (`rcDir`) is **injected**, not imported: the package
 * owns the PTY + the contract + the serving, but not kolu-server's runtime
 * paths. In-process the caller passes its own; the future daemon computes its
 * own. The `spawn` handler derives **nothing** from policy — env, argv, and the
 * wrapper rcfiles all arrive fully specified on the wire (B0, the kaval
 * inversion). The host's only spawn-time jobs are *write the init files it is
 * given under `rcDir`* (cleaned up when the PTY exits) and *spawn the argv
 * verbatim*. Host facts a client needs to compose that policy — login shell,
 * `$HOME`, platform, `rcDir` — are served read-only on `system.info`.
 */

import { randomUUID } from "node:crypto";
import { homedir, platform, userInfo } from "node:os";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import type { ContractRouterClient } from "@orpc/contract";
import { implement, ORPCError, type Router } from "@orpc/server";
import { currentPtyHostIdentity } from "./buildId.ts";
import { removeInitFiles, writeInitFiles } from "./initFiles.ts";
import type { Logger } from "@kolu/surface-daemon";
import { createPtyHost, type PtyId, type PtyListEntry } from "./ptyHost.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostListEntry,
  ptyHostSurface,
} from "./ptyHostSurface.ts";

/** Map a host {@link PtyListEntry} to the wire {@link PtyHostListEntry} — the one
 *  place the two shapes are bridged, annotated to the inferred wire type so a
 *  host/schema drift is a compile error here, not a silent zod field-strip
 *  (adding a field to `TerminalListEntrySchema` without populating it, or
 *  dropping one from `PtyListEntry`, fails to type-check). Both `list` and the
 *  `inventory` snapshot/created frames funnel through it. */
function toWireEntry(e: PtyListEntry): PtyHostListEntry {
  return {
    id: e.id,
    pid: e.pid,
    cwd: e.cwd,
    lastActivity: e.lastActivity,
    title: e.title,
    foregroundProcess: e.foregroundProcess,
  };
}

/** The typed client for talking to a pty-host. In-process today (this module);
 *  the identical type backs a socket-served daemon later — so the consumer is
 *  invariant under that swap. */
export type PtyHostClient = ContractRouterClient<
  typeof ptyHostSurface.contract
>;

/** The host's own login-shell fact, with the host-side fallback formula owned
 *  once: the live `$SHELL`, else the passwd entry's shell, else `/bin/sh`. The
 *  result is contractually a non-empty string, so clients composing spawn
 *  policy against `system.info` need no further `/bin/sh` fallback. */
function hostShell(): string {
  return process.env.SHELL || userInfo().shell || "/bin/sh";
}

/** The host's own `$HOME` fact, with the host-side fallback formula owned once:
 *  the live `$HOME`, else the passwd entry's home, else `/`. */
function hostHome(): string {
  return process.env.HOME || homedir() || "/";
}

export interface InProcessPtyHostDeps {
  log: Logger;
  /** Directory under which the host materialises `spawn`'s `initFiles` (the
   *  per-PTY wrapper rc files). Injected by the host so this module needs no
   *  `kolu-server` runtime-path import; surfaced to clients on `system.info`
   *  so they can name init files and point `argv`/`env` at their paths. */
  rcDir: string;
}

/** Serve `ptyHostSurface` over a fresh `createPtyHost` — the **transport-
 *  agnostic** half of the serving. Returns `implementSurface`'s `{ router,
 *  ctx }`: feed the router to `directLink` for an in-process client (below),
 *  or to `serveOverStdio` for the socket daemon / ssh host later. The
 *  `createPtyHost` instance is captured by the surface handlers, so it owns
 *  every local PTY for as long as the router (and any client over it) lives —
 *  one host per call. */
export function servePtyHost(deps: InProcessPtyHostDeps) {
  const { log, rcDir } = deps;
  const host = createPtyHost({ log });
  const startedAt = Date.now();

  // The id-existence policy, owned once: a missing PTY is a clean NOT_FOUND
  // (not `requireEntry`'s opaque internal error). kaval-tui's attach re-attach
  // loop leans on this shape — NOT_FOUND reads as "the PTY is gone" (vs a
  // dropped stream) and falls through to the exit tombstone for the real code.
  // Handlers below compose this rather than each re-deriving it (`exit` alone
  // opts out — see its comment).
  const requirePty = (id: PtyId): void => {
    if (!host.has(id)) {
      throw new ORPCError("NOT_FOUND", { message: `no PTY with id ${id}` });
    }
  };

  const surface = implementSurface(ptyHostSurface, {
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
      // kaval-tui fetches the exit tombstone AFTER the PTY is gone.
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
      // Host-global membership feed — a snapshot of every live PTY first
      // (snapshot-then-deltas, streaming.md §2), then created/exited deltas as
      // other clients spawn or end PTYs. SUBSCRIBE before the snapshot (the
      // Channel's eager-subscribe): a spawn racing the pair is then delivered as
      // a delta rather than dropped. A create caught in BOTH the snapshot and a
      // delta is harmless — the consumer's adoption is idempotent (its registry
      // guard). Takes no id, so it is deliberately not `requirePty`-guarded.
      inventory: {
        source: async function* (_input, signal) {
          const deltas = host.subscribeInventory(signal);
          yield {
            kind: "snapshot" as const,
            entries: host.list().map(toWireEntry),
          };
          for await (const ev of deltas) {
            yield ev.kind === "created"
              ? { kind: "created" as const, entry: toWireEntry(ev.entry) }
              : ev; // exited — { kind, id } is already the wire shape
          }
        },
      },
    },
    procedures: {
      terminal: {
        // The spawn is fully specified by the client (B0): argv, env, and the
        // wrapper rcfiles all arrive on the wire. The host derives nothing from
        // policy — it materialises the init files under its own rcDir (removing
        // them when the PTY exits) and spawns argv[0] with argv[1..] verbatim.
        spawn: async ({ input }) => {
          // The caller mints the terminal id and passes it here so the
          // pty-host's PTY id == the caller's terminal id (reattach-by-id
          // across a restart, later). Generate one only if absent.
          const id = (input.id ?? randomUUID()) as PtyId;
          // argv is `.min(1)` in the schema, so [0] is always present; the
          // guard satisfies the type and turns a malformed wire frame into a
          // clean error rather than spawning `undefined`.
          const [program, ...args] = input.argv;
          if (program === undefined) {
            throw new ORPCError("BAD_REQUEST", { message: "argv is empty" });
          }
          const written = writeInitFiles(rcDir, input.initFiles);
          let res: ReturnType<typeof host.spawn>;
          try {
            res = host.spawn({
              id,
              shell: program,
              args,
              env: input.env,
              cwd: input.cwd,
              cols: input.cols,
              rows: input.rows,
              // `createPtyHost` already applies the in-package default when a
              // client omits this — pass it straight through, don't re-default.
              scrollback: input.scrollback,
              onDispose: () => removeInitFiles(rcDir, written),
            });
          } catch (err) {
            // The PTY never came up, so its `onDispose` will never fire — clean
            // up the init files we wrote for it here, before rethrowing, so a
            // failed spawn leaves nothing behind under `rcDir`.
            removeInitFiles(rcDir, written);
            throw err;
          }
          return { id: res.id, pid: res.pid, cwd: input.cwd };
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
        // Each host entry mapped into the wire shape via `toWireEntry` — the
        // shared bridge (see its doc) that makes a host/schema drift a compile
        // error rather than a silent zod field-strip. The `inventory` stream's
        // snapshot/created frames go through the same map.
        list: async () => ({ entries: host.list().map(toWireEntry) }),
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
        heartbeat: async () => ({
          ts: Date.now(),
          rss: process.memoryUsage().rss,
        }),
        // The host's own facts, read-only — a client composes spawn policy
        // against these (and for a remote host, this is the *only* way it
        // learns the login shell / HOME / rcDir it must target).
        info: async () => ({
          shell: hostShell(),
          home: hostHome(),
          platform: platform(),
          rcDir,
          // The host's own `$PATH`, so a REMOTE client can give the spawned
          // shell a working PATH (a local client already has the same one). A
          // shell with no PATH can't find any external command (`sleep` →
          // exit 127), so the PTY dies on the first one.
          path: process.env.PATH ?? "",
        }),
      },
    },
  });

  // Expose the live-PTY count (sync, off the host) alongside the router, so the
  // daemon's diagnostics can log the terms/heap curve without a round-trip
  // through the wire client. The mirror count is the leak's independent variable
  // (kaval-heap-oom.mdx), so it's the column to watch.
  return { ...surface, terminalCount: () => host.size() };
}

/** The raw `implementSurface` fragment router — the `.router` field of
 *  `servePtyHost`. `directLink` consumes this fragment directly (the
 *  in-process web client); over-the-wire serving needs it wrapped first — see
 *  `createInProcessPtyHost`'s `servedRouter`. */
export type PtyHostRouter = ReturnType<typeof servePtyHost>["router"];

/** Build the in-process pty-host ONCE and return three views of the same host:
 *   - `client` — the no-wire `directLink` client kolu-server's web path uses;
 *   - `servedRouter` — the host's router wrapped in a top-level contract router,
 *     ready to hand straight to `serveOverStdio` (the unix socket for kaval-tui;
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
  /** Live-PTY count (sync) — the daemon's diagnostics samples it. */
  terminalCount: () => number;
} {
  const served = servePtyHost(deps);
  const router = served.router;
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
    terminalCount: served.terminalCount,
  };
}
