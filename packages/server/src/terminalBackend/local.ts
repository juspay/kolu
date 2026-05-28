/**
 * `LocalTerminalBackend` — terminals on this machine, but the PTY
 * itself lives in the long-lived `kolu --stdio` daemon (R-4), not in
 * this kolu-server process. That's what makes local terminals survive
 * kolu-server restart: the daemon keeps the node-pty children and their
 * `@xterm/headless` scrollback mirrors alive across our death.
 *
 * This backend is the daemon's loopback *client*. For each terminal it:
 *
 *   - calls `terminal.spawn` on the daemon's `agentSurface` (unix
 *     socket) to create the PTY, passing the kolu-server-minted id so
 *     the daemon's PTY id == our terminal id (reattach-by-id);
 *   - bridges the daemon's per-terminal streams (`terminalAttach`,
 *     `terminalCwd`, `terminalTitle`, `terminalCommandRun`,
 *     `terminalExit`) back into kolu-server's `terminalChannels`, so the
 *     existing client `attach` flow and the in-process provider DAG keep
 *     working unchanged;
 *   - runs the provider DAG (`./providers.ts`) HERE, in kolu-server —
 *     git/GitHub/agent detection stay local because the daemon is on the
 *     same machine. The providers read `process`/`foregroundPid` from a
 *     `DaemonTerminalProxy` whose cache is fed by the daemon's enriched
 *     title stream (no per-read RPC).
 *
 * The fs/git surfaces still shell out locally (same machine as the
 * daemon). On kolu-server restart, `reattachPty` rebuilds all of the
 * above for each PTY the daemon still owns — see `terminals.ts`'s
 * `reattachLocalTerminals`.
 */

import { homedir } from "node:os";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type {
  SavedTerminal,
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import type {
  PtySpawnOpts,
  ReattachEntry,
  TerminalBackend,
  TerminalBackendFs,
  TerminalBackendGit,
  TerminalChannelMap,
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
import type { GitDiffMode } from "kolu-git/schemas";
import pkg from "../../package.json" with { type: "json" };
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import { type AgentClient, getDaemonHandle } from "../daemon/supervisor.ts";
import { log } from "../log.ts";
import { terminalChannels, terminalsDirtyChannel } from "../publisher.ts";
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
  startProviders,
} from "./providers.ts";

// ── PTY-state notification helpers ─────────────────────────────────────

function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}

function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

// ── Local fs/git surfaces (same machine as the daemon) ──────────────────

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

// ── Daemon-backed terminal handle ───────────────────────────────────────

/** One object satisfying BOTH `TerminalHandle` (the registry's control
 *  surface — write/resize/getScreen* + pid) AND `ProviderPtyView` (the
 *  slice the provider DAG reads — pid/process/foregroundPid). Control
 *  verbs proxy to the daemon over RPC; `process`/`foregroundPid` are a
 *  local cache the stream bridge refreshes on every enriched title
 *  event, so the providers read them synchronously without a per-read
 *  round-trip. */
class DaemonTerminalProxy {
  pid = 0;
  process = "";
  foregroundPid: number | undefined = undefined;

  constructor(
    private readonly id: TerminalId,
    private readonly client: AgentClient,
  ) {}

  write(data: string): void {
    void this.client.surface.terminal
      .write({ id: this.id, data })
      .catch((err: Error) =>
        log.warn(
          { terminal: this.id, err: err.message },
          "daemon write failed",
        ),
      );
  }

  resize(cols: number, rows: number): void {
    void this.client.surface.terminal
      .resize({ id: this.id, cols, rows })
      .catch((err: Error) =>
        log.warn(
          { terminal: this.id, err: err.message },
          "daemon resize failed",
        ),
      );
  }

  async getScreenState(): Promise<string> {
    const r = await this.client.surface.terminal.getScreenState({
      id: this.id,
    });
    return r.data;
  }

  async getScreenText(startLine?: number, endLine?: number): Promise<string> {
    const r = await this.client.surface.terminal.getScreenText({
      id: this.id,
      startLine,
      endLine,
    });
    return r.text;
  }
}

// ── Backend implementation ─────────────────────────────────────────────

interface LocalTerminalRecord {
  ptyHandle: DaemonTerminalProxy;
  meta: TerminalMetadata;
  currentAgent: string | null;
  stopProviders: () => void;
  stopBridge: () => void;
}

const noop = (): void => {};

function requireDaemon(): AgentClient {
  const handle = getDaemonHandle();
  if (!handle) {
    throw new Error(
      "local PTY-host daemon is not connected — kolu-server boot should " +
        "have called ensureDaemon() before any terminal spawn",
    );
  }
  return handle.client;
}

class LocalTerminalBackend implements TerminalBackend {
  readonly fs = localFs;
  readonly git = localGit;

