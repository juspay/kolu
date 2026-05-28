/**
 * `LocalTerminalBackend` — this kolu process. PTY spawned in-process
 * via `node-pty`, providers watch local files via `@parcel/watcher`,
 * fs/git ops shell out locally.
 *
 * Absorbs every per-terminal orchestrator the kolu-server used to
 * split across `meta/*.ts` (agent-command tracker, agent detectors for
 * claude-code / codex / opencode, git resolver, github PR watcher,
 * foreground process observer). They live here as private functions
 * because their lifecycle is owned by `spawnPty` — there's no useful
 * other call site, and splitting them across files only forced two
 * `cwd:<id>` / `commandRun:<id>` / `title:<id>` subscribers to
 * coordinate via the publisher when they could just call each other.
 *
 * Provider DAG (subscribed inside `spawnPty`):
 *
 *   cwd:<id>           ╶─►  git watcher  ╶─►  github PR watcher
 *                                              (lives on `m.pr`, live-only)
 *   title:<id>         ╶─►  process observer    (lives on `m.foreground`)
 *   title/cwd/commandRun  ╶─►  agent detector ×3 (lives on `m.agent`)
 *   commandRun:<id>    ╶─►  agent-command tracker (lives on `m.lastAgentCommand`)
 *
 * Three providers (`agent`, `pr`, `foreground`) are LIVE fields —
 * mutating them through `updateServerLiveMetadata` does NOT fire
 * `terminals:dirty`, preventing the 150ms agent-stream firehose from
 * over-saving the session.
 *
 * The fs/git surfaces delegate to `kolu-git` directly. Equality
 * predicates (`gitDiffOutputEqual`, …) stay imported at the surface
 * layer (they're pure value comparisons, not backend operations).
 */

