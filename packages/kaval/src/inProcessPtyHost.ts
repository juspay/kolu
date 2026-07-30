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
import { implementSurface } from "@kolu/surface/server";
import type { ContractRouterClient } from "@orpc/contract";
import { ORPCError, type Router } from "@orpc/server";
import { currentPtyHostIdentity } from "./buildId.ts";
import { removeInitFiles, writeInitFiles } from "./initFiles.ts";
import type { DaemonLifetimeInfo, Logger } from "@kolu/surface-daemon";
import { createPtyHost, type PtyId, type PtyListEntry } from "./ptyHost.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostIdentity,
  type PtyHostListEntry,
  ptyHostSurface,
} from "./ptyHostSurface.ts";

/** A SIGKILLed PTY should exit immediately. Bound the wire mutation anyway:
 *  node-pty's `kill` API returns void and swallows signal-delivery errors, so
 *  without our own deadline a failed signal would leave callers hung forever. */
const PTY_TERMINATION_TIMEOUT_MS = 8_000;

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
    commandRooted: e.commandRooted,
  };
}

/** The typed client for talking to a pty-host. In-process today (this module);
 *  the identical type backs a socket-served daemon later — so the consumer is
 *  invariant under that swap. */
export type PtyHostClient = ContractRouterClient<
  typeof ptyHostSurface.contract
>;

/** Immutable facts captured once when a pty-host process starts. Both the
 * legacy `system.version` route and the frozen daemon control channel project
 * from this record, so they cannot describe different process builds. */