  private readonly records = new Map<TerminalId, LocalTerminalRecord>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const client = requireDaemon();
    // Sync shadow: register the entry + a proxy handle immediately so
    // the tile renders, then do the async daemon spawn on a later tick
    // (sync-shadow invariant in TerminalBackend).
    const proxy = new DaemonTerminalProxy(id, client);
    const meta = createMetadata(opts.cwd ?? homedir());
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.lastActivityAt !== undefined)
      meta.lastActivityAt = initial.lastActivityAt;
    if (initial?.intent) meta.intent = initial.intent;

    const entry: TerminalProcess = {
      info: { id, pid: 0 },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    const record: LocalTerminalRecord = {
      ptyHandle: proxy,
      meta,
      currentAgent: null,
      stopProviders: noop,
      stopBridge: noop,
    };
    this.records.set(id, record);

    void this.daemonSpawnAndWire(id, opts, proxy, record, entry, client);

    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  /** Async tail of `spawnPty`: ask the daemon to create the PTY, then
   *  seed the proxy + start the stream bridge + provider DAG. Errors
   *  unwind the sync shadow so a failed spawn doesn't leave a zombie
   *  registry entry. */
  private async daemonSpawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: DaemonTerminalProxy,
    record: LocalTerminalRecord,
    entry: TerminalProcess,
    client: AgentClient,
  ): Promise<void> {
    const tlog = log.child({ terminal: id });
    try {
      const res = await client.surface.terminal.spawn({
        id,
        cwd: opts.cwd,
        termProgramVersion: pkg.version,
        scrollback: DEFAULT_SCROLLBACK,
      });
      // The terminal may have been killed while the spawn was in flight.
      if (!this.records.has(id)) {
        client.surface.terminal.kill({ id }).catch(() => {});
        return;
      }
      proxy.pid = res.pid;
      proxy.process = res.process;
      proxy.foregroundPid = res.pid; // shell is foreground initially
      entry.info.pid = res.pid;
      updateServerMetadata(entry, id, (m) => {
        m.cwd = res.cwd;
      });
      record.stopBridge = this.startBridge(id, proxy, entry, client);
      record.stopProviders = startProviders(
        record,
        id,
        buildChannels(id),
        buildHooks(entry, id),
      );
      tlog.info(
        { pid: res.pid, total: listTerminals().length },
        "created (daemon-backed)",
      );
      emitTerminalsDirty();
      emitTerminalListChanged();
    } catch (err) {
      tlog.error({ err: (err as Error).message }, "daemon spawn failed");
      this.records.delete(id);
      unregisterTerminal(id);
      emitTerminalListChanged();
    }
  }

  reattachPty(
    entry: ReattachEntry,
    saved: SavedTerminal | undefined,
  ): TerminalInfo {
    const client = requireDaemon();
    const id = entry.id;
    const tlog = log.child({ terminal: id });
    const proxy = new DaemonTerminalProxy(id, client);
    proxy.pid = entry.pid;
    proxy.foregroundPid = entry.pid;
    // `process` stays "" until the first title event; providers re-derive
    // foreground on the next OSC 2.

    const meta = metaFromSaved(saved, entry.cwd);
    const reg: TerminalProcess = {
      info: { id, pid: entry.pid },
      meta,
      handle: proxy,
    };
    registerTerminal(id, reg);
    const record: LocalTerminalRecord = {
      ptyHandle: proxy,
      meta,
      currentAgent: null,
      stopProviders: noop,
      stopBridge: noop,
    };
    this.records.set(id, record);
    record.stopBridge = this.startBridge(id, proxy, reg, client);
    record.stopProviders = startProviders(
      record,
      id,
      buildChannels(id),
      buildHooks(reg, id),
    );
    tlog.info({ pid: entry.pid }, "reattached (daemon-backed)");
    emitTerminalListChanged();
    return reg.info;
  }

  /** Bridge one daemon terminal's streams into kolu-server's
   *  `terminalChannels` + metadata. Returns a teardown that aborts all
   *  subscriptions. */
  private startBridge(
    id: TerminalId,
    proxy: DaemonTerminalProxy,
    entry: TerminalProcess,
    client: AgentClient,
  ): () => void {
    const ac = new AbortController();
    const { signal } = ac;
    const tlog = log.child({ terminal: id });

    // PTY output: skip the snapshot (the client's `attach` pulls a fresh
    // one via `getScreenState`), republish deltas to the data channel.
    void pump(
      client.surface.terminalAttach.get({ id }, { signal }),
      (msg) => {
        if (msg.kind === "delta") terminalChannels.data(id).publish(msg.data);
      },
      signal,
      tlog,
      "terminalAttach",
    );
    void pump(
      client.surface.terminalCwd.get({ id }, { signal }),
      (cwd) => {
        updateServerMetadata(entry, id, (m) => {
          m.cwd = cwd;
        });
        terminalChannels.cwd(id).publish(cwd);
      },
      signal,
      tlog,
      "terminalCwd",
    );
    void pump(
      client.surface.terminalTitle.get({ id }, { signal }),
      (ev) => {
        // Refresh the provider-visible cache BEFORE publishing the title
        // — the process observer + agent detectors read these
        // synchronously when the title channel fires.
        proxy.process = ev.process;
        proxy.foregroundPid = ev.foregroundPid;
        terminalChannels.title(id).publish(ev.title);
      },
      signal,
      tlog,
      "terminalTitle",
    );
    void pump(
      client.surface.terminalCommandRun.get({ id }, { signal }),
      (cmd) => {
        terminalChannels.commandRun(id).publish(cmd);
      },
      signal,
      tlog,
      "terminalCommandRun",
    );
    void pump(
      client.surface.terminalExit.get({ id }, { signal }),
      (ev) => {
        this.handleExit(id, ev.exitCode);
      },
      signal,
      tlog,
      "terminalExit",
    );

    return () => ac.abort();
  }

  /** Mirror of the in-process `onExit` path: stop providers + bridge,
   *  scrub scratch, unregister, publish the exit event, and republish
   *  the list on natural exit. */
  private handleExit(id: TerminalId, exitCode: number): void {
    log.child({ terminal: id }).info({ exitCode }, "exited (daemon-backed)");
    const record = this.records.get(id);
    if (record) {
      record.stopProviders();
      record.stopBridge();
      cleanupTerminalScratch(id);
      this.records.delete(id);
    }
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    const wasNaturalExit = unregisterTerminal(id);
    if (wasNaturalExit) {
      emitTerminalsDirty();
      emitTerminalListChanged();
    }
  }

  killTerminal(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    const record = this.records.get(id);

    log.child({ terminal: id }).info({ pid: entry.info.pid }, "killing");
    if (record) {
      record.stopProviders();
      record.stopBridge();
      this.records.delete(id);
    }
    // Tell the daemon to kill the actual PTY. Fire-and-forget — the
    // daemon's exit handler is authoritative, but we've already torn
    // down our local mirror above so a late exit event is a no-op.
    requireDaemon()
      .surface.terminal.kill({ id })
      .catch((err: Error) =>
        log.warn({ terminal: id, err: err.message }, "daemon kill failed"),
      );
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  killAllTerminals(): void {
    // Snapshot registry + own records, clear both BEFORE killing — so
    // exit events can't find terminals and trigger session saves.
    const entries = drainTerminals();
    const records = [...this.records.values()];
    this.records.clear();
    log.info({ count: entries.length }, "killing all terminals");
    for (const record of records) {
      record.stopProviders();
      record.stopBridge();
    }
    for (const entry of entries) {
      cleanupTerminalScratch(entry.info.id);
    }
    // One round-trip to the daemon kills every PTY it owns for this
    // state dir (used by the e2e harness between scenarios).
    requireDaemon()
      .surface.terminal.killAll({})
      .catch((err: Error) =>
        log.warn({ err: err.message }, "daemon killAll failed"),
      );
    emitTerminalListChanged();
  }

  subscribeTerminalChannel<K extends keyof TerminalChannelMap>(
    id: TerminalId,
    kind: K,
    signal: AbortSignal | undefined,
  ): AsyncIterable<TerminalChannelMap[K]> {
    // The narrowing on `K` makes the `as` necessary — TS can't see that
    // the runtime `kind` indexes a typed channel of the right element
    // type.
    return terminalChannels[kind](id).subscribe(signal) as AsyncIterable<
      TerminalChannelMap[K]
    >;
  }
}

