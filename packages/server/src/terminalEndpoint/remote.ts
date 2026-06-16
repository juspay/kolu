/**
 * `RemoteTerminalEndpoint` — the P3 (kaval-sessions) second implementation of
 * `TerminalEndpoint`, binding the SAME shape to a remote host over ssh.
 *
 * It dials a `kolu-watcher` on the host via `getHostSession` (provision → ssh
 * → the `watcherSurface`), then:
 *
 *   - PTY: `spawnPty`/`attach`/`killTerminal`/`killAllTerminals` forward to the
 *     watcher's absorbed pty verbs/taps (which the watcher relays to the
 *     host-local kaval). `spawnPty` returns a sync shadow (invariant #3) — the
 *     cold `nix run` realisation is exactly what that shadow protects.
 *   - fs/git: forward one-shot reads to the watcher's `git.*`/`fs.*` procedures;
 *     re-serve `subscribeRepoChange`/`subscribeFileChange` from its
 *     `repoChange`/`fileChange` streams.
 *   - metadata: a mirror bridge (the `remote-process-monitor` `bridgeAgentToParent`
 *     pattern) pumps the watcher's `terminalMetadata` collection into
 *     kolu-server's registry + browser surface, re-issuing the subscriptions on
 *     each watcher respawn (`makeClientCursor`). A terminal the watcher already
 *     has but kolu-server doesn't is ADOPTED here — "reconnect to the prod
 *     terminals" — never re-spawned.
 *   - status: the session's `onState` drives this host's row in the existing
 *     `daemonStatus` collection (keyed by hostId), mapped onto the wire enum so
 *     the client surfaces it WITHOUT widening the shared enum.
 *
 * Spawn policy stays kolu's soul, but composed for a DIFFERENT machine: the
 * spawn input comes from `composeRemoteSpawnInput` against the WATCHER's
 * `system.info` (the remote host's shell/home/PATH). Unlike the local
 * `composeSpawnInput` — which forwards THIS process's env (`cleanEnv()`) and
 * treats `system.info` only as a fallback — the remote variant builds the env
 * FRESH from the host's facts (`info.shell`/`info.home`/`info.path` are
 * authoritative), so a remote shell opens in the host's environment with NOTHING
 * from this machine's process env leaking across.
 */

import {
  type AgentClient,
  getHostSession,
  type HostSession,
  type HostSessionState,
  makeClientCursor,
  mirrorRemoteCollection,
} from "@kolu/surface-nix-host";
import {
  type DaemonStatus,
  type InitialTerminalMetadata,
  type TerminalId,
  type TerminalInfo,
  type TerminalMetadata,
  TerminalServerMetadataSchema,
} from "kolu-common/surface";
import type {
  PtySpawnOpts,
  TerminalAttachment,
  TerminalEndpoint,
  TerminalEndpointFs,
  TerminalEndpointGit,
  TerminalHandle,
} from "kolu-common/terminalEndpoint";
import type { watcherSurface } from "kolu-watcher";
import { log } from "../log.ts";
import { publishDaemonStatus } from "../ptyHost/daemonStatus.ts";
import { composeRemoteSpawnInput } from "../ptyHost/index.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import {
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { applyInitialMetadata, createMetadata } from "./metadata.ts";

type WatcherClient = AgentClient<typeof watcherSurface.contract>;

const WATCHER_BINARY = "kolu-watcher";

/** Run one watcher RPC under a ref-counted session lease: acquire the client,
 *  run `fn`, release in a `finally`. The single home for the acquire/release
 *  discipline, shared by the proxy's control verbs and the endpoint's
 *  fs/git/kill forwards so a change to the lease contract is one edit. */
function withClient<T>(
  session: HostSession<typeof watcherSurface.contract>,
  fn: (c: WatcherClient) => Promise<T>,
): Promise<T> {
  return (async () => {
    const client = await session.acquire();
    try {
      return await fn(client);
    } finally {
      session.release();
    }
  })();
}

