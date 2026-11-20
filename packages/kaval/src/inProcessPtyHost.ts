import { randomUUID } from "node:crypto";
import { homedir, platform, userInfo } from "node:os";
import { surfaceClientRef } from "@kolu/surface/project";
import type { PtyHostClient } from "./ptyHostClient.ts";
import { implementSurface, type SurfaceHandlers } from "@kolu/surface/server";
import { Duration, Effect, Fiber, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/rpc";
import { currentPtyHostIdentity } from "./buildId.ts";
import type { SubscriberDropped } from "./fanOut.ts";
import { removeInitFiles, writeInitFiles } from "./initFiles.ts";
import type { DaemonLifetimeInfo, Logger } from "@kolu/surface-daemon";
import {
  createPtyHost,
  type PtyDataItem,
  type PtyId,
  type PtyListEntry,
} from "./ptyHost.ts";
import {
  PTY_HOST_CONTRACT_VERSION,
  PtyNotFound,
  type PtyHostIdentity,
  type PtyHostListEntry,
  type PtyHostSpawnInput,
  type PtyHostSpawnResult,
  ptyHostSurface,
  SpawnArgvEmpty,
} from "./ptyHostSurface.ts";

interface SpawnPlan {
  readonly id: PtyId;
  readonly program: string;
  readonly args: string[];
}

const PTY_TERMINATION_TIMEOUT_MS = 8_000;

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

export type { PtyHostClient } from "./ptyHostClient.ts";

/** Immutable facts captured once when a pty-host process starts. Both the
 * legacy `system.version` route and the frozen daemon control channel project
 * from this record, so they cannot describe different process builds. */
export interface PtyHostBoot {
  readonly startedAt: number;
  readonly identity: Readonly<PtyHostIdentity>;
}

function hostShell(): string {
  return process.env.SHELL || userInfo().shell || "/bin/sh";
}

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

  const requirePty = (id: PtyId): Effect.Effect<void, PtyNotFound> =>
    host.has(id) ? Effect.void : Effect.fail(new PtyNotFound({ id }));
  const requirePtyOnStream = (id: PtyId): Effect.Effect<void> =>
    Effect.orDie(requirePty(id));

  const terminate = (ids: readonly PtyId[]): Effect.Effect<void> =>
    Effect.gen(function* () {
      const armed = yield* Effect.forEach(ids, (id) =>
        Effect.forkChild(
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

  const endOnDrop =
    (member: string, id?: string) =>
    <A>(stream: Stream.Stream<A, SubscriberDropped>): Stream.Stream<A> =>
      Stream.catch(stream, (err) =>
        Stream.drain(
          Stream.fromEffect(
            Effect.sync(() => {
              log.error(
                {
                  member,
                  id,
                  drop: err._tag,
                  ...(err._tag === "SubscriberOverflow"
                    ? { reason: err.reason, limit: err.limit }
                    : {}),
                },
                "pty-host: dropped a wedged metadata subscriber; its subscription ends",
              );
            }),
          ),
        ),
      );

  const planSpawn = (
    input: PtyHostSpawnInput,
  ): Effect.Effect<SpawnPlan, SpawnArgvEmpty> => {
    const [program, ...args] = input.argv;
    if (program === undefined) return Effect.fail(new SpawnArgvEmpty());
    return Effect.succeed({
      id: (input.id ?? randomUUID()) as PtyId,
      program,
      args,
    });
  };

  const performSpawn = (
    plan: SpawnPlan,
    input: PtyHostSpawnInput,
  ): Effect.Effect<PtyHostSpawnResult> =>
    Effect.sync(() => {
      const written = writeInitFiles(rcDir, input.initFiles);
      try {
        const res = host.spawn({
          id: plan.id,
          shell: plan.program,
          args: plan.args,
          commandRooted: input.commandRooted,
          env: input.env,
          cwd: input.cwd,
          cols: input.cols,
          rows: input.rows,
          scrollback: input.scrollback,
          onDispose: () => removeInitFiles(rcDir, written),
        });
        return { id: res.id, pid: res.pid, cwd: input.cwd };
      } catch (err) {
        removeInitFiles(rcDir, written);
        throw err;
      }
    });

  const surface = implementSurface(ptyHostSurface, {
    streams: {
      terminalAttach: {
        source: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* requirePtyOnStream(input.id as PtyId);
              const att = yield* host.attach(input.id, {
                resizeTo: input.resizeTo,
              });
              return Stream.make({
                kind: "snapshot" as const,
                data: att.snapshot,
                topLine: att.topLine,
                reflowEpoch: att.reflowEpoch,
                grid: att.grid,
              }).pipe(
                Stream.concat(
                  att.deltas.pipe(
                    Stream.map((item: PtyDataItem) =>
                      item.kind === "bytes"
                        ? { kind: "delta" as const, data: item.data }
                        : { kind: "resized" as const, grid: item.grid },
                    ),
                    Stream.catch(() =>
                      Stream.make({ kind: "overflow" as const }),
                    ),
                  ),
                ),
              );
            }),
          ),
      },
      activity: {
        source: () => endOnDrop("activity")(host.subscribeActivity()),
      },
      cwd: {
        source: (input) =>
          Stream.unwrap(
            Effect.map(requirePtyOnStream(input.id as PtyId), () =>
              host.subscribeCwd(input.id).pipe(
                Stream.map((cwd) => ({ cwd })),
                endOnDrop("cwd", input.id),
              ),
            ),
          ),
      },
      title: {
        source: (input) =>
          Stream.unwrap(
            Effect.map(requirePtyOnStream(input.id as PtyId), () =>
              host.subscribeTitle(input.id).pipe(
                Stream.map((title) => ({ title })),
                endOnDrop("title", input.id),
              ),
            ),
          ),
      },
      commandRun: {
        source: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* requirePtyOnStream(input.id as PtyId);
              const sub = yield* host.subscribeCommandRun(input.id);
              const live = sub.marks.pipe(endOnDrop("commandRun", input.id));
              return sub.retained === undefined
                ? live
                : Stream.make(sub.retained).pipe(Stream.concat(live));
            }),
          ),
      },
      foreground: {
        source: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* requirePtyOnStream(input.id as PtyId);
              const sub = yield* host.subscribeForeground(input.id);
              return Stream.make(sub.current).pipe(
                Stream.concat(endOnDrop("foreground", input.id)(sub.samples)),
              );
            }),
          ),
      },
      exit: {
        source: (input) =>
          Stream.fromEffect(
            Effect.map(Effect.orDie(host.exit(input.id)), (exitCode) => ({
              exitCode,
            })),
          ),
      },
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
                    Stream.map((ev) =>
                      ev.kind === "created"
                        ? {
                            kind: "created" as const,
                            entry: toWireEntry(ev.entry),
                          }
                        : ev,
                    ),
                    endOnDrop("inventory"),
                  ),
                ),
              ),
            ),
          ),
      },
    },
    procedures: {
      terminal: {
        spawn: ({ input }) =>
          Effect.flatMap(planSpawn(input), (plan) => performSpawn(plan, input)),
        kill: ({ input }) => Effect.as(terminate([input.id]), { ok: true }),
        killAll: () =>
          Effect.suspend(() => {
            const ids = host.list().map((e) => e.id);
            return Effect.as(terminate(ids), { killed: ids.length });
          }),
        write: ({ input }) =>
          Effect.sync(() => {
            host.write(input.id, input.data);
            return { ok: true };
          }),
        resize: ({ input }) =>
          Effect.sync(() => ({
            ok: host.resize(input.id, input.cols, input.rows),
          })),
        list: () =>
          Effect.sync(() => ({ entries: host.list().map(toWireEntry) })),
        getScreenState: ({ input }) =>
          Effect.map(requirePty(input.id as PtyId), () => ({
            data: host.getScreenState(input.id),
          })),
        getScreenText: ({ input }) =>
          Effect.map(requirePty(input.id as PtyId), () => ({
            text: host.getScreenText(input.id, input.extent),
          })),
        getScreenCells: ({ input }) => {
          const grid = host.getScreenCells(input.id as PtyId, input.extent);
          return grid
            ? Effect.succeed(grid)
            : Effect.fail(new PtyNotFound({ id: input.id as PtyId }));
        },
        getHistory: ({ input }) =>
          Effect.map(requirePty(input.id as PtyId), () =>
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
        info: () =>
          Effect.sync(() => ({
            shell: hostShell(),
            home: hostHome(),
            platform: platform(),
            rcDir,
            path: process.env.PATH ?? "",
          })),
      },
    },
  });

  return {
    ...surface,
    boot,
    terminalCount: () => host.size(),
    close: async () => {
      host.dispose();
      await surface.close();
    },
  };
}

/** The served pty-host wire, as the two values every serving site now takes:
 *  the flat `RpcGroup` `defineSurface` minted and the handler record
 *  `implementSurface` bound against it, keyed by full wire tag. */
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
    client: surfaceClientRef(ptyHostSurface, served),
    boot: served.boot,
    terminalCount: served.terminalCount,
    done: served.done,
    close: served.close,
  });
}
