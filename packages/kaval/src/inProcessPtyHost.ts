/**
 * In-process serving of `ptyHostSurface` — the **identity link**.
 *
 * This is the contract's *implementation*, co-located with the contract
 * (`./ptyHostSurface.ts`) and the primitive (`./ptyHost.ts`) it serves.
 * `servePtyHost` builds the surface's `{ group, handlers }` over `createPtyHost`
 * (transport-agnostic — reused over a socket by the daemon and over ssh by R-2),
 * and the in-process client closes the loop with `directDispatch`, the no-wire
 * member of the surface link family — so `client.surface.terminal.spawn(...)` is
 * a direct (microtask-deferred) call into the host, no serialization.
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
import { surfaceClientRef } from "@kolu/surface/project";
import type { PtyHostClient } from "./ptyHostClient.ts";
import { implementSurface, type SurfaceHandlers } from "@kolu/surface/server";
import { Duration, Effect, Fiber, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { currentPtyHostIdentity } from "./buildId.ts";
import type { SubscriberOverflow } from "./fanOut.ts";
import { removeInitFiles, writeInitFiles } from "./initFiles.ts";
import type { DaemonLifetimeInfo, Logger } from "@kolu/surface-daemon";
import { createPtyHost, type PtyId, type PtyListEntry } from "./ptyHost.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  PtyNotFound,
  type PtyHostIdentity,
  type PtyHostListEntry,
  ptyHostSurface,
  SpawnArgvEmpty,
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

/** Re-exported for the many consumers that reach the client type through this
 *  module. Its home is `./ptyHostClient.ts`, beside the way to BUILD one over any
 *  dispatch — the in-process serving here is one caller of that, not its owner. */
export type { PtyHostClient } from "./ptyHostClient.ts";

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
   *  `dataMaxQueue`; defaults to the {@link FanOut} default. Lowered in tests
   *  to drive the drop deterministically. */
  dataMaxQueue?: number;
  /** The daemon's serialized lifetime (`forever` in production; `boundToPid`
   *  under a test/smoke run) — surfaced on `system.version` so padi can mirror it
   *  into the Kaval dialog's lifetime row. Injected by the daemon entrypoint,
   *  which owns the lifetime choice. */
  lifetime: DaemonLifetimeInfo;
}

/** Serve `ptyHostSurface` over a fresh `createPtyHost` — the **transport-
 *  agnostic** half of the serving. Returns `implementSurface`'s
 *  `{ group, handlers, ctx, done, close }`: feed `{ group, handlers }` to
 *  `directDispatch` for an in-process client (below), or to
 *  `serveOverUnixSocket` / `serveOverStdio` for the socket daemon / ssh host.
 *  The `createPtyHost` instance is captured by the surface handlers, so it owns
 *  every local PTY for as long as the runtime (and any client over it) lives —
 *  one host per call. */