export interface RemoteTerminalEndpointOptions {
  /** The hostId — the daemonStatus key + the terminal record's location.hostId. */
  hostId: string;
  /** The ssh target dialed (alias, user@host, …; passed verbatim to ssh). */
  host: string;
  /** Resolve the kolu-watcher `.drv` for this host (resolveSystem → drv map). */
  resolveDrvPath: () => Promise<string>;
}

/** The server-owned fields the watcher is authoritative for — the
 *  `TerminalServerMetadata` partition (server-persisted ∪ live) MINUS
 *  `location`, which kolu-server stamps itself from the dialed hostId. Derived
 *  off the schema's keys so a new server/live field is mirrored for free and a
 *  field-by-field rewrite that dropped one fails the round-trip test. */
export const SERVER_META_KEYS =
  TerminalServerMetadataSchema.keyof().options.filter(
    (k): k is Exclude<typeof k, "location"> => k !== "location",
  );

// These two mirror `LocalTerminalEndpoint`'s private emit helpers — a terminal
// list/dirty signal is endpoint-agnostic, so both endpoints fire the same ones.
function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}
function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

/** Map the ssh session's connection lifecycle onto the existing wire
 *  `daemonStatus.state` enum — deliberately WITHOUT widening it (the client adds
 *  the `provisioning`/`unreachable` PRESENTATION client-side). `copying` (cold
 *  `nix copy`) and `connecting` both read as the amber dialing state; a dropped
 *  link is `degraded` (still retrying); a `failed` give-up is `dead`. */
function mapDaemonStatus(s: HostSessionState): DaemonStatus {
  const state =
    s.connection === "connected"
      ? "connected"
      : s.connection === "failed"
        ? "dead"
        : s.connection === "disconnected"
          ? "degraded"
          : "connecting"; // "copying" | "connecting"
  // Carry the dial-progress ring to the client so a cold dial's minute-long
  // `nix copy`/realise + the remote watcher's stderr is visible on the host
  // chip, not just a static amber dot. `onState` fires on every progress line,
  // so the chip updates live. (Copied — the cell holds a readonly snapshot.)
  return { state, progress: [...s.progressLines] };
}

/** A `TerminalHandle` whose control verbs forward through the watcher client to
 *  the remote kaval. The sibling of `LocalTerminalEndpoint`'s
 *  `PtyHostTerminalProxy`, bound to a `HostSession` instead of the local
 *  pty-host client. Every verb waits on `ready` (the async remote spawn). */
class RemoteTerminalProxy implements TerminalHandle {
  pid = 0;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;

  constructor(
    private readonly id: TerminalId,
    private readonly session: HostSession<typeof watcherSurface.contract>,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {});
  }

  markReady(pid: number): void {
    this.pid = pid;
    this.resolveReady();
  }

  markFailed(err: unknown): void {
    this.rejectReady(err);
  }

  write(data: string): void {
    void this.ready
      .then(() =>
        withClient(this.session, (c) =>
          c.surface.terminal.write({ id: this.id, data }),
        ),
      )
      .catch((err) => log.error({ terminal: this.id, err }, "remote write"));
  }

  resize(cols: number, rows: number): void {
    void this.ready
      .then(() =>
        withClient(this.session, (c) =>
          c.surface.terminal.resize({ id: this.id, cols, rows }),
        ),
      )
      .catch((err) => log.error({ terminal: this.id, err }, "remote resize"));
  }

  async getScreenState(): Promise<string> {
    await this.ready;
    const { data } = await withClient(this.session, (c) =>
      c.surface.terminal.getScreenState({ id: this.id }),
    );
    return data;
  }

  async getScreenText(
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): Promise<string> {
    await this.ready;
    const { text } = await withClient(this.session, (c) =>
      c.surface.terminal.getScreenText({
        id: this.id,
        startLine,
        endLine,
        tailLines,
      }),
    );
    return text;
  }
}

export class RemoteTerminalEndpoint implements TerminalEndpoint {
  private readonly session: HostSession<typeof watcherSurface.contract>;
  readonly fs: TerminalEndpointFs;
  readonly git: TerminalEndpointGit;

