/**
 * `LocalTerminalBackend` — this kolu process. Since #951 **R4c** it is the
 * unix-socket **client** of the `kolu --stdio` daemon (the agent). The daemon
 * owns `@kolu/pty-host` AND the per-terminal provider DAG and serves
 * `agentSurface`; this backend forwards spawn/kill/write/resize/attach over
 * the socket and consumes the single `agentMetadata` stream
 * (snapshot-then-delta), mirroring it onto kolu-server's surface plumbing.
 *
 * The change from R4b is purely the *transport*: in R4b the agent ran in this
 * process and `agent.metadata` was an in-process `Channel`; now it's a daemon
 * across a socket. The demux (`applyAgentEvent`), the `terminals:dirty`
 * autosave trigger, the activity feed, the registry, and `TerminalBackend.
 * fs/git` all stay exactly as they were — the agent's `AgentMetadataEvent`
 * shape is transport-independent by design.
 *
 * Reattach across kolu-server restart: the daemon (and its PTYs + providers)
 * survives this process dying. On boot, `reattachLocalTerminals` asks the
 * daemon which PTYs it still owns (`terminal.list`), matches them to the saved
 * session by id, and re-registers each entry *without spawning* — so the
 * client's retried `attach`-by-id streams reconnect to the same shells with
 * scrollback intact, and the still-running providers replay warm metadata over
 * the `agentMetadata` snapshot.
 *
 * Three things stay on this side of the boundary, because they're
 * cross-terminal / UI concerns the agent can't own once it's remote:
 *
 *   - the `terminalMetadata` collection + the `terminals:dirty` autosave
 *     trigger (fired only for the stream's `metadataPersisted` half);
 *   - the activity feed (recent-repos / recent-agents MRUs), fed by the
 *     stream's `recentRepo` / `recentAgent` events;
 *   - `TerminalBackend.fs/git`, which stay abstracted per-location and (for
 *     local) shell out to `kolu-git` directly.
 */

import type {
  AgentMetadataEvent,
  AgentTerminalListEntry,
} from "kolu-common/agentSurface";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
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
import type { GitDiffMode } from "kolu-git/schemas";
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import {
  type AgentClient,
  ensureDaemon,
  getDaemonHandle,
} from "../daemon/supervisor.ts";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { getSavedSession } from "../session.ts";
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

// ── PTY-state notification helpers ─────────────────────────────────────

/** Notify that terminal state changed (drives debounced session
 *  auto-save). Distinct from the `terminalList` cell's content channel:
 *  this is the *trigger*, not the saved content. */
function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}

/** Republish the live `terminalList` cell. Backend lifecycle calls this
 *  on create / kill / reattach; client metadata setters publish via the
 *  metadata collection instead. */
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
 *  socket. `write`/`resize` are fire-and-forget (matching the synchronous
 *  in-process handle they replace — a localhost socket round-trip is cheap
 *  and the PTY is the authority); `getScreenState`/`getScreenText` round-trip
 *  (so the `TerminalHandle` contract widened those two to allow a Promise).
 *  Holds only the terminal id + pid — the host-only members (cwd / process /
 *  foregroundPid) the providers read stay inside the daemon. */
class DaemonTerminalProxy implements TerminalHandle {
  pid = 0;
  constructor(private readonly id: TerminalId) {}

  private client(): AgentClient {
    return getDaemonHandle().client;
  }

  write(data: string): void {
    void this.client()
      .surface.terminal.write({ id: this.id, data })
      .catch((err) => log.error({ terminal: this.id, err }, "daemon write"));
  }

  resize(cols: number, rows: number): void {
    void this.client()
      .surface.terminal.resize({ id: this.id, cols, rows })
      .catch((err) => log.error({ terminal: this.id, err }, "daemon resize"));
  }

  async getScreenState(): Promise<string> {
    const { data } = await this.client().surface.terminal.getScreenState({
      id: this.id,
    });
    return data;
  }

  async getScreenText(startLine?: number, endLine?: number): Promise<string> {
    const { text } = await this.client().surface.terminal.getScreenText({
      id: this.id,
      startLine,
      endLine,
    });
    return text;
  }
}

// ── Backend implementation ─────────────────────────────────────────────

class LocalTerminalBackend implements TerminalBackend {
  readonly fs = localFs;
  readonly git = localGit;