export function servePtyHost(deps: InProcessPtyHostDeps) {
  const { log, rcDir } = deps;
  const host = createPtyHost({ log, dataMaxQueue: deps.dataMaxQueue });
  const boot: PtyHostBoot = Object.freeze({
    startedAt: Date.now(),
    identity: Object.freeze(currentPtyHostIdentity()),
  });

  // The id-existence policy, owned once: a missing PTY is a clean, DECLARED
  // `PtyNotFound` (not `requireEntry`'s opaque internal error). kaval-tui's
  // attach re-attach loop leans on this shape — it reads as "the PTY is gone"
  // (vs a dropped stream) and falls through to the exit tombstone for the real
  // code. Handlers below compose this rather than each re-deriving it (`exit`
  // alone opts out — see its comment).
  //
  // Two spellings of ONE rule, because the two member kinds have different
  // failure channels and neither may be faked in the other's terms:
  //   - `requirePtyEffect` FAILS a procedure's Effect with the declared error;
  //   - `requirePtySync` THROWS inside a stream's producer, which the framework
  //     turns into a defect (a `StreamSpec` has no error channel to declare on —
  //     see `PtyNotFound`'s note). Same class, same message, honest disposition.
  const requirePtySync = (id: PtyId): void => {
    if (!host.has(id)) throw new PtyNotFound({ id });
  };
  const requirePtyEffect = (id: PtyId): Effect.Effect<void, PtyNotFound> =>
    host.has(id) ? Effect.void : Effect.fail(new PtyNotFound({ id }));

  /** Arm every exit before signaling, force termination, and acknowledge only
   *  after onExit teardown. The deadline converts node-pty's swallowed
   *  process.kill error into a loud wire failure naming the residue.
   *
   *  `startImmediately` is what makes "arm before signal" true: each waiter
   *  fiber runs up to its registration before the fork returns, so the SIGKILL
   *  below can never land on a PTY nobody is waiting for. The waiters are
   *  CHILDREN of this fiber, so blowing the deadline (or an interruption from
   *  above) tears every one of them down — the `AbortController` + `finally`
   *  this replaces existed for exactly that. */
  const terminate = (ids: readonly PtyId[]): Effect.Effect<void> =>
    Effect.gen(function* () {
      const armed = yield* Effect.forEach(ids, (id) =>
        Effect.forkChild(
          // An id this host has no entry and no tombstone for has NOTHING to
          // wait for — it is already in the state this function exists to reach.
          // That is a local reading of a declared refusal, not a swallowed
          // error: the arming below is a wait, and a wait for something already
          // done is a no-op. (Reachable: a client that outlived a pty-host
          // restart can kill an id this host never spawned.)
          Effect.catchTag(host.exit(id), "PtyNotFound", () => Effect.void),
          { startImmediately: true },
        ),
      );
      for (const id of ids) host.kill(id, "SIGKILL");
      yield* Effect.forEach(armed, Fiber.join, {
        concurrency: "unbounded",
        discard: true,
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(PTY_TERMINATION_TIMEOUT_MS),
          orElse: () => {
            const originalIds = new Set(ids);
            const survivors = host
              .list()
              .map((entry) => entry.id)
              .filter((id) => originalIds.has(id));
            return Effect.die(
              new Error(
                `pty-host: termination timed out after ${PTY_TERMINATION_TIMEOUT_MS}ms; surviving ids: ${survivors.join(", ") || "(none in inventory)"}`,
              ),
            );
          },
        }),
      );
    });

  /** A metadata tap's slow-consumer drop, at the ONE place it can be reported.
   *
   *  These taps carry a handful of frames per command, so a subscriber that
   *  overflows 10,000 of them is not lagging, it is wedged — and unlike
   *  `terminalAttach` (whose consumer re-attaches on a typed `overflow` frame)
   *  these members have no frame to say it with. So the drop is LOGGED, loudly
   *  and by name, and the subscription then ends the way it always has: a
   *  consumer that wants more re-subscribes. The end is not a silent swallow —
   *  the log is the report, and the stream's end is what the consumer already
   *  reads as "re-subscribe". */
  const endOnOverflow =
    (member: string, id?: string) =>
    <A>(stream: Stream.Stream<A, SubscriberOverflow>): Stream.Stream<A> =>
      Stream.catchTag(stream, "SubscriberOverflow", (err) =>
        Stream.drain(
          Stream.fromEffect(
            Effect.sync(() => {
              log.error(
                { member, id, maxQueue: err.maxQueue },
                "pty-host: dropped a wedged metadata subscriber; its subscription ends",
              );
            }),
          ),
        ),
      );

  const surface = implementSurface(ptyHostSurface, {
    streams: {
      // Per-terminal output — snapshot then live deltas (streaming.md §2).
      terminalAttach: {
        source: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              requirePtySync(input.id as PtyId);
              const att = yield* host.attach(input.id, {
                resizeTo: input.resizeTo,
              });
              // A drop for lagging past the bound arrives on the deltas' ERROR
              // channel, so it becomes a typed `overflow` frame as the LAST frame
              // — distinct from a graceful end (PTY exit / interruption), which
              // yields no such frame. A consumer reads it as "re-attach for a
              // fresh snapshot", not "the PTY is gone". The distinction is held
              // by the type: there is no flag to forget to check.
              return Stream.make({
                kind: "snapshot" as const,
                data: att.snapshot,
                topLine: att.topLine,
                reflowEpoch: att.reflowEpoch,
              }).pipe(
                Stream.concat(
                  att.deltas.pipe(
                    Stream.map((data) => ({ kind: "delta" as const, data })),
                    Stream.catchTag("SubscriberOverflow", () =>
                      Stream.make({ kind: "overflow" as const }),
                    ),
                  ),
                ),
              );
            }),
          ),
      },
      // Host-global meaningful-output edges (resize-excluded at the source). A live
      // edge feed — no snapshot frame (a consumer stamps arrival time and derives
      // its own windows; a missed edge only delays a downstream finish).
      activity: {
        source: () => endOnOverflow("activity")(host.subscribeActivity()),
      },
      cwd: {
        source: (input) =>
          Stream.suspend(() => {
            requirePtySync(input.id as PtyId);
            return host.subscribeCwd(input.id).pipe(
              Stream.map((cwd) => ({ cwd })),
              endOnOverflow("cwd", input.id),
            );
          }),
      },
      title: {
        source: (input) =>
          Stream.suspend(() => {
            requirePtySync(input.id as PtyId);
            return host.subscribeTitle(input.id).pipe(
              Stream.map((title) => ({ title })),
              endOnOverflow("title", input.id),
            );
          }),
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
        source: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              requirePtySync(input.id as PtyId);
              const sub = yield* host.subscribeCommandRun(input.id);
              // The snapshot carries the RETAINED command's dialect (it may be a
              // command-rooted seed); every LIVE mark is a raw OSC 633;E line (the
              // seed is published synchronously at spawn, before any subscriber, so
              // it never arrives live) — hence `shellJoin: false` on the live frames.
              const live = sub.marks.pipe(
                Stream.map((command) => ({
                  command,
                  replayed: false,
                  shellJoin: false,
                })),
                endOnOverflow("commandRun", input.id),
              );
              return sub.retained === undefined
                ? live
                : Stream.make({
                    command: sub.retained.command,
                    replayed: true,
                    shellJoin: sub.retained.shellJoin,
                  }).pipe(Stream.concat(live));
            }),
          ),
      },
      // Foreground samples — a current snapshot first so a freshly-wired
      // consumer warms its cache immediately, then live deltas (a duplicate
      // snapshot is harmless: the consumer's reconcile is idempotent).
      foreground: {
        source: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              requirePtySync(input.id as PtyId);
              const sub = yield* host.subscribeForeground(input.id);
              return Stream.make(sub.current).pipe(
                Stream.concat(
                  endOnOverflow("foreground", input.id)(sub.samples),
                ),
              );
            }),
          ),
      },
      // Natural exit — yields the exit code once, then ends. Interrupting the
      // subscribing fiber aborts the host-side waiter (a kill aborts this before
      // the kill RPC, so an intentional kill never yields here). Deliberately NOT
      // guarded by `requirePty`: dead ids are this stream's legitimate input —
      // kaval-tui fetches the exit tombstone AFTER the PTY is gone.
      exit: {
        source: (input) =>
          // `host.exit` succeeds with the child's code, or with the tombstone's
          // for an already-dead id — the two answers this member exists to
          // deliver — and FAILS only for an id it has never heard of (never
          // spawned, or evicted past the tombstone cap). That failure is
          // `PtyNotFound`, which a `StreamSpec` has no error channel to declare
          // (kaval's stated asymmetry), so it crosses as a DEFECT — the same
          // honest disposition `requirePtySync` gets on the other stream
          // members, and the loud one: the alternative is telling a user their
          // command exited 0 when the host has no idea what it exited.
          // Interrupting the subscribing fiber deregisters the waiter and yields
          // nothing, which is the kill-silence `local.ts` relies on.
          Stream.fromEffect(
            Effect.map(Effect.orDie(host.exit(input.id)), (exitCode) => ({
              exitCode,
            })),
          ),
      },
      // Host-global membership feed — a snapshot of every live PTY first
      // (snapshot-then-deltas, streaming.md §2), then created/exited deltas as
      // other clients spawn or end PTYs. The host takes both halves in ONE step
      // (`subscribeInventory`), so a spawn racing the pair is delivered as a
      // delta rather than dropped. Takes no id, so it is deliberately not
      // `requirePty`-guarded.
      inventory: {
        source: () =>
          Stream.unwrap(
            Effect.map(host.subscribeInventory(), (sub) =>
              Stream.make({
                kind: "snapshot" as const,
                entries: sub.entries.map(toWireEntry),
              }).pipe(
                Stream.concat(
                  sub.deltas.pipe(
                    Stream.map(
                      (ev) =>
                        ev.kind === "created"
                          ? {
                              kind: "created" as const,
                              entry: toWireEntry(ev.entry),
                            }
                          : ev, // exited — { kind, id } is already the wire shape
                    ),
                    endOnOverflow("inventory"),
                  ),
                ),
              ),
            ),
          ),
      },
    },
    procedures: {
      terminal: {
        // The spawn is fully specified by the client (B0): argv, env, and the
        // wrapper rcfiles all arrive on the wire. The host derives nothing from
        // policy — it materialises the init files under its own rcDir (removing
        // them when the PTY exits) and spawns argv[0] with argv[1..] verbatim.
        spawn: ({ input }) =>
          Effect.suspend(() => {
            // The caller mints the terminal id and passes it here so the
            // pty-host's PTY id == the caller's terminal id (reattach-by-id
            // across a restart, later). Generate one only if absent.
            const id = (input.id ?? randomUUID()) as PtyId;
            // argv is `minLength(1)` in the schema, so [0] is always present; the
            // guard satisfies the type and turns a malformed wire frame into a
            // clean DECLARED refusal rather than spawning `undefined`.
            const [program, ...args] = input.argv;
            if (program === undefined) return Effect.fail(new SpawnArgvEmpty());
            const written = writeInitFiles(rcDir, input.initFiles);
            // Everything past this point is a DEFECT channel (`Effect.sync`): a
            // node-pty failure or a duplicate live id means the host could not do
            // what it was asked, which is undeclared by design (D4) — it crashes
            // loudly rather than becoming something a caller could "handle".
            return Effect.sync(() => {
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
                // The PTY never came up, so its `onDispose` will never fire —
                // clean up the init files we wrote for it here, before
                // rethrowing, so a failed spawn leaves nothing behind under
                // `rcDir`.
                removeInitFiles(rcDir, written);
                throw err;
              }
              return { id: res.id, pid: res.pid, cwd: input.cwd };
            });
          }),
        // The consumer aborts the exit tap before calling kill, so an
        // intentional kill stays silent. Arm completion before signaling and
        // do not acknowledge the mutation until onExit has removed the entry:
        // sleep → wake reuses the same id, and an old teardown arriving after
        // the re-spawn would otherwise delete the new PTY. This is explicitly
        // destructive, so use SIGKILL: node-pty's default SIGHUP can lose an
        // immediate post-spawn kill while the child becomes its session leader.
        // `terminate` DIES rather than fails when the termination DEADLINE blows
        // (node-pty swallowed a signal-delivery error and a PTY survived). The
        // procedure declares no error, so that stays an undeclared DEFECT — a
        // host that cannot kill its own child is broken, not busy (PLAN D4).
        kill: ({ input }) => Effect.as(terminate([input.id]), { ok: true }),
        killAll: () =>
          Effect.suspend(() => {
            const ids = host.list().map((e) => e.id);
            // killAll is the reset boundary used by test setup and operators:
            // reporting success while old PTYs still occupy inventory makes the
            // next world race residue.
            return Effect.as(terminate(ids), { killed: ids.length });
          }),
        write: ({ input }) =>
          Effect.sync(() => {
            host.write(input.id, input.data);
            return { ok: true };
          }),
        // `ok` is the host's own answer, not a constant: FALSE means there was
        // no such PTY to resize (it exited before this call arrived), so the
        // caller's grid claim did not land on anything. Callers treat that as
        // the expected killed-terminal race; a REJECTION is the real failure.
        resize: ({ input }) =>
          Effect.sync(() => ({
            ok: host.resize(input.id, input.cols, input.rows),
          })),
        // Each host entry mapped into the wire shape via `toWireEntry` — the
        // shared bridge (see its doc) that makes a host/schema drift a compile
        // error rather than a silent field-strip. The `inventory` stream's
        // snapshot/created frames go through the same map.
        list: () =>
          Effect.sync(() => ({ entries: host.list().map(toWireEntry) })),
        getScreenState: ({ input }) =>
          // Fail on a missing PTY rather than return "" — an empty string is a
          // legitimate screen state (a PTY that hasn't drawn yet), so masking a
          // divergence as a blank terminal would hide a real bug.
          Effect.map(requirePtyEffect(input.id as PtyId), () => ({
            data: host.getScreenState(input.id),
          })),
        getScreenText: ({ input }) =>
          Effect.map(requirePtyEffect(input.id as PtyId), () => ({
            text: host.getScreenText(input.id, input.extent),
          })),
        // Same missing-PTY discipline as its text twin: a gone PTY FAILS here
        // rather than answering with the empty grid the in-process primitive
        // returns, so a divergence can never read as "the screen is blank".
        getScreenCells: ({ input }) =>
          Effect.map(requirePtyEffect(input.id as PtyId), () =>
            host.getScreenCells(input.id, input.extent),
          ),
        getHistory: ({ input }) =>
          Effect.map(requirePtyEffect(input.id as PtyId), () =>
            host.getHistory(input.id, input.before, input.max, input.epoch),
          ),
      },
      system: {
        version: () =>
          Effect.succeed({
            contractVersion: PTY_HOST_CONTRACT_VERSION,
            pid: process.pid,
            startedAt: boot.startedAt,
            identity: boot.identity,
            lifetime: deps.lifetime,
          }),
        heartbeat: () => Effect.sync(() => ({ ts: Date.now() })),
        // The host's own facts, read-only — a client composes spawn policy
        // against these (and for a remote host, this is the *only* way it
        // learns the login shell / HOME / rcDir it must target).
        info: () =>
          Effect.sync(() => ({
            shell: hostShell(),
            home: hostHome(),
            platform: platform(),
            rcDir,
            // The host's own `$PATH`, so a REMOTE client can give the spawned
            // shell a working PATH (a local client already has the same one). A
            // shell with no PATH can't find any external command (`sleep` →
            // exit 127), so the PTY dies on the first one.
            path: process.env.PATH ?? "",
          })),
      },
    },
  });

  // Expose the live-PTY count (sync, off the host) alongside the runtime, so the
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