  constructor(private readonly opts: RemoteTerminalEndpointOptions) {
    this.session = getHostSession<typeof watcherSurface.contract>({
      host: opts.host,
      binary: WATCHER_BINARY,
      resolveDrvPath: opts.resolveDrvPath,
    });
    this.fs = this.makeFs();
    this.git = this.makeGit();
    // The host's status rides the existing per-host daemonStatus collection.
    this.session.onState((s) =>
      publishDaemonStatus(opts.hostId, mapDaemonStatus(s)),
    );
    void this.bridge();
  }

  // ── PTY ───────────────────────────────────────────────────────────────

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const proxy = new RemoteTerminalProxy(id, this.session);
    const meta = this.seedMeta(opts.cwd ?? "", opts.initialMetadata);
    const entry: TerminalProcess = {
      info: { id, pid: 0 },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    emitTerminalsDirty();
    emitTerminalListChanged();
    void this.spawnAndWire(id, opts, proxy);
    return entry.info;
  }

  private async spawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: RemoteTerminalProxy,
  ): Promise<void> {
    try {
      const client = await this.session.acquire();
      try {
        // Spawn policy is composed against the REMOTE host's facts, so the
        // shell opens in the host's environment (not this machine's).
        const info = await client.surface.system.info({});
        const res = await client.surface.terminal.spawn(
          composeRemoteSpawnInput({ id, cwd: opts.cwd }, info),
        );
        // Killed-during-spawn race (mirrors `LocalTerminalEndpoint.
        // spawnViaClient`): the user can close the tile while the cold
        // provision + spawn RPC is in flight, so `killTerminal` already
        // unregistered the local shadow. The remote PTY is now live with no
        // local owner — KILL it on the host (else it leaks an orphan), fail the
        // proxy, and return without marking ready. The window is wider here
        // than locally because a cold `nix run` can run for tens of seconds.
        if (!getTerminal(id)) {
          proxy.markFailed(new Error("terminal killed during spawn"));
          try {
            await client.surface.terminal.kill({ id });
          } catch (killErr) {
            log.error(
              { terminal: id, err: killErr },
              "remote kill of spawn-raced terminal failed",
            );
          }
          return;
        }
        const entry = getTerminal(id);
        if (entry) {
          entry.info.pid = res.pid;
          entry.meta.cwd = res.cwd;
          emitTerminalListChanged();
        }
        proxy.markReady(res.pid);
      } finally {
        this.session.release();
      }
    } catch (err) {
      log.error({ terminal: id, err }, "remote spawn failed");
      proxy.markFailed(err);
      if (getTerminal(id)) {
        unregisterTerminal(id);
        emitTerminalsDirty();
        emitTerminalListChanged();
      }
    }
  }

  async attach(
    id: TerminalId,
    signal: AbortSignal,
  ): Promise<TerminalAttachment> {
    // Wait for the remote PTY to actually exist before opening the attach
    // stream — the same gate `LocalTerminalEndpoint.attach` holds. A tile
    // attaching off the sync shadow would otherwise race the in-flight
    // `terminal.spawn` and the watcher/kaval throws "no PTY with id". The
    // window is wider remotely (a cold provision precedes the spawn), so the
    // gate matters more here. `ready` is the `TerminalHandle` invariant; awaiting
    // it also surfaces a spawn failure (the proxy rejects `ready`) rather than
    // hitting a missing PTY.
    await getTerminal(id)?.handle.ready;
    const client = await this.session.acquire();
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        this.session.release();
      }
    };
    try {
      const stream = await client.surface.terminalAttach.get(
        { id },
        { signal },
      );
      const iter = stream[Symbol.asyncIterator]();
      const first = await iter.next();
      const snapshot =
        !first.done && first.value.kind === "snapshot" ? first.value.data : "";
      async function* deltas(): AsyncGenerator<string> {
        try {
          if (!first.done && first.value.kind === "delta")
            yield first.value.data;
          for (let r = await iter.next(); !r.done; r = await iter.next()) {
            if (r.value.kind === "delta") yield r.value.data;
          }
        } finally {
          release();
        }
      }
      return { snapshot, deltas: deltas() };
    } catch (err) {
      release();
      throw err;
    }
  }

  async killTerminal(id: TerminalId): Promise<TerminalInfo | undefined> {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    try {
      await withClient(this.session, (c) => c.surface.terminal.kill({ id }));
    } catch (err) {
      log.error(
        { terminal: id, err },
        "remote kill failed; unregistering anyway",
      );
    }
    unregisterTerminal(id);
    surfaceCtx.collections.terminalMetadata.remove(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  async killAllTerminals(): Promise<void> {
    const ids = listTerminals()
      .filter(
        (info) =>
          getTerminal(info.id)?.meta.location?.hostId === this.opts.hostId,
      )
      .map((info) => info.id);
    try {
      await withClient(this.session, (c) => c.surface.terminal.killAll({}));
    } catch (err) {
      log.error({ err }, "remote killAll failed; unregistering anyway");
    }
    for (const id of ids) {
      unregisterTerminal(id);
      surfaceCtx.collections.terminalMetadata.remove(id);
    }
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  // ── fs / git ──────────────────────────────────────────────────────────

  private makeFs(): TerminalEndpointFs {
    return {
      listAll: (repoPath) =>
        withClient(this.session, (c) => c.surface.fs.listAll({ repoPath })),
      readFile: (repoPath, filePath) =>
        withClient(this.session, (c) =>
          c.surface.fs.readFile({ repoPath, filePath }),
        ),
      readFileBytes: (repoPath, filePath) =>
        withClient(this.session, (c) =>
          c.surface.fs.readFileBytes({ repoPath, filePath }),
        ),
      statFileMtimeMs: (repoPath, filePath) =>
        withClient(this.session, (c) =>
          c.surface.fs.statFileMtimeMs({ repoPath, filePath }),
        ).then((r) => r.mtimeMs),
      subscribeRepoChange: (repoPath, onChange) =>
        this.subscribeChange(
          (c, signal) => c.surface.repoChange.get({ repoPath }, { signal }),
          onChange,
        ),
      subscribeFileChange: (repoPath, filePath, onChange) =>
        this.subscribeChange(
          (c, signal) =>
            c.surface.fileChange.get({ repoPath, filePath }, { signal }),
          onChange,
        ),
    };
  }

  private makeGit(): TerminalEndpointGit {
    return {
      getStatus: (repoPath, mode) =>
        withClient(this.session, (c) =>
          c.surface.git.getStatus({ repoPath, mode }),
        ),
      getDiff: (repoPath, filePath, mode, oldPath) =>
        withClient(this.session, (c) =>
          c.surface.git.getDiff({ repoPath, filePath, mode, oldPath }),
        ),
    };
  }

  // ── shared plumbing ────────────────────────────────────────────────────

  /** Bridge a watcher change-notification stream onto a `() => void` callback,
   *  returning a synchronous unsubscribe (the `TerminalEndpointFs` contract). */
  private subscribeChange(
    open: (
      c: WatcherClient,
      signal: AbortSignal,
    ) => PromiseLike<AsyncIterable<unknown>>,
    onChange: () => void,
  ): () => void {
    const abort = new AbortController();
    void (async () => {
      // `session.acquire()` MUST be inside the try: on an unreachable host (or a
      // provisioning failure) it rejects, and this is a FLOATED async task — an
      // unawaited rejection here would reach the process-wide unhandledRejection
      // handler, which exits the server. So a dead remote host installing a
      // repo/file watcher would otherwise take down the whole kolu-server.
      // `acquired` gates the matching release so we never release a lease we
      // never took.
      let acquired = false;
      try {
        const client = await this.session.acquire();
        acquired = true;
        for await (const _ of await open(client, abort.signal)) {
          if (abort.signal.aborted) return;
          onChange();
        }
      } catch (err) {
        if (!abort.signal.aborted)
          log.error(
            { host: this.opts.host, err },
            "remote change subscription",
          );
      } finally {
        if (acquired) this.session.release();
      }
    })();
    return () => abort.abort();
  }

  private seedMeta(
    cwd: string,
    initial?: InitialTerminalMetadata,
  ): TerminalMetadata {
    const meta: TerminalMetadata = {
      ...createMetadata(cwd),
      location: { hostId: this.opts.hostId },
    };
    applyInitialMetadata(meta, initial);
    return meta;
  }

  /** Merge the watcher's server-persisted + live fields into the registry
   *  entry's meta, PRESERVING the client-persisted fields kolu-server owns
   *  (theme/layout/sub-panel/intent set by the browser). */
  private onRemoteMeta(id: TerminalId, remote: TerminalMetadata): void {
    let entry = getTerminal(id);
    if (!entry) {
      // Adopt a terminal the watcher has but kolu-server didn't spawn (the
      // "reconnect to the prod terminals" path) — register it under a remote
      // proxy already marked ready (the PTY is live on the host).
      const proxy = new RemoteTerminalProxy(id, this.session);
      proxy.markReady(0);
      entry = {
        info: { id, pid: 0 },
        meta: this.seedMeta(remote.cwd),
        handle: proxy,
      };
      registerTerminal(id, entry);
      emitTerminalListChanged();
    }
    // Copy the server-owned half of `remote` as a UNIT (the
    // `TerminalServerMetadata` partition driven off the schema, sans
    // `location`), so a new server/live field rides for free rather than being
    // dropped by a stale field-by-field rewrite (the #1275 lossy-adoption
    // class). The client-persisted fields kolu-server owns (theme/layout/sub-
    // panel/intent) are untouched on `entry.meta` — only the server keys are
    // overwritten — and `location` is re-stamped from the dialed hostId.
    for (const key of SERVER_META_KEYS) {
      (entry.meta[key] as TerminalMetadata[typeof key]) = remote[key];
    }
    entry.meta.location = { hostId: this.opts.hostId };
    surfaceCtx.collections.terminalMetadata.upsert(id, entry.meta);
  }

  private onRemoteRemove(id: TerminalId): void {
    if (!getTerminal(id)) return;
    surfaceCtx.events.terminalExit.publish({ id }, 0);
    unregisterTerminal(id);
    surfaceCtx.collections.terminalMetadata.remove(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  /** The mirror pump — pin the session, then loop over each successive client
   *  (re-issuing the subscription on every watcher respawn, since stdio links
   *  don't recover mid-stream), mirroring the watcher's `terminalMetadata` into
   *  kolu-server's registry + browser surface. The `bridgeAgentToParent`
   *  pattern from `remote-process-monitor`. */
  private async bridge(): Promise<void> {
    this.session.pin().catch(() => {
      /* reconnect loop + the daemonStatus cell handle recovery/visibility */
    });
    const cursor = makeClientCursor(this.session);
    while (!this.session.isDestroyed()) {
      let client: WatcherClient;
      try {
        client = await cursor.next();
      } catch (err) {
        // The cursor only rejects when the session is being torn down (destroy
        // races the await); log it so a real failure here isn't indistinguishable
        // from a clean shutdown, then exit the pump (the while-guard agrees).
        log.error(
          { host: this.opts.host, err },
          "remote: bridge cursor failed",
        );
        break;
      }
      try {
        // Confirm the link round-trips before mirroring — disarms the connect
        // watchdog (a cold provision runs far longer than its window).
        await client.surface.system.heartbeat({});
        this.session.markConnected();
        await mirrorRemoteCollection<TerminalId, TerminalMetadata>({
          label: `terminalMetadata@${this.opts.hostId}`,
          log: (m) => log.info({ host: this.opts.host }, m),
          keys: client.surface.terminalMetadata.keys({}) as Promise<
            AsyncIterable<readonly TerminalId[]>
          >,
          get: (key, signal) =>
            client.surface.terminalMetadata.get({ key }, { signal }) as Promise<
              AsyncIterable<TerminalMetadata>
            >,
          onUpsert: (id, meta) => this.onRemoteMeta(id, meta),
          onRemove: (id) => this.onRemoteRemove(id),
        });
      } catch (err) {
        log.error({ host: this.opts.host, err }, "remote mirror pump ended");
      }
    }
  }

  /** Tear down the ssh session (used when a host is removed). */
  destroy(): void {
    this.session.destroy();
  }
}