  /** Lifetime-of-process subscription to the daemon's `agentMetadata`
   *  stream. Started by `startLocalTerminalBridge` at boot (the daemon
   *  isn't up at module-eval time, unlike the in-process R4b agent), AFTER
   *  reattach has registered the surviving entries — so the stream's
   *  warm-metadata snapshot lands on entries that already exist. */
  private bridge: AbortController | undefined;

  /** Subscribe once to the daemon's metadata stream and demux by id.
   *  Re-subscribes on a clean end / error (the snapshot replays warm
   *  metadata each time), so a transient daemon hiccup doesn't permanently
   *  silence metadata for every terminal. */
  start(): void {
    if (this.bridge) return;
    const ctrl = new AbortController();
    this.bridge = ctrl;
    void this.pumpAgentMetadata(ctrl.signal);
  }

  private async pumpAgentMetadata(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        // `ensureDaemon` (not the cached handle) so a re-subscribe after a
        // drop reconnects to a live daemon — a stdio socket can't self-heal,
        // so re-subscribing on the dead client would loop forever. The fresh
        // subscription's snapshot replays warm metadata.
        const { client } = await ensureDaemon();
        const stream = await client.surface.agentMetadata.get({}, { signal });
        for await (const ev of stream) this.applyAgentEvent(ev);
      } catch (err) {
        if (signal.aborted) return;
        log.error({ err }, "agent metadata stream failed; re-subscribing");
      }
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Mirror one agent-stream event onto kolu-server state. The event type
   *  carries the autosave fence: `metadataPersisted` routes through the
   *  persisting helper (fires `terminals:dirty`), `metadataLive` through the
   *  live one (does not). Each carries only its half of the partition, so
   *  applying it is one fenced `Object.assign`.
   *
   *  Per-event try/catch is load-bearing: this runs inside ONE shared loop
   *  for every terminal; a single bad event (a failed publish, a scratch
   *  error, …) must not escape and silence metadata + exit mirroring for ALL
   *  terminals. Log and keep the loop alive. */
  private applyAgentEvent(ev: AgentMetadataEvent): void {
    try {
      switch (ev.kind) {
        case "metadataPersisted": {
          const entry = getTerminal(ev.id);
          if (!entry) return;
          updateServerMetadata(entry, ev.id, (m) => {
            Object.assign(m, ev.fields);
          });
          return;
        }
        case "metadataLive": {
          const entry = getTerminal(ev.id);
          if (!entry) return;
          updateServerLiveMetadata(entry, ev.id, (m) => {
            Object.assign(m, ev.fields);
          });
          return;
        }
        case "recentRepo":
          trackRecentRepo(ev.root, ev.name);
          return;
        case "recentAgent":
          trackRecentAgent(ev.command);
          return;
        case "exit":
          this.handleExit(ev.id, ev.exitCode);
          return;
      }
    } catch (err) {
      log.error(
        { err, kind: ev.kind },
        "failed to apply agent metadata event (subscription kept alive)",
      );
    }
  }

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    // Sync shadow: register a connecting entry (proxy handle + default
    // metadata) so the tile renders immediately, exactly the
    // `TerminalBackend.spawnPty` sync-shadow contract. The daemon resolves
    // the authoritative cwd / pid / metadata on the async tail below.
    const cwd = opts.cwd || process.env.HOME || "/";
    const proxy = new DaemonTerminalProxy(id);
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

