/**
 * `LocalTerminalBackend` — this kolu process. PTY spawned in-process
 * via `node-pty`, the per-terminal provider DAG (agent-command tracker,
 * git watcher, GitHub PR watcher, foreground-process observer, three
 * agent detectors) runs in the same process via `./providers.ts`, and
 * fs/git ops shell out locally.
 *
 * Provider lifecycle: each `spawnPty` constructs a `ProviderRecord`
 * (PtyHandle + aliased `entry.meta` + ephemeral `currentAgent`) and
 * wires `ProviderHooks` that funnel metadata writes through this
 * package's `updateServer*Metadata` helpers plus the activity-feed
 * trackers. The provider DAG itself doesn't know it's running inside
 * the local backend — it only knows about `ProviderHooks` /
 * `ProviderChannels`, so the same implementation drops onto any host
 * that doesn't share kolu-server's surface plumbing.
 *
 * The fs/git surfaces delegate to `kolu-git` directly. Equality
 * predicates (`gitDiffOutputEqual`, …) stay imported at the surface
 * layer (they're pure value comparisons, not backend operations).
 */

import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import type {
  PtySpawnOpts,
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
import { type PtyHandle, spawnPty } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import { koluShellDir } from "../koluRoot.ts";
import { log } from "../log.ts";
import { terminalChannels, terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx, unwrapGit } from "../surface.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import {
  createMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";
import {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderMeta,
  startProviders,
} from "./providers.ts";

// ── PTY-state notification helpers ─────────────────────────────────────

/** Notify that terminal state changed (drives debounced session
 *  auto-save). Distinct from the `terminalList` cell's content channel:
 *  this is the *trigger*, not the saved content. */
function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}

/** Republish the live `terminalList` cell. Backend lifecycle calls this
 *  on create / kill; client metadata setters (`setTerminalParent`, …)
 *  publish via the metadata collection instead, so no list republish
 *  is needed there. */
function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

// ── Local fs/git surfaces ──────────────────────────────────────────────

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

// ── Backend implementation ─────────────────────────────────────────────

/** All per-local-terminal state lives here. Structurally satisfies the
 *  `ProviderRecord` shape that `./providers.ts` consumes — `meta` is
 *  aliased to the same object as `TerminalProcess.meta` so provider
 *  writes (which go through the hooks → `updateServer*Metadata` →
 *  `entry.meta`) land on the read path that providers see through
 *  `record.meta`. `currentAgent` is the ephemeral stash maintained by
 *  the agent-command tracker (basename of the binary in the foreground
 *  right now, null when the shell is idle / running a non-agent
 *  command). `stopProviders` tears down every per-terminal subscription
 *  on kill. */
interface LocalTerminalRecord {
  ptyHandle: PtyHandle;
  meta: TerminalMetadata;
  currentAgent: string | null;
  stopProviders: () => void;
}

class LocalTerminalBackend implements TerminalBackend {
  readonly fs = localFs;
  readonly git = localGit;

  private readonly records = new Map<TerminalId, LocalTerminalRecord>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    const ptyHandle = spawnPty(
      tlog,
      id,
      {
        rcDir: koluShellDir,
        termProgramVersion: pkg.version,
        scrollback: DEFAULT_SCROLLBACK,
        onData: (data) => {
          terminalChannels.data(id).publish(data);
        },
        onExit: (exitCode) => {
          tlog.info({ exitCode }, "exited");
          const record = this.records.get(id);
          if (record) {
            record.stopProviders();
            cleanupTerminalScratch(id);
            this.records.delete(id);
          }
          surfaceCtx.events.terminalExit.publish({ id }, exitCode);
          // Only save session on natural exit (record was still present).
          // killAllTerminals clears its own records first, so we skip.
          const wasNaturalExit = unregisterTerminal(id);
          if (wasNaturalExit) {
            emitTerminalsDirty();
            emitTerminalListChanged();
          }
        },
        onTitleChange: (title) => {
          terminalChannels.title(id).publish(title);
        },
        onCommandRun: (raw) => {
          terminalChannels.commandRun(id).publish(raw);
        },
        onCwd: (newCwd) => {
          const entry = getTerminal(id);
          if (entry) {
            updateServerMetadata(entry, id, (m) => {
              m.cwd = newCwd;
            });
            terminalChannels.cwd(id).publish(newCwd);
          }
        },
      },
      opts.cwd,
    );

