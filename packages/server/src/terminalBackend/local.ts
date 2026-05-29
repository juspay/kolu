/**
 * `LocalTerminalBackend` — this kolu process. Since #951 **R4c** it is the
 * unix-socket **client** of the `kolu --stdio` PTY-host daemon. The daemon
 * owns **only `@kolu/pty-host`** (node-pty + the `@xterm/headless` mirror +
 * the raw VT taps); this backend forwards spawn/kill/write/resize/attach over
 * the socket AND **runs the per-terminal provider DAG locally**
 * (`./providers.ts`), feeding it the daemon's raw tap streams (cwd · title ·
 * command-run · foreground) over the socket.
 *
 * Why providers run HERE and not in the daemon: the daemon is long-lived and
 * survives a deploy, so anything it holds runs *stale* until restarted. The
 * provider DAG (git / PR / agent-detection) is the most-edited code in the
 * repo, so it must be fresh every deploy — and kolu-server restarts every
 * deploy. So the daemon stays thin + version-stable, and the volatile DAG
 * rides kolu-server's lifecycle. This is the correction the R4c redo makes
 * over the dropped #1031 (which daemonized the providers and served stale
 * detection). See `docs/plans/remote-terminals.html` (#r4-boundary).
 *
 * Reattach across kolu-server restart: the daemon (and its PTYs) survives this
 * process dying. On boot, `reattachLocalTerminals` asks the daemon which PTYs
 * it still owns (`terminal.list`), matches them to the saved session by id,
 * and re-registers each entry *without spawning* — then starts a FRESH
 * provider DAG against the surviving PTY's taps (so detection re-resolves the
 * real current state, never a stale guess), and the client's retried attach
 * streams reconnect to the same shells with scrollback intact.
 *
 * `TerminalBackend.fs/git` stay on this side, abstracted per-location and (for
 * local) shelling out to `kolu-git` directly.
 */