  /** Async tail of `spawnPty`: the daemon RPC that actually starts the PTY.
   *  On success seeds the pid + authoritative metadata; on failure unwinds
   *  the shadow entry so nothing half-live is left behind. */
  private async daemonSpawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: DaemonTerminalProxy,
    entry: TerminalProcess,
    tlog: typeof log,
  ): Promise<void> {
    try {
      const client = getDaemonHandle().client;
      const res = await client.surface.terminal.spawn({
        id,
        cwd: opts.cwd,
        scrollback: DEFAULT_SCROLLBACK,
        restoredActivityAt: opts.initialMetadata?.lastActivityAt,
      });
      // The terminal may have been killed while the spawn RPC was in flight.
      if (!getTerminal(id)) {
        void client.surface.terminal.kill({ id }).catch(() => {});
        return;
      }
      proxy.pid = res.pid;
      entry.info.pid = res.pid;
      // Apply the agent's authoritative initial metadata. Idempotent with the
      // `agentMetadata` stream deltas that follow.
      updateServerMetadata(entry, id, (m) => {
        m.cwd = res.meta.cwd;
        m.git = res.meta.git;
        m.lastAgentCommand = res.meta.lastAgentCommand;
        m.lastActivityAt = res.meta.lastActivityAt;
      });
      updateServerLiveMetadata(entry, id, (m) => {
        m.pr = res.meta.pr;
        m.agent = res.meta.agent;
        m.foreground = res.meta.foreground;
      });
      tlog.info({ pid: res.pid, total: listTerminals().length }, "created");
      emitTerminalListChanged();
    } catch (err) {
      tlog.error({ err }, "daemon terminal.spawn failed");
      if (getTerminal(id)) {
        unregisterTerminal(id);
        emitTerminalsDirty();
        emitTerminalListChanged();
      }
    }
  }

  /** Re-register a terminal the daemon still owns after a kolu-server
   *  restart — NO spawn. Metadata is seeded from the saved session
   *  (persisted half); the live half + any drift replays over the
   *  `agentMetadata` snapshot once the bridge subscribes. */
  reattachPty(
    listed: AgentTerminalListEntry,
    saved: SavedTerminal | undefined,
  ): TerminalInfo {
    const id = listed.id;
    const proxy = new DaemonTerminalProxy(id);
    proxy.pid = listed.pid;
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
    log.child({ terminal: id }).info({ pid: listed.pid }, "reattached");
    // No `terminals:dirty` — reattach restores existing state, it does not
    // mutate it. The list cell republishes so the client renders the tile.
    emitTerminalListChanged();
    return entry.info;
  }

  /** A terminal's PTY exited naturally (the daemon emits `exit` only for
   *  natural exits — an intentional kill drives its own cleanup below). */
  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    cleanupTerminalScratch(id);
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  killTerminal(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    log.child({ terminal: id }).info({ pid: entry.info.pid }, "killing");
    // Drop the entry BEFORE the kill RPC so the daemon's (absent) exit signal
    // finds nothing — an intentional kill never publishes `terminalExit` (the
    // kill RPC response drives client cleanup), matching pre-R4c behavior.
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    void getDaemonHandle()
      .client.surface.terminal.kill({ id })
      .catch((err) => log.error({ terminal: id, err }, "daemon kill"));
    return entry.info;
  }

  killAllTerminals(): void {
    // Drain the registry BEFORE the kill RPC so delayed exit signals can't
    // find entries and trigger session saves.
    const entries = drainTerminals();
    log.info({ count: entries.length }, "killing all terminals");
    for (const entry of entries) cleanupTerminalScratch(entry.info.id);
    emitTerminalListChanged();
    void getDaemonHandle()
      .client.surface.terminal.killAll({})
      .catch((err) => log.error({ err }, "daemon killAll"));
  }

  async attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
  ): Promise<TerminalAttachment> {
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
    const exhausted = first.done === true;
    const deltas = (async function* () {
      if (pendingDelta !== undefined) yield pendingDelta;
      if (exhausted) return;
      for await (const msg of { [Symbol.asyncIterator]: () => iter }) {
        // A second `snapshot` would only arrive on a mid-stream agent-client
        // re-subscribe; yield its data so no output is dropped (the rare
        // double-paint is preferable to a gap, and the browser-facing attach
        // has its own buffer-clear-on-retry).
        yield msg.data;
      }
    })();
    return { snapshot, deltas };
  }
}

const backend = new LocalTerminalBackend();
export const localTerminalBackend: TerminalBackend = backend;

/** Subscribe to the daemon's metadata stream. Called once at boot, after
 *  `ensureDaemon()` and `reattachLocalTerminals()`. */
export function startLocalTerminalBridge(): void {
  backend.start();
}

/** Reattach to PTYs the daemon still owns after a kolu-server restart.
 *  Returns the count reattached. Matches the daemon's live list to the saved
 *  session by id; daemon-owned PTYs with no saved entry are reattached with
 *  defaults (the daemon's metadata replays over the stream snapshot). */
export async function reattachLocalTerminals(): Promise<number> {
  const client = getDaemonHandle().client;
  let listed: AgentTerminalListEntry[];
  try {
    const res = await client.surface.terminal.list({});
    listed = res.entries;
  } catch (err) {
    log.error({ err }, "daemon terminal.list failed; skipping reattach");
    return 0;
  }
  if (listed.length === 0) return 0;
  const saved = getSavedSession();
  const savedById = new Map<string, SavedTerminal>(
    (saved?.terminals ?? []).map((t) => [t.id, t]),
  );
  let count = 0;
  for (const entry of listed) {
    backend.reattachPty(entry, savedById.get(entry.id));
    count += 1;
  }
  log.info({ count }, "reattached terminals from daemon");
  return count;
}