export interface PtyHostBoot {
  readonly startedAt: number;
  readonly identity: Readonly<PtyHostIdentity>;
}

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
  /** Per-attach-subscriber buffered-chunk cap before a slow consumer is dropped
   *  (and an `overflow` frame emitted). Forwarded to {@link createPtyHost}'s
   *  `dataMaxQueue`; defaults to the {@link Channel} default. Lowered in tests
   *  to drive the drop deterministically. */
  dataMaxQueue?: number;
  /** The daemon's serialized lifetime (`forever` in production; `boundToPid`
   *  under a test/smoke run) — surfaced on `system.version` so padi can mirror it
   *  into the Kaval dialog's lifetime row. Injected by the daemon entrypoint,
   *  which owns the lifetime choice. */
  lifetime: DaemonLifetimeInfo;
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
  const host = createPtyHost({ log, dataMaxQueue: deps.dataMaxQueue });
  const boot: PtyHostBoot = Object.freeze({
    startedAt: Date.now(),
    identity: Object.freeze(currentPtyHostIdentity()),
  });

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

  /** Arm every exit before signaling, force termination, and acknowledge only
   *  after onExit teardown. The deadline converts node-pty's swallowed
   *  process.kill error into a loud wire failure naming the residue. */
  const terminate = async (ids: readonly PtyId[]): Promise<void> => {
    const abort = new AbortController();
    const exits = ids.map((id) => host.exitPromise(id, abort.signal));
    for (const id of ids) host.kill(id, "SIGKILL");

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(exits),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const originalIds = new Set(ids);
            const survivors = host
              .list()
              .map((entry) => entry.id)
              .filter((id) => originalIds.has(id));
            reject(
              new Error(
                `pty-host: termination timed out after ${PTY_TERMINATION_TIMEOUT_MS}ms; surviving ids: ${survivors.join(", ") || "(none in inventory)"}`,
              ),
            );
          }, PTY_TERMINATION_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      // On timeout, deregister every unresolved waiter from its surviving
      // entry. On success the waiters already removed their abort listeners,
      // so this is a no-op.
      abort.abort();
    }
  };

  const surface = implementSurface(ptyHostSurface, {
    streams: {
      // Per-terminal output — snapshot then live deltas (streaming.md §2).
      terminalAttach: {
        source: async function* (input, signal) {
          requirePty(input.id as PtyId);
          // `overflow` flips if THIS subscriber is dropped for lagging past the
          // bound. The deltas then end (the drop pushes CLOSE), so we surface a
          // typed `overflow` frame as the LAST frame — distinct from a graceful
          // end (PTY exit / abort), which yields no such frame. A consumer reads
          // it as "re-attach for a fresh snapshot", not "the PTY is gone".
          let overflow = false;
          const att = host.attach(input.id, signal, {
            onOverflow: () => {
              overflow = true;
            },
            resizeTo: input.resizeTo,
          });
          yield {
            kind: "snapshot" as const,
            data: att.snapshot,
            topLine: att.topLine,
            reflowEpoch: att.reflowEpoch,
          };
          for await (const data of att.deltas) {
            yield { kind: "delta" as const, data };
          }
          if (overflow) yield { kind: "overflow" as const };
        },
      },
      // Host-global meaningful-output edges (resize-excluded at the source). A live
      // edge feed — no snapshot frame (a consumer stamps arrival time and derives
      // its own windows; a missed edge only delays a downstream finish).
      activity: {
        source: async function* (_input, signal) {
          for await (const edge of host.subscribeActivity(signal)) yield edge;
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
      // Preexec command marks — snapshot-then-deltas (streaming.md §2). The
      // last command replays first (`replayed: true`) so a sensor that attaches
      // AFTER the mark (a lazily-attaching or restarted padi) still learns it
      // and resolves a command-only agent like codex; live marks follow with
      // `replayed: false`. The flag is load-bearing, NOT decorative: unlike
      // `foreground`, this stream's consumer has a LIVE-ONLY side effect
      // (recent-agent recency stamps `Date.now()`), so a replay must be
      // distinguishable or a reconnect/late-subscribe would re-bump an old
      // command's recency as if the user just ran it.
      commandRun: {
        source: async function* (input, signal) {
          requirePty(input.id as PtyId);
          const sub = host.subscribeCommandRun(input.id, signal);
          const last = host.getLastCommand(input.id);
          // The snapshot carries the RETAINED command's dialect (it may be a
          // command-rooted seed); every LIVE mark is a raw OSC 633;E line (the
          // seed is published synchronously at spawn, before any subscriber, so it
          // never arrives live) — hence `shellJoin: false` on the live frames.
          if (last !== undefined)
            yield {
              command: last,
              replayed: true,
              shellJoin: host.getLastCommandShellJoin(input.id),
            };
          for await (const command of sub) {
            yield { command, replayed: false, shellJoin: false };
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
              commandRooted: input.commandRooted,
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
        // The consumer aborts the exit tap before calling kill, so an
        // intentional kill stays silent. Arm completion before signaling and
        // do not acknowledge the mutation until onExit has removed the entry:
        // sleep → wake reuses the same id, and an old teardown arriving after
        // the re-spawn would otherwise delete the new PTY. This is explicitly
        // destructive, so use SIGKILL: node-pty's default SIGHUP can lose an
        // immediate post-spawn kill while the child becomes its session leader.
        kill: async ({ input }) => {
          await terminate([input.id]);
          return { ok: true };
        },
        killAll: async () => {
          const ids = host.list().map((e) => e.id);
          // killAll is the reset boundary used by test setup and operators:
          // reporting success while old PTYs still occupy inventory makes the
          // next world race residue.
          await terminate(ids);
          return { killed: ids.length };
        },
        write: async ({ input }) => {
          host.write(input.id, input.data);
          return { ok: true };
        },
        // `ok` is the host's own answer, not a constant: FALSE means there was
        // no such PTY to resize (it exited before this call arrived), so the
        // caller's grid claim did not land on anything. Callers treat that as
        // the expected killed-terminal race; a REJECTION is the real failure.
        resize: async ({ input }) => ({
          ok: host.resize(input.id, input.cols, input.rows),
        }),
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
          return { text: host.getScreenText(input.id, input.extent) };
        },
        getHistory: async ({ input }) => {
          requirePty(input.id as PtyId);
          return host.getHistory(
            input.id,
            input.before,
            input.max,
            input.epoch,
          );
        },
      },
      system: {
        version: async () => ({
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          pid: process.pid,
          startedAt: boot.startedAt,
          identity: boot.identity,
          lifetime: deps.lifetime,
        }),
        heartbeat: async () => ({
          ts: Date.now(),
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
  return {
    ...surface,
    // The daemon's frozen control hello and legacy `system.version` must name
    // the SAME boot. Expose the one captured record to the daemon composition.
    boot,
    terminalCount: () => host.size(),
    // Shutdown reaps every live PTY. node-pty `setsid`s each PTY into its own
    // session, so a process-group kill of the daemon can NEVER reach the
    // spawn-helper/shell subtree — only the host disposing each entry does.
    // The surface runtime's own `close` releases nothing today, so before this
    // the daemon's graceful shutdown (pid-gone self-exit / SIGTERM / abort —
    // daemonMain's `.finally` awaits this close) left those children orphaned to
    // init, leaking node-pty processes across CI runs and loading the box (the
    // darwin-under-load flake substrate). This is the "daemon owns shutdown by
    // construction" the close handle was exposed for. `dispose()` is idempotent.
    close: async () => {
      host.dispose();
      await surface.close();
    },
  };
}

/** The FINAL top-level router — the `.router` field of `servePtyHost`'s
 *  {@link SurfaceRuntime}. `directLink` consumes it (the in-process web client)
 *  AND it serves straight over the wire (`serveOverStdio` / the unix socket) —
 *  no per-call-site re-wrap. */
export type PtyHostRouter = ReturnType<typeof servePtyHost>["router"];

/** Build the in-process pty-host ONCE and return several views of the same host:
 *   - `client` — the no-wire `directLink` client kolu-server's web path uses;
 *   - `servedRouter` — the FINAL top-level router, ready to hand straight to
 *     `serveOverStdio` (the unix socket for kaval-tui; the ssh stdio for a
 *     daemon). It is `router` — `implementSurface` already finalized it, so
 *     there is no fragment to wrap;
 *   - `router` — the same final router, for advanced in-process use;
 *   - `done` / `close` — the surface runtime's supervision handles. The
 *     ptyHost surface declares no cell connectors, so `done` is inert (nothing
 *     to fault); `close` disposes every live PTY and then closes the surface
 *     runtime, so a shutting-down daemon reaps its node-pty children instead of
 *     orphaning them — the daemon owning shutdown by construction.
 *  Call once per process; calling twice spawns two independent hosts. */
export function createInProcessPtyHost(deps: InProcessPtyHostDeps): {
  router: PtyHostRouter;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param — the runtime's router context type doesn't line up, though the runtime shape is exactly what serving wants.
  servedRouter: Router<any, any>;
  client: PtyHostClient;
  /** The one boot record shared by `system.version` and control-core hello. */
  readonly boot: PtyHostBoot;
  /** Live-PTY count (sync) — the daemon's diagnostics samples it. */
  terminalCount: () => number;
  /** Rejects on an owned surface fault (inert today — no cell connectors). */
  done: Promise<void>;
  /** Dispose every live PTY, then release the surface runtime's owned sources.
   *  Idempotent. This is what makes daemon shutdown reap its node-pty children. */
  close(): Promise<void>;
} {
  const served = servePtyHost(deps);
  // `implementSurface` returns the FINAL top-level router (opaque `unknown` at
  // the runtime boundary) — `directLink` AND the over-the-wire
  // StandardRPCHandler both consume it directly, no re-wrap. Narrow it once here
  // to the router shape both consumers want.
  // biome-ignore lint/suspicious/noExplicitAny: SurfaceRuntime.router is opaque; the runtime shape is a valid top-level router, same cast every serving site uses.
  const router = served.router as Router<any, any>;
  return Object.freeze({
    router,
    servedRouter: router,
    client: directLink<typeof ptyHostSurface.contract>(router),
    boot: served.boot,
    terminalCount: served.terminalCount,
    done: served.done,
    close: served.close,
  });
}
