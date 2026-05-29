/**
 * `LocalTerminalBackend` — this kolu process. The PTY is owned by an
 * in-process `@kolu/pty-host` `PtyHost`; this backend is the adapter that
 * bridges the host's PTY-derived events into kolu-server's surface
 * plumbing and runs the per-terminal provider DAG (agent-command tracker,
 * git watcher, GitHub PR watcher, foreground-process observer, three agent
 * detectors) in the same process via `./providers.ts`. fs/git ops shell
 * out locally.
 *
 * The PTY boundary: `@kolu/pty-host` owns node-pty + the headless screen
 * mirror + the VT-derived taps (cwd/title/command-run/exit/foregroundPid)
 * and fans each out to many consumers. This backend prepares the spawn env
 * (via `kolu-pty`), then *bridges* the host's per-PTY event streams onto
 * the `terminalChannels` bus the provider DAG already consumes — so the
 * providers stay untouched. `attach` delegates straight to the host's
 * race-free snapshot+delta primitive.
 *
 * Provider lifecycle: each spawn constructs a `ProviderRecord` (a
 * host-backed `PtyHandle` + aliased `entry.meta` + ephemeral
 * `currentAgent`) and wires `ProviderHooks` that funnel metadata writes
 * through this package's `updateServer*Metadata` helpers plus the
 * activity-feed trackers. The provider DAG doesn't know it's running
 * inside the local backend — it only knows about `ProviderHooks` /
 * `ProviderChannels`.
 *
 * The fs/git surfaces delegate to `kolu-git` directly. Equality
 * predicates (`gitDiffOutputEqual`, …) stay imported at the surface
 * layer (they're pure value comparisons, not backend operations).
 */

import { createPtyHost, type PtyHandle, type PtyHost } from "@kolu/pty-host";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type {
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
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import { koluShellDir } from "../koluRoot.ts";
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

// ── PTY host (in-process) ──────────────────────────────────────────────

/** The single in-process PTY owner for this kolu process. */
const host: PtyHost = createPtyHost({ log });

/** Pump a host event stream into a sink until the stream ends (PTY exit
 *  or the per-terminal bridge signal aborts). Unexpected failures are
 *  logged; clean end-of-stream is silent. */
function bridgeStream<T>(
  iter: AsyncIterable<T>,
  onEvent: (value: T) => void,
): void {
  void (async () => {
    try {
      for await (const value of iter) onEvent(value);
    } catch (err) {
      log.error({ err }, "pty-host bridge subscription failed");
    }
  })();
}

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
 *  on kill; `bridge` aborts the host→`terminalChannels` pumps. */
interface LocalTerminalRecord {
  ptyHandle: PtyHandle;
  meta: TerminalMetadata;
  currentAgent: string | null;
  stopProviders: () => void;
  bridge: AbortController;
}

class LocalTerminalBackend implements TerminalBackend {
  readonly fs = localFs;
  readonly git = localGit;

  private readonly records = new Map<TerminalId, LocalTerminalRecord>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    // Env layering, ordered least → most authoritative:
    //   1. cleanEnv()        — parent env passthrough (Nix devshell filter).
    //   2. koluIdentityEnv() — Kolu's identity vars (stomps parent).
    //   3. shellInit.env     — per-PTY overrides (e.g. ZDOTDIR for zsh).
    const env = cleanEnv();
    const shell = env.SHELL ?? "/bin/sh";
    const cwd = opts.cwd || env.HOME || "/";
    Object.assign(env, koluIdentityEnv(pkg.version));
    const shellInit = prepareShellInit({
      shell,
      home: env.HOME,
      terminalId: id,
      rcDir: koluShellDir,
    });
    Object.assign(env, shellInit.env);

    const { pid } = host.spawn({
      id,
      shell,
      args: shellInit.args,
      env,
      cwd,
      scrollback: DEFAULT_SCROLLBACK,
      onDispose: shellInit.cleanup,
    });
    const ptyHandle = host.handle(id);

    // Bridge the host's PTY-derived event streams onto the provider bus
    // and the persisted metadata. The bridge is torn down via `bridge`
    // on kill, and ends naturally on PTY exit when the host closes its
    // channels. Subscribing here (eagerly) before `startProviders` keeps
    // the provider-facing `terminalChannels` the single source the DAG
    // reads — the providers don't know the host exists.
    const bridge = new AbortController();
    bridgeStream(host.subscribeCwd(id, bridge.signal), (newCwd) => {
      const entry = getTerminal(id);
      if (entry) {
        updateServerMetadata(entry, id, (m) => {
          m.cwd = newCwd;
        });
        terminalChannels.cwd(id).publish(newCwd);
      }
    });
    bridgeStream(host.subscribeTitle(id, bridge.signal), (title) => {
      terminalChannels.title(id).publish(title);
    });
    bridgeStream(host.subscribeCommandRun(id, bridge.signal), (raw) => {
      terminalChannels.commandRun(id).publish(raw);
    });
    void host.exitPromise(id).then((exitCode) => {
      this.handleExit(id, exitCode, tlog);
    });

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

    // The host-vended `PtyHandle` structurally satisfies `TerminalHandle`
    // (write, resize, getScreenState, getScreenText, pid). The extra
    // members it carries (cwd, process, foregroundPid) are hidden at the
    // type boundary — `TerminalProcess.handle` is typed as
    // `TerminalHandle`, so external consumers (router.ts) can't reach
    // them; the provider DAG reads them through `record.ptyHandle`.
    const entry: TerminalProcess = {
      info: { id, pid },
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
      bridge,
    };
    this.records.set(id, record);
    record.stopProviders = startProviders(
      record,
      id,
      buildChannels(id),
      buildHooks(entry, id),
    );

    tlog.info({ pid, total: listTerminals().length }, "created");
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  /** PTY exited (naturally or as the delayed result of a `kill`). Mirrors
   *  the old `spawnPty` `onExit`: tear the record down if it's still
   *  present (natural exit), always publish the exit event, and save the
   *  session only on a natural exit (kill paths clear the record first). */
  private handleExit(id: TerminalId, exitCode: number, tlog: typeof log): void {
    tlog.info({ exitCode }, "exited");
    const record = this.records.get(id);
    if (record) {
      record.bridge.abort();
      record.stopProviders();
      cleanupTerminalScratch(id);
      this.records.delete(id);
    }
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    // Only save session on natural exit (record was still present).
    // The kill paths clear their own records first, so we skip.
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
      record.bridge.abort();
      record.stopProviders();
      host.kill(id);
      this.records.delete(id);
    }
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  killAllTerminals(): void {
    // Snapshot registry + own records, clear both BEFORE killing — so the
    // delayed `handleExit` callbacks can't find terminals and trigger
    // session saves.
    const entries = drainTerminals();
    const records = [...this.records.values()];
    this.records.clear();
    log.info({ count: entries.length }, "killing all terminals");
    for (const record of records) {
      record.bridge.abort();
      record.stopProviders();
    }
    for (const entry of entries) {
      host.kill(entry.info.id);
      cleanupTerminalScratch(entry.info.id);
    }
    emitTerminalListChanged();
  }

  attach(id: TerminalId, signal: AbortSignal | undefined): TerminalAttachment {
    return host.attach(id, signal);
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

/** Build the `ProviderHooks` for one terminal. Each verb forwards the
 *  fence-narrowed mutator straight through to `updateServer*Metadata`,
 *  which expects the matching `ServerPersistedTerminalFields` /
 *  `LiveTerminalFields` shape — same partition, same types, no cast.
 *  `trackRecent*` pass through: the local backend owns the activity
 *  feed. */
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