import type { ForegroundSample } from "@kolu/pty-host";
import { inMemoryChannel } from "@kolu/surface/server";
import type { PtyHostListEntry } from "kolu-common/ptyHostSurface";
import type {
  SavedTerminal,
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import type {
  PtySpawnOpts,
  TerminalAttachment,
  TerminalBackend,
  TerminalBackendFs,
  TerminalBackendGit,
  TerminalHandle,
} from "kolu-common/terminalBackend";
import {
  type FsListAllOutput,
  type GitDiffOutput,
  type GitStatusOutput,
  getDiff,
  getStatus,
  listAll,
  readFile,
  statFileMtimeMs,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import type { GitDiffMode, GitInfo } from "kolu-git/schemas";
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import {
  ensureDaemon,
  getDaemonHandle,
  type PtyHostClient,
} from "../daemon/supervisor.ts";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import { unwrapGit } from "../unwrapGit.ts";
import {
  createMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";
import {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "./providers.ts";

// ── PTY-state notification helpers ─────────────────────────────────────

/** Notify that terminal state changed (drives debounced session auto-save).
 *  Distinct from the `terminalList` cell's content channel: this is the
 *  *trigger*, not the saved content. */
function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}

/** Republish the live `terminalList` cell. Backend lifecycle calls this on
 *  create / kill / reattach; client metadata setters publish via the metadata
 *  collection instead. */
function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

// ── Local fs/git surfaces (unchanged — local fs is on this machine) ─────

const localFs: TerminalBackendFs = {
  async listAll(repoPath: string): Promise<FsListAllOutput> {
    return { paths: unwrapGit(await listAll(repoPath, log)) };
  },
  async readFile(repoPath, filePath) {
    return unwrapGit(await readFile(repoPath, filePath, log));
  },
  async statFileMtimeMs(repoPath, filePath) {
    return unwrapGit(await statFileMtimeMs(repoPath, filePath, log));
  },
  subscribeRepoChange(repoPath, onChange) {
    return subscribeRepoChange(repoPath, onChange, log);
  },
  subscribeFileChange(repoPath, filePath, onChange) {
    return subscribeFileChange(repoPath, filePath, onChange, log);
  },
};

const localGit: TerminalBackendGit = {
  async getStatus(repoPath, mode: GitDiffMode): Promise<GitStatusOutput> {
    return unwrapGit(await getStatus(repoPath, mode, log));
  },
  async getDiff(repoPath, filePath, mode, oldPath): Promise<GitDiffOutput> {
    return unwrapGit(await getDiff(repoPath, filePath, mode, log, oldPath));
  },
};

// ── The daemon-backed terminal handle ──────────────────────────────────

/** A `TerminalHandle` whose control verbs forward to the daemon over the
 *  socket. Every verb waits on `ready` first — R4c turned `spawn` into an
 *  async RPC, so a tile that renders on the sync shadow can issue
 *  attach/write/resize *before* the daemon has created the PTY. Without the
 *  gate, attach hit "no PTY with id …" and early keystrokes were silently
 *  dropped. `write`/`resize` queue behind `ready` (fire-and-forget once
 *  released — a localhost socket round-trip is cheap and the PTY is the
 *  authority); `getScreenState`/`getScreenText`/`attach` await it (so the
 *  contract widened those to allow a Promise). Holds only the terminal id +
 *  pid — the live reads (cwd / process / foregroundPid) the providers need
 *  arrive over the daemon's tap streams, not this handle. */
class DaemonTerminalProxy implements TerminalHandle {
  pid = 0;
  /** Resolves once the daemon `terminal.spawn` RPC has created the PTY (or
   *  immediately, for a reattached terminal whose PTY already exists).
   *  Rejects if spawn failed, so a queued write / awaited attach surfaces the
   *  failure instead of hanging or hitting a missing PTY. */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;

  /** `getClient` is injected (not reached out of the supervisor singleton
   *  per-verb): it makes the precondition explicit — a proxy is only ever
   *  constructed once a daemon handle exists — and keeps the proxy decoupled
   *  from how the handle is resolved. */
  constructor(
    private readonly id: TerminalId,
    private readonly getClient: () => PtyHostClient,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A spawn failure with nothing yet awaiting `ready` must not reach the
    // process-wide unhandledRejection handler (which would exit the server).
    this.ready.catch(() => {});
  }

  /** PTY exists — release queued/awaiting verbs. */
  markReady(pid: number): void {
    this.pid = pid;
    this.resolveReady();
  }

  /** Spawn failed (or raced a kill) — fail queued/awaiting verbs. */
  markFailed(err: unknown): void {
    this.rejectReady(err);
  }

  write(data: string): void {
    void this.ready
      .then(() =>
        this.getClient().surface.terminal.write({ id: this.id, data }),
      )
      .catch((err) => log.error({ terminal: this.id, err }, "daemon write"));
  }

  resize(cols: number, rows: number): void {
    void this.ready
      .then(() =>
        this.getClient().surface.terminal.resize({ id: this.id, cols, rows }),
      )
      .catch((err) => log.error({ terminal: this.id, err }, "daemon resize"));
  }

  async getScreenState(): Promise<string> {
    await this.ready;
    const { data } = await this.getClient().surface.terminal.getScreenState({
      id: this.id,
    });
    return data;
  }

  async getScreenText(startLine?: number, endLine?: number): Promise<string> {
    await this.ready;
    const { text } = await this.getClient().surface.terminal.getScreenText({
      id: this.id,
      startLine,
      endLine,
    });
    return text;
  }
}

// ── Per-terminal provider bridge ───────────────────────────────────────

/** Pump a daemon tap stream into a callback until it ends or `signal` aborts
 *  (kill / exit). The oRPC stream call resolves to the async iterable (a
 *  `ClientPromiseResult`), so the source is awaited first. An aborted socket
 *  stream surfaces as a thrown error, so an aborted signal is treated as
 *  expected teardown, not a failure. */
function bridgeStream<T>(
  source: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
): void {
  void (async () => {
    try {
      const iter = await source;
      for await (const value of iter) onEvent(value);
    } catch (err) {
      if (signal.aborted) return;
      log.error({ err }, "daemon tap subscription failed");
    }
  })();
}

/** Wire the provider hooks to kolu-server's metadata + activity surfaces.
 *  `record.meta` IS `entry.meta` (same object), so a provider mutating its
 *  record is publishing kolu-server state directly — the pre-R4b shape,
 *  restored now that providers run in kolu-server again. */
function makeHooks(entry: TerminalProcess, id: TerminalId): ProviderHooks {
  return {
    updateServerMetadata: (_record, mutate) =>
      updateServerMetadata(entry, id, mutate),
    updateServerLiveMetadata: (_record, mutate) =>
      updateServerLiveMetadata(entry, id, mutate),
    trackRecentRepo: (root, name) => trackRecentRepo(root, name),
    trackRecentAgent: (command) => trackRecentAgent(command),
  };
}

/** Everything needed to stop one terminal's local provider DAG + tap
 *  bridges: abort the daemon-stream subscriptions and stop the watchers. */
interface TerminalLifecycle {
  abort: AbortController;
  stopProviders: () => void;
}

// ── Backend implementation ─────────────────────────────────────────────

class LocalTerminalBackend implements TerminalBackend {
  readonly fs = localFs;
  readonly git = localGit;

  /** id → its provider-DAG + tap-bridge teardown. Its keys ARE the terminals
   *  with a live provider layer in this process. */
  private readonly lifecycles = new Map<TerminalId, TerminalLifecycle>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    // Sync shadow: register a connecting entry (proxy handle + default
    // metadata) so the tile renders immediately — the `TerminalBackend.
    // spawnPty` sync-shadow contract. The daemon resolves the authoritative
    // cwd / pid on the async tail below; the provider DAG starts there too.
    const cwd = opts.cwd || process.env.HOME || "/";
    const proxy = new DaemonTerminalProxy(id, () => getDaemonHandle().client);
    const meta: TerminalMetadata = { ...createMetadata(cwd) };
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.intent) meta.intent = initial.intent;
    if (initial?.lastActivityAt !== undefined)
      meta.lastActivityAt = initial.lastActivityAt;

    const entry: TerminalProcess = {
      info: { id, pid: 0 },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    emitTerminalsDirty();
    emitTerminalListChanged();

    void this.daemonSpawnAndWire(id, opts, proxy, entry, tlog);
    return entry.info;
  }

  /** Async tail of `spawnPty`: the daemon RPC that starts the PTY, then the
   *  local provider DAG against its taps. On failure unwinds the shadow. */
  private async daemonSpawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: DaemonTerminalProxy,
    entry: TerminalProcess,
    tlog: typeof log,
  ): Promise<void> {
    try {
      const client = getDaemonHandle().client;
      const res = await client.surface.terminal.spawn({ id, cwd: opts.cwd });
      // The terminal may have been killed while the spawn RPC was in flight.
      if (!getTerminal(id)) {
        proxy.markFailed(new Error("terminal killed during spawn"));
        try {
          await client.surface.terminal.kill({ id });
        } catch (err) {
          tlog.error({ err }, "daemon kill of spawn-raced terminal failed");
        }
        return;
      }
      proxy.markReady(res.pid);
      entry.info.pid = res.pid;
      // Seed the daemon's authoritative resolved cwd before starting the DAG
      // (the git watcher reads `record.meta.cwd` at start).
      updateServerMetadata(entry, id, (m) => {
        m.cwd = res.cwd;
      });
      this.startProviderLayer(id, entry, res.pid);
      tlog.info({ pid: res.pid, total: listTerminals().length }, "created");
      emitTerminalListChanged();
    } catch (err) {
      tlog.error({ err }, "daemon terminal.spawn failed");
      proxy.markFailed(err);
      if (getTerminal(id)) {
        unregisterTerminal(id);
        emitTerminalsDirty();
        emitTerminalListChanged();
      }
    }
  }

  /** Start the per-terminal provider DAG against the daemon's tap streams.
   *  Shared by spawn (fresh PTY) and reattach (surviving PTY → fresh
   *  detection). The DAG runs HERE, in kolu-server, so it's always the
   *  current build's code. */
  private startProviderLayer(
    id: TerminalId,
    entry: TerminalProcess,
    pid: number,
  ): void {
    const client = getDaemonHandle().client;
    const abort = new AbortController();
    const { signal } = abort;
    const channels: ProviderChannels = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      git: inMemoryChannel<GitInfo | null>(),
    };
    const record: ProviderRecord = {
      pid,
      meta: entry.meta,
      currentAgent: null,
    };
    const hooks = makeHooks(entry, id);

    // Bridge the daemon's raw VT taps onto the provider channels. cwd also
    // lands on persisted metadata (the bridge owns `m.cwd`; the git provider
    // reads `channels.cwd` to re-resolve git) — the pre-R4b split, relocated
    // over a socket.
    bridgeStream(client.surface.cwd.get({ id }, { signal }), signal, (msg) => {
      updateServerMetadata(entry, id, (m) => {
        m.cwd = msg.cwd;
      });
      channels.cwd.publish(msg.cwd);
    });
    bridgeStream(client.surface.title.get({ id }, { signal }), signal, (msg) =>
      channels.title.publish(msg.title),
    );
    bridgeStream(
      client.surface.commandRun.get({ id }, { signal }),
      signal,
      (msg) => channels.commandRun.publish(msg.command),
    );
    bridgeStream(
      client.surface.foreground.get({ id }, { signal }),
      signal,
      (msg) =>
        channels.foreground.publish({
          process: msg.process,
          foregroundPid: msg.foregroundPid,
        }),
    );
    const stopProviders = startProviders(record, id, channels, hooks);

    // Natural exit: the daemon's `exit` tap yields the code once. An
    // intentional kill aborts this signal first (see `teardownProviders`),
    // so `handleExit` only ever fires for a genuine exit.
    bridgeStream(client.surface.exit.get({ id }, { signal }), signal, (msg) =>
      this.handleExit(id, msg.exitCode),
    );

    this.lifecycles.set(id, { abort, stopProviders });
  }

  /** Stop a terminal's provider DAG + tap bridges (idempotent). Aborting the
   *  signal ends every daemon-stream subscription — including the `exit` tap,
   *  so a kill that calls this BEFORE the daemon kill can't trip
   *  `handleExit`. */
  private teardownProviders(id: TerminalId): void {
    const lc = this.lifecycles.get(id);
    if (!lc) return;
    this.lifecycles.delete(id);
    lc.abort.abort();
    lc.stopProviders();
  }

  /** Re-register a terminal the daemon still owns after a kolu-server restart
   *  — NO spawn — then start a FRESH provider DAG against its taps so
   *  detection re-resolves the real current state (never a stale guess).
   *  Persisted metadata is seeded from the saved session; live state
   *  re-detects. */
  reattachPty(
    listed: PtyHostListEntry,
    saved: SavedTerminal | undefined,
  ): TerminalInfo {
    const id = listed.id;
    const proxy = new DaemonTerminalProxy(id, () => getDaemonHandle().client);
    // The daemon already owns this PTY (it survived our restart), so the
    // readiness gate opens immediately — no spawn RPC to wait on.
    proxy.markReady(listed.pid);
    const meta: TerminalMetadata = { ...createMetadata(listed.cwd) };
    meta.lastActivityAt = saved?.lastActivityAt ?? listed.lastActivity ?? 0;
    if (saved) {
      if (saved.git !== undefined) meta.git = saved.git;
      if (saved.lastAgentCommand !== undefined)
        meta.lastAgentCommand = saved.lastAgentCommand;
      if (saved.parentId) meta.parentId = saved.parentId;
      if (saved.themeName) meta.themeName = saved.themeName;
      if (saved.canvasLayout) meta.canvasLayout = saved.canvasLayout;
      if (saved.subPanel) meta.subPanel = saved.subPanel;
      if (saved.rightPanel) meta.rightPanel = saved.rightPanel;
      if (saved.intent) meta.intent = saved.intent;
    }
    const entry: TerminalProcess = {
      info: { id, pid: listed.pid },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    this.startProviderLayer(id, entry, listed.pid);
    log.child({ terminal: id }).info({ pid: listed.pid }, "reattached");
    // No `terminals:dirty` — reattach restores existing state, it does not
    // mutate it. The list cell republishes so the client renders the tile.
    emitTerminalListChanged();
    return entry.info;
  }

  /** A terminal's PTY exited naturally. Stop its provider layer, publish the
   *  exit, drop the entry, save the session. */
  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    this.teardownProviders(id);
    cleanupTerminalScratch(id);
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  async killTerminal(id: TerminalId): Promise<TerminalInfo | undefined> {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    const tlog = log.child({ terminal: id });
    tlog.info({ pid: entry.info.pid }, "killing");
    // Stop the provider layer FIRST — this aborts the `exit` tap, so the
    // daemon's exit (which fires on an intentional kill too, since the daemon
    // is a pure pty-host with no kill/exit distinction) can't reach
    // `handleExit` and double-publish `terminalExit`. The kill RPC's response
    // drives client cleanup instead.
    this.teardownProviders(id);
    // Confirm the daemon killed it BEFORE unregistering — a failed kill RPC
    // that dropped the UI entry would resurrect the PTY as an orphan on the
    // next reattach. On failure we still unregister (don't strand the UI).
    try {
      await getDaemonHandle().client.surface.terminal.kill({ id });
    } catch (err) {
      tlog.error({ err }, "daemon kill failed; unregistering anyway");
    }
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  async killAllTerminals(): Promise<void> {
    const ids = listTerminals().map((info) => info.id);
    log.info({ count: ids.length }, "killing all terminals");
    for (const id of ids) this.teardownProviders(id);
    // Confirm the daemon dropped every PTY before draining, so a failed RPC
    // can't leave orphans the next reattach resurrects (see `killTerminal`).
    try {
      await getDaemonHandle().client.surface.terminal.killAll({});
    } catch (err) {
      log.error({ err }, "daemon killAll failed; draining anyway");
    }
    const entries = drainTerminals();
    for (const entry of entries) cleanupTerminalScratch(entry.info.id);
    emitTerminalListChanged();
  }

  async attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
  ): Promise<TerminalAttachment> {
    // Wait for the daemon to have actually created the PTY before opening the
    // attach stream — otherwise a tile attaching off the sync shadow races
    // the in-flight `terminal.spawn` and the daemon throws "no PTY with id".
    // Rejects (surfaces) if spawn failed.
    const entry = getTerminal(id);
    if (entry?.handle instanceof DaemonTerminalProxy) await entry.handle.ready;
    const client = getDaemonHandle().client;
    const stream = await client.surface.terminalAttach.get({ id }, { signal });
    const iter = stream[Symbol.asyncIterator]();
    // The daemon yields the screen-state snapshot first, then deltas.
    const first = await iter.next();
    let snapshot = "";
    let pendingDelta: string | undefined;
    if (!first.done) {
      if (first.value.kind === "snapshot") snapshot = first.value.data;
      else pendingDelta = first.value.data;
    }
    const deltas = (async function* () {
      if (pendingDelta !== undefined) yield pendingDelta;
      if (first.done) return;
      for await (const msg of { [Symbol.asyncIterator]: () => iter }) {
        yield msg.data;
      }
    })();
    return { snapshot, deltas };
  }
}

const backend = new LocalTerminalBackend();
export const localTerminalBackend: TerminalBackend = backend;

/** Reattach to PTYs the daemon still owns after a kolu-server restart.
 *  Returns the count reattached. `savedById` is the boot caller's join of the
 *  saved session keyed by terminal id (the session-restore concern stays in
 *  `server.ts`'s boot orchestration, not in this transport module);
 *  daemon-owned PTYs with no saved entry are reattached with defaults. */
export async function reattachLocalTerminals(
  savedById: ReadonlyMap<string, SavedTerminal>,
): Promise<number> {
  // Ensure the daemon is up (boot calls this before reattach — the daemon
  // isn't running at module-eval time, unlike the in-process R4b agent).
  await ensureDaemon();
  const client = getDaemonHandle().client;
  let listed: PtyHostListEntry[];
  try {
    const res = await client.surface.terminal.list({});
    listed = res.entries;
  } catch (err) {
    log.error({ err }, "daemon terminal.list failed; skipping reattach");
    return 0;
  }
  if (listed.length === 0) return 0;
  for (const entry of listed) {
    backend.reattachPty(entry, savedById.get(entry.id));
  }
  log.info({ count: listed.length }, "reattached terminals from daemon");
  return listed.length;
}