import path from "node:path";
import type {
  AgentInfoShape,
  AgentProvider,
  AgentTerminalState,
  AgentWatcher,
} from "anyagent";
import { parseAgentCommand } from "anyagent";
import { claudeCodeProvider } from "kolu-claude-code";
import { codexProvider } from "kolu-codex";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { AgentInfo, TerminalId, TerminalInfo } from "kolu-common/surface";
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
  subscribeGitInfo,
  subscribeRepoChange,
} from "kolu-git";
import type { GitDiffMode } from "kolu-git/schemas";
import { subscribeGitHubPr } from "kolu-github";
import { opencodeProvider } from "kolu-opencode";
import { type PtyHandle, spawnPty } from "kolu-pty";
import type { Logger } from "kolu-shared";
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
import { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";
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
 *  on create / kill; client metadata setters (`setTerminalParent`, …)
 *  publish via the metadata collection instead, so no list republish
 *  is needed there. */
function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

// ── Agent-command tracker (was `meta/agent-command.ts`) ────────────────

/** Subscribe to the terminal's `commandRun` channel, parse each
 *  payload as an agent command, and update the two state slots:
 *
 *   - `record.currentAgent` — basename of the binary in the
 *     foreground right now; cleared when the user types a non-agent
 *     command. Ephemeral, lives on the per-local-terminal record so
 *     it shares one container with the rest of `LocalTerminalBackend`'s
 *     internal state (PtyHandle, cleanup) — disposing the record drops
 *     the value automatically. Read by the agent detectors below.
 *   - `m.lastAgentCommand` — full normalized invocation of the most
 *     recent *agent* command in this terminal, preserved across
 *     intervening non-agent input. Lives on `TerminalMetadata` so the
 *     session snapshotter picks it up automatically. */
function startAgentCommandTracker(
  record: LocalTerminalRecord,
  terminalId: TerminalId,
): () => void {
  return terminalChannels.commandRun(terminalId).consume({
    onEvent: (raw) => {
      const normalized = parseAgentCommand(raw);
      record.currentAgent = normalized?.split(" ")[0] ?? null;
      if (normalized) {
        const entry = getTerminal(terminalId);
        if (entry && entry.meta.lastAgentCommand !== normalized) {
          updateServerMetadata(entry, terminalId, (m) => {
            m.lastAgentCommand = normalized;
          });
        }
        trackRecentAgent(normalized);
      }
    },
    onError: (err) =>
      log.error(
        { err, terminal: terminalId, channel: "commandRun" },
        "publisher subscription failed",
      ),
  });
}

// ── Git provider (was `meta/git.ts`) ───────────────────────────────────

function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd: entry.meta.cwd }, "started");

  const watcher = subscribeGitInfo(
    entry.meta.cwd,
    (git) => {
      if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
      updateServerMetadata(entry, terminalId, (m) => {
        m.git = git;
      });
      terminalChannels.git(terminalId).publish(git);
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
  );

  const cleanup = terminalChannels.cwd(terminalId).consume({
    onEvent: (cwd) => watcher.setCwd(cwd),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

// ── GitHub PR provider (was `meta/github.ts`) ──────────────────────────

function startGitHubPrProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "github-pr", terminal: terminalId });
  plog.debug("started");

  const watcher = subscribeGitHubPr((pr) => {
    updateServerLiveMetadata(entry, terminalId, (m) => {
      m.pr = pr;
    });
    plog.debug(
      pr.kind === "ok"
        ? {
            pr: pr.value.number,
            title: pr.value.title,
            state: pr.value.state,
            checks: pr.value.checks,
          }
        : { pr: pr.kind },
      "pr info updated",
    );
  }, plog);

  const cleanup = terminalChannels.git(terminalId).consume({
    onEvent: (git) =>
      watcher.setGit(git?.repoRoot ?? null, git?.branch ?? null),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    watcher.stop();
  };
}

// ── Foreground process observer (was `meta/process.ts`) ────────────────

/** node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on
 *  NixOS). Always normalize to basename. */
function processBasename(proc: string): string {
  return path.basename(proc);
}

function startProcessProvider(
  entry: TerminalProcess,
  ptyHandle: PtyHandle,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastName: string | null = null;
  let lastTitle: string | null = null;

  plog.debug("started");

  function update(title?: string) {
    const name = processBasename(ptyHandle.process);
    const newTitle = title ?? lastTitle;
    if (name === lastName && newTitle === lastTitle) return;

    plog.debug(
      { from: lastName, to: name, title: newTitle },
      "foreground process changed",
    );
    lastName = name;
    lastTitle = newTitle;
    updateServerLiveMetadata(entry, terminalId, (m) => {
      m.foreground = { name, title: newTitle };
    });
  }

  update();

  const cleanup = terminalChannels.title(terminalId).consume({
    onEvent: (title) => update(title),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    plog.debug("stopped");
  };
}

// ── Agent detector (was `meta/agent.ts`) ───────────────────────────────

/** Reading `ptyHandle.process` involves a kernel syscall on darwin
 *  (sysctl) and can throw if node-pty has already terminated the
 *  process; log and return null so the provider treats the terminal as
 *  having no foreground binary. */
function readForegroundBasenameOnce(
  ptyHandle: PtyHandle,
  plog: Logger,
): string | null {
  try {
    const proc = ptyHandle.process;
    return proc ? path.basename(proc) : null;
  } catch (err) {
    plog.debug({ err }, "failed to read entry.handle.process");
    return null;
  }
}

/** Snapshot of every input an `AgentProvider`'s `resolveSession` needs.
 *
 *  `readForegroundBasename` is a lazy, memoized accessor so providers
 *  that match by PID alone (e.g. claude-code) skip the darwin sysctl
 *  entirely on every reconcile. The cache is scoped to this one
 *  snapshot — a fresh snapshot on the next reconcile re-reads.
 *
 *  `lastAgentCommandName` is sourced from the per-terminal
 *  agent-command stash, gated on `foregroundPid !== handle.pid` — when
 *  the shell is idle at the prompt, tcgetpgrp returns the shell's own
 *  pid and the previous stash no longer describes a live process. */
function snapshotTerminalState(
  ptyHandle: PtyHandle,
  cwd: string,
  currentAgent: string | null,
  plog: Logger,
): AgentTerminalState {
  let basename: string | null | undefined;
  const foregroundPid = ptyHandle.foregroundPid;
  const shellIdle =
    foregroundPid === undefined || foregroundPid === ptyHandle.pid;
  return {
    foregroundPid,
    cwd,
    readForegroundBasename: () => {
      if (basename === undefined)
        basename = readForegroundBasenameOnce(ptyHandle, plog);
      return basename;
    },
    lastAgentCommandName: shellIdle ? null : currentAgent,
  };
}

/** Per-provider activation state for the lazy external-change
 *  subscription. Shared across every terminal that uses a given
 *  provider kind. Installed at most once per process, the first time
 *  any terminal's state reports `externalChanges.isPresent` — so a
 *  user who has never run the agent pays zero watcher cost (issue #698).
 *
 *  `reconcilers` is the fan-out set: every terminal whose own state
 *  has ever reported "agent present" is in here, and a single external
 *  signal dispatches to all of them. Entries are removed on terminal
 *  teardown; the installed watcher itself stays up for the remainder
 *  of the process (the underlying singleton matches that lifetime
 *  anyway — there is no useful uninstall). */
interface ExternalChangesActivation {
  reconcilers: Set<() => void>;
  installed: boolean;
}
const activations = new Map<string, ExternalChangesActivation>();

function getActivation(kind: string): ExternalChangesActivation {
  let entry = activations.get(kind);
  if (!entry) {
    entry = { reconcilers: new Set(), installed: false };
    activations.set(kind, entry);
  }
  return entry;
}

/** Preexec (`commandRun`) arrives while the shell still owns the
 *  foreground process group, so a synchronous reconcile reads
 *  `state.foregroundPid = shell.pid` and `snapshotTerminalState` forces
 *  `lastAgentCommandName = null` (the `shellIdle` gate). The matched
 *  agent binary takes over a few ticks later. Retry the reconcile at
 *  increasing delays so the per-terminal preexec stash is sampled both
 *  immediately and after POSIX foreground ownership has settled. */
const COMMAND_RUN_RECONCILE_DELAYS_MS = [0, 75, 300, 1000] as const;

/** Single write-site for `m.agent`. The provider's watcher emits at
 *  ~150ms cadence while an agent is streaming; only a small fraction
 *  of those emits cross the recency-bump threshold (transitions on
 *  `kind`/`sessionId`/`state`). Every tick writes `m.agent` via the
 *  live variant (no dirty signal). On a bump, a second call writes
 *  `m.lastActivityAt` via the persisting variant. The two-call shape
 *  is forced by the type fence; the second publish is cheap and only
 *  happens on transitions. */
function setAgentMetadata(
  entry: TerminalProcess,
  terminalId: string,
  nextAgent: AgentInfo | null,
): void {
  const bump = shouldBumpRecencyForAgentChange(
    entry.meta.agent,
    nextAgent,
    entry.meta.lastActivityAt,
  );
  updateServerLiveMetadata(entry, terminalId, (m) => {
    m.agent = nextAgent;
  });
  if (bump) {
    updateServerMetadata(entry, terminalId, (m) => {
      m.lastActivityAt = Date.now();
    });
  }
}

function startAgentProvider<Session, Info extends AgentInfoShape>(
  provider: AgentProvider<Session, Info>,
  entry: TerminalProcess,
  record: LocalTerminalRecord,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: provider.kind, terminal: terminalId });

  let current: { watcher: AgentWatcher; key: string } | null = null;
  let registeredForExternal = false;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];

  plog.debug("started");

  function reconcile() {
    const state = snapshotTerminalState(
      record.ptyHandle,
      entry.meta.cwd,
      record.currentAgent,
      plog,
    );

    if (!registeredForExternal && provider.externalChanges?.isPresent(state)) {
      const activation = getActivation(provider.kind);
      activation.reconcilers.add(reconcile);
      registeredForExternal = true;
      if (!activation.installed) {
        activation.installed = true;
        const slog = log.child({ provider: provider.kind });
        provider.externalChanges.install(
          () => {
            for (const fn of [...activation.reconcilers]) {
              try {
                fn();
              } catch (err) {
                slog.error({ err }, "reconcile threw on external change");
              }
            }
          },
          (err) => slog.error({ err }, "external-change listener threw"),
          slog,
        );
      }
    }

    const next = provider.resolveSession(state, plog);
    const nextKey = next ? provider.sessionKey(next) : null;
    if ((current?.key ?? null) === nextKey) return;

    const hadCurrent = current !== null;
    current?.watcher.destroy();
    current = null;

    if (!next || !nextKey) {
      if (hadCurrent) plog.debug("agent session ended");
      if (entry.meta.agent?.kind === provider.kind) {
        setAgentMetadata(entry, terminalId, null);
      }
      return;
    }

    plog.debug({ session: nextKey }, "agent session matched");
    current = {
      key: nextKey,
      watcher: provider.createWatcher(
        next,
        (info) => {
          setAgentMetadata(entry, terminalId, info as unknown as AgentInfo);
        },
        plog,
      ),
    };
  }

  function clearCommandRunTimers() {
    for (const timer of commandRunTimers) clearTimeout(timer);
    commandRunTimers = [];
  }

  function reconcileFromCommandRun(idx: number) {
    if (stopped) return;
    try {
      reconcile();
    } catch (err) {
      plog.error({ err }, "command-run reconcile failed");
    }
    if (current !== null) return;
    const nextIdx = idx + 1;
    const next = COMMAND_RUN_RECONCILE_DELAYS_MS[nextIdx];
    if (next === undefined) return;
    const cur = COMMAND_RUN_RECONCILE_DELAYS_MS[idx]!;
    commandRunTimers.push(
      setTimeout(() => reconcileFromCommandRun(nextIdx), next - cur),
    );
  }

  function scheduleCommandRunReconciles() {
    clearCommandRunTimers();
    reconcileFromCommandRun(0);
  }

  const cleanupTitle = terminalChannels.title(terminalId).consume({
    onEvent: () => reconcile(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  const cleanupCwd = terminalChannels.cwd(terminalId).consume({
    onEvent: () => reconcile(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  const cleanupCommandRun = terminalChannels.commandRun(terminalId).consume({
    onEvent: () => scheduleCommandRunReconciles(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  reconcile();

  return () => {
    stopped = true;
    clearCommandRunTimers();
    cleanupTitle();
    cleanupCwd();
    cleanupCommandRun();
    if (registeredForExternal) {
      activations.get(provider.kind)?.reconcilers.delete(reconcile);
    }
    current?.watcher.destroy();
    plog.debug("stopped");
  };
}

// ── Provider composition ───────────────────────────────────────────────

/** Start every per-terminal provider for one terminal. Provider order
 *  matters only for `startAgentCommandTracker` — it has to be first so
 *  the stash it maintains is populated before the agent detectors
 *  reconcile. */
function startProviders(
  entry: TerminalProcess,
  record: LocalTerminalRecord,
  terminalId: string,
): () => void {
  const stopAgentCommand = startAgentCommandTracker(record, terminalId);
  const stopGit = startGitProvider(entry, terminalId);
  const stopGitHubPr = startGitHubPrProvider(entry, terminalId);
  const stopClaude = startAgentProvider(
    claudeCodeProvider,
    entry,
    record,
    terminalId,
  );
  const stopCodex = startAgentProvider(
    codexProvider,
    entry,
    record,
    terminalId,
  );
  const stopOpenCode = startAgentProvider(
    opencodeProvider,
    entry,
    record,
    terminalId,
  );
  const stopProcess = startProcessProvider(entry, record.ptyHandle, terminalId);
  return () => {
    stopAgentCommand();
    stopGit();
    stopGitHubPr();
    stopClaude();
    stopCodex();
    stopOpenCode();
    stopProcess();
  };
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

/** All per-local-terminal state lives here. The PtyHandle is the
 *  concrete node-pty handle (its dispose/process/foregroundPid methods
 *  are why it can't be the abstract `TerminalHandle`); `currentAgent`
 *  is the ephemeral stash maintained by the agent-command tracker
 *  (basename of the binary in the foreground right now, or null when
 *  the shell is idle / running a non-agent command); `stopProviders`
 *  tears down every per-terminal subscription on kill. The record is
 *  disposed atomically — dropping the entry from `records` drops all
 *  three together. */
interface LocalTerminalRecord {
  ptyHandle: PtyHandle;
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
      currentAgent: null,
      stopProviders: () => {},
    };
    this.records.set(id, record);
    record.stopProviders = startProviders(entry, record, id);

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

export const localTerminalBackend: TerminalBackend = new LocalTerminalBackend();