/** Pump a daemon stream into a per-event callback until the signal
 *  aborts or the iterable ends. Swallows post-abort errors (a teardown
 *  closing the socket mid-iteration is expected, not an error). */
async function pump<T>(
  iterPromise: Promise<AsyncIterable<T>>,
  onEach: (value: T) => void,
  signal: AbortSignal,
  tlog: typeof log,
  label: string,
): Promise<void> {
  try {
    const iter = await iterPromise;
    for await (const value of iter) {
      if (signal.aborted) break;
      onEach(value);
    }
  } catch (err) {
    if (!signal.aborted) {
      tlog.warn({ err: (err as Error).message, stream: label }, "bridge ended");
    }
  }
}

/** Build a full `TerminalMetadata` for a reattached terminal: live
 *  fields (pr/agent/foreground) default to "unknown" and get re-derived
 *  by the restarted providers; persisted fields come from the saved
 *  session entry when one matched by id, else from spawn-time defaults. */
function metaFromSaved(
  saved: SavedTerminal | undefined,
  cwd: string,
): TerminalMetadata {
  const base = createMetadata(saved?.cwd ?? cwd);
  if (!saved) return base;
  const { id: _id, ...persisted } = saved;
  return { ...base, ...persisted };
}

/** Map this backend's publisher-backed terminal channels onto the
 *  shape `startProviders` expects. */
function buildChannels(id: TerminalId): ProviderChannels {
  return {
    cwd: terminalChannels.cwd(id),
    title: terminalChannels.title(id),
    commandRun: terminalChannels.commandRun(id),
    git: terminalChannels.git(id),
  };
}

/** Build the `ProviderHooks` for one terminal. */
function buildHooks(entry: TerminalProcess, id: TerminalId): ProviderHooks {
  return {
    updateServerMetadata: (_record, mutate) =>
      updateServerMetadata(entry, id, mutate),
    updateServerLiveMetadata: (_record, mutate) =>
      updateServerLiveMetadata(entry, id, mutate),
    trackRecentRepo,
    trackRecentAgent,
  };
}

export const localTerminalBackend: TerminalBackend = new LocalTerminalBackend();