/** The served pty-host wire, as the two values every serving site now takes:
 *  the flat `RpcGroup` `defineSurface` minted and the handler record
 *  `implementSurface` bound against it, keyed by full wire tag.
 *
 *  One field became two when the router died (S2/S4): `directDispatch` consumes
 *  the handlers (the in-process web client), while `serveOverUnixSocket` /
 *  `serveOverStdio` need the group too (it is what decodes a wire frame into a
 *  member call). They are the SAME handler values on both legs, not two code
 *  paths — which is what keeps the in-process and socket links pinned to
 *  identical behaviour.
 *
 *  `Rpc.Any` is the honest erasure, not a widening: a group assembled by a spec
 *  WALK carries no type information a caller could trust (review #16), and
 *  `implementSurface` asserts route-set identity between the two at boot, so the
 *  guarantee lives in an assertion rather than in a type nobody can check. */
export interface PtyHostServed {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly handlers: SurfaceHandlers;
}

/** Build the in-process pty-host ONCE and return several views of the same host:
 *   - `client` — the no-wire `directDispatch` client kolu-server's web path uses;
 *   - `served` — `{ group, handlers }`, ready to hand straight to
 *     `serveOverUnixSocket` (kaval-tui's socket) or `serveOverStdio` (a daemon's
 *     ssh front). `implementSurface` already asserted the two agree, so there is
 *     nothing to wrap and nothing to re-adapt;
 *   - `done` / `close` — the surface runtime's supervision handles. The
 *     ptyHost surface declares no cell connectors, so `done` is inert (nothing
 *     to fault); `close` disposes every live PTY and then closes the surface
 *     runtime, so a shutting-down daemon reaps its node-pty children instead of
 *     orphaning them — the daemon owning shutdown by construction.
 *  Call once per process; calling twice spawns two independent hosts. */
export function createInProcessPtyHost(deps: InProcessPtyHostDeps): {
  /** The served wire — hand it to a transport, or to `directDispatch`. */
  readonly served: PtyHostServed;
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
  return Object.freeze({
    served: { group: served.group, handlers: served.handlers },
    // `surfaceClientRef` is the framework's own `buildSurfaceFace(surface,
    // directDispatch(served))` — the in-process face, typed off the surface's
    // spec. Reused rather than re-derived so the face and the served handlers
    // can never be built by two different rules.
    client: surfaceClientRef(ptyHostSurface, served),
    boot: served.boot,
    terminalCount: served.terminalCount,
    done: served.done,
    close: served.close,
  });
}