    const meta = createMetadata(ptyHandle.cwd);
    if (opts.parentId) meta.parentId = opts.parentId;
    // Seed client-owned initial metadata BEFORE startProviders so the
    // first `terminalMetadata` collection yield carries these fields
    // (see #642).
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.lastActivityAt !== undefined)
      meta.lastActivityAt = initial.lastActivityAt;
    if (initial?.intent) meta.intent = initial.intent;

    // `PtyHandle` structurally satisfies `TerminalHandle` (write,
    // resize, getScreenState, getScreenText, pid). The extra methods
    // `PtyHandle` carries (dispose, process, foregroundPid) are hidden
    // at the type boundary — `TerminalProcess.handle` is typed as
    // `TerminalHandle`, so external consumers (router.ts) can't reach
    // them. Direct assignment instead of a wrap closure avoids
    // allocating 4 closure-bound delegates per terminal.
    const entry: TerminalProcess = {
      info: { id, pid: ptyHandle.pid },
      meta,
      handle: ptyHandle,
    };

    registerTerminal(id, entry);
    // Build the record BEFORE starting providers — the agent-command
    // tracker writes `record.currentAgent` and the agent detectors read
    // it. `stopProviders` is patched in after the call.
    const record: LocalTerminalRecord = {
      ptyHandle,
      meta,
      currentAgent: null,
      stopProviders: () => {},
    };
    this.records.set(id, record);
    record.stopProviders = startProviders(
      record,
      id,
      buildChannels(id),
      buildHooks(entry, id),
    );

    tlog.info({ pid: ptyHandle.pid, total: listTerminals().length }, "created");
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  killTerminal(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    const record = this.records.get(id);

    log.child({ terminal: id }).info({ pid: entry.info.pid }, "killing");
    if (record) {
      record.stopProviders();
      record.ptyHandle.dispose();
      this.records.delete(id);
    }
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  killAllTerminals(): void {
    // Snapshot registry + own records, clear both BEFORE disposing — so
    // `onExit` callbacks can't find terminals and trigger session saves.
    const entries = drainTerminals();
    const records = [...this.records.values()];
    this.records.clear();
    log.info({ count: entries.length }, "killing all terminals");
    for (const record of records) {
      record.stopProviders();
      record.ptyHandle.dispose();
    }
    for (const entry of entries) {
      cleanupTerminalScratch(entry.info.id);
    }
    emitTerminalListChanged();
  }

  subscribeTerminalChannel<K extends keyof TerminalChannelMap>(
    id: TerminalId,
    kind: K,
    signal: AbortSignal | undefined,
  ): AsyncIterable<TerminalChannelMap[K]> {
    // The narrowing on `K` makes the `as` necessary — TS can't see that
    // the runtime `kind` indexes a typed channel of the right element
    // type. Each branch of the channel map already matches by
    // construction (`terminalChannels.data` returns `Channel<string>`,
    // etc.), so the cast is a documentation rather than a runtime risk.
    return terminalChannels[kind](id).subscribe(signal) as AsyncIterable<
      TerminalChannelMap[K]
    >;
  }
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

/** Build the `ProviderHooks` for one terminal. The two update verbs
 *  bridge `ProviderMeta` (the providers' narrow view) onto the
 *  registry's `TerminalProcess.meta` via `updateServer*Metadata` —
 *  same object identity, so the providers' own read path on
 *  `record.meta` sees the write immediately. The cast is sound
 *  because `TerminalMetadata` is structurally a superset of
 *  `ProviderMeta`. `trackRecent*` are passed straight through:
 *  the local backend owns the activity feed. */
function buildHooks(entry: TerminalProcess, id: TerminalId): ProviderHooks {
  return {
    updateServerMetadata: (_record, mutate) =>
      updateServerMetadata(entry, id, (m) =>
        mutate(m as unknown as ProviderMeta),
      ),
    updateServerLiveMetadata: (_record, mutate) =>
      updateServerLiveMetadata(entry, id, (m) =>
        mutate(m as unknown as ProviderMeta),
      ),
    trackRecentRepo,
    trackRecentAgent,
  };
}

export const localTerminalBackend: TerminalBackend = new LocalTerminalBackend();
