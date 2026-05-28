/** Per-terminal provider DAG, parameterized over `ProviderHooks` +
 *  `ProviderChannels` + `ProviderRecord` so the host backend is the
 *  only thing that varies. `LocalTerminalBackend` is the current
 *  consumer; a remote agent backend that runs the same DAG against
 *  in-process channels will be added in a follow-up phase (#951 R-2).
 *
 *  Provider DAG:
 *
 *    cwd:<id>          ─►  git watcher           ─►  github PR watcher
 *                                                    (lives on m.pr)
 *    title:<id>        ─►  process observer      (lives on m.foreground)
 *    title/cwd/cmd     ─►  agent detector ×3     (lives on m.agent)
 *    commandRun:<id>   ─►  agent-command tracker (lives on m.lastAgentCommand)
 *
 *  Metadata writes funnel through `hooks.update*Metadata` so the
 *  providers don't need to know how their host persists state;
 *  activity-feed notifications (`trackRecentRepo` / `trackRecentAgent`)
 *  are optional so non-parent hosts can opt out.
 *
 *  Note on `git` channel: the GitHub PR provider chains off the
 *  `git` channel that the git provider publishes — so the channel
 *  has to be provided by the host (`terminalChannels.git(id)` on
 *  the local backend, an in-memory channel on hosts that don't have
 *  a publisher).
 *
 *  ## Host contract
 *
 *  `record.meta.cwd` is read once at provider start (the spawn-time
 *  cwd) and is not re-read afterwards; subsequent cwd changes flow
 *  ONLY through `channels.cwd`. Hosts must publish every cwd change to
 *  that channel — they are NOT required to keep `record.meta.cwd` in
 *  sync, though the local backend happens to (it writes through
 *  `updateServerMetadata` so the persisted+published metadata stays
 *  current for clients). Any host that satisfies the
 *  `ProviderChannels`/`ProviderHooks` shape and publishes cwd to the
 *  channel will get correct agent / git resolution.
 */

import path from "node:path";
import type {
  AgentInfoShape,
  AgentProvider,
  AgentTerminalState,
  AgentWatcher,
} from "@kolu/anyagent";
import { parseAgentCommand } from "@kolu/anyagent";
import { claudeCodeProvider } from "kolu-claude-code";
import { codexProvider } from "kolu-codex";
import { subscribeGitInfo } from "kolu-git";
import type { GitInfo } from "kolu-git/schemas";
import { subscribeGitHubPr } from "kolu-github";
import type {
  AgentInfo,
  LiveTerminalFields,
  ServerPersistedTerminalFields,
  TerminalId,
  TerminalServerMetadata,
} from "kolu-common/surface";
import { opencodeProvider } from "kolu-opencode";
import type { PtyHandle } from "kolu-pty";
import type { Logger } from "kolu-shared";
import type { Channel } from "@kolu/surface/server";
import { log } from "../log.ts";
import { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";

/** Minimal "terminal record" shape the provider DAG needs. Both
 *  backends construct one with their own internals (LocalTerminalRecord,
 *  AgentTerminal); the providers only touch `ptyHandle` + `meta` +
 *  `currentAgent` from here. `meta` is `TerminalServerMetadata` — the
 *  canonical `ServerPersistedTerminalFields ∪ LiveTerminalFields` union
 *  from `kolu-common/surface` (the same write-fence partition
 *  `metadata.ts` enforces). Hosts whose own metadata is structurally a
 *  superset (parent's `TerminalMetadata`, a future agent's
 *  `AgentTerminalMetadata`) satisfy it directly. */
export interface ProviderRecord {
  ptyHandle: PtyHandle;
  meta: TerminalServerMetadata;
  /** Ephemeral basename of the agent binary at the foreground right
   *  now; written by the agent-command tracker, read by the agent
   *  detectors. Null when the shell is idle. */
  currentAgent: string | null;
}

/** Per-terminal channels the providers subscribe to. Both backends
 *  expose the same shape; the channel objects differ. */
export interface ProviderChannels {
  cwd: Channel<string>;
  title: Channel<string>;
  commandRun: Channel<string>;
  git: Channel<GitInfo | null>;
}

/** Host hooks — the providers call these to update metadata + emit
 *  side effects. The mutator parameter types are narrowed to the two
 *  halves of the persisted-vs-live partition (the same fence
 *  `metadata.ts` enforces): writing `m.agent` through
 *  `updateServerMetadata` is a compile error, so the
 *  `terminals:dirty` autosave firehose can't be reintroduced by a new
 *  provider. The parent backend wires through
 *  `updateServerMetadata`/`updateServerLiveMetadata` directly; a
 *  future agent host wires through its own publish surface with the
 *  same fence applied.
 *
 *  `record` is passed to every hook so a future host whose update
 *  function isn't already keyed by terminal id (e.g. an agent host
 *  with a global publish surface) can look the record up in its own
 *  registry to dispatch the write. The local backend already has
 *  `entry` + `id` captured in `buildHooks`'s per-terminal closure,
 *  so it ignores the argument — hence the `_record` prefix. */
export interface ProviderHooks {
  updateServerMetadata: (
    record: ProviderRecord,
    mutate: (meta: ServerPersistedTerminalFields) => void,
  ) => void;
  updateServerLiveMetadata: (
    record: ProviderRecord,
    mutate: (meta: LiveTerminalFields) => void,
  ) => void;
  /** Optional — parent-side activity-feed tracking. Hosts without a
   *  user-facing activity feed (a future agent host) leave these
   *  undefined. */
  trackRecentRepo?: (root: string, name: string) => void;
  trackRecentAgent?: (cmd: string) => void;
}

// ── Foreground process observer ──────────────────────────────────────

function processBasename(proc: string): string {
  return path.basename(proc);
}

function startProcessProvider(
  record: ProviderRecord,
  terminalId: TerminalId,
  channels: ProviderChannels,
  hooks: ProviderHooks,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastName: string | null = null;
  let lastTitle: string | null = null;
  plog.debug("started");

  function update(title?: string) {
    const name = processBasename(record.ptyHandle.process);
    const newTitle = title ?? lastTitle;
    if (name === lastName && newTitle === lastTitle) return;
    plog.debug(
      { from: lastName, to: name, title: newTitle },
      "foreground process changed",
    );
    lastName = name;
    lastTitle = newTitle;
    hooks.updateServerLiveMetadata(record, (m) => {
      m.foreground = { name, title: newTitle };
    });
  }
  update();
  const cleanup = channels.title.consume({
    onEvent: (title) => update(title),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  return () => {
    cleanup();
    plog.debug("stopped");
  };
}

// ── Git watcher ───────────────────────────────────────────────────────

function startGitProvider(
  record: ProviderRecord,
  terminalId: TerminalId,
  channels: ProviderChannels,
  hooks: ProviderHooks,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd: record.meta.cwd }, "started");
  const watcher = subscribeGitInfo(
    record.meta.cwd,
    (git) => {
      if (git) hooks.trackRecentRepo?.(git.mainRepoRoot, git.repoName);
      hooks.updateServerMetadata(record, (m) => {
        m.git = git;
      });
      channels.git.publish(git);
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
  );
  const cleanup = channels.cwd.consume({
    onEvent: (cwd) => watcher.setCwd(cwd),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

// ── GitHub PR watcher ─────────────────────────────────────────────────

function startGitHubPrProvider(
  record: ProviderRecord,
  terminalId: TerminalId,
  channels: ProviderChannels,
  hooks: ProviderHooks,
): () => void {
  const plog = log.child({ provider: "github-pr", terminal: terminalId });
  plog.debug("started");
  const watcher = subscribeGitHubPr((pr) => {
    hooks.updateServerLiveMetadata(record, (m) => {
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
  const cleanup = channels.git.consume({
    onEvent: (git) =>
      watcher.setGit(git?.repoRoot ?? null, git?.branch ?? null),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

// ── Agent-command tracker ─────────────────────────────────────────────

function startAgentCommandTracker(
  record: ProviderRecord,
  terminalId: TerminalId,
  channels: ProviderChannels,
  hooks: ProviderHooks,
): () => void {
  return channels.commandRun.consume({
    onEvent: (raw) => {
      const normalized = parseAgentCommand(raw);
      record.currentAgent = normalized?.split(" ")[0] ?? null;
      if (normalized) {
        if (record.meta.lastAgentCommand !== normalized) {
          hooks.updateServerMetadata(record, (m) => {
            m.lastAgentCommand = normalized;
          });
        }
        hooks.trackRecentAgent?.(normalized);
      }
    },
    onError: (err) =>
      log.error(
        { err, terminal: terminalId, channel: "commandRun" },
        "publisher subscription failed",
      ),
  });
}

// ── Agent detectors ───────────────────────────────────────────────────

function readForegroundBasenameOnce(
  ptyHandle: PtyHandle,
  plog: Logger,
): string | null {
  try {
    const proc = ptyHandle.process;
    return proc ? path.basename(proc) : null;
  } catch (err) {
    plog.debug({ err }, "failed to read ptyHandle.process");
    return null;
  }
}

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

const COMMAND_RUN_RECONCILE_DELAYS_MS = [0, 75, 300, 1000] as const;

function setAgentMetadataVia(
  record: ProviderRecord,
  hooks: ProviderHooks,
  nextAgent: AgentInfo | null,
): void {
  const bump = shouldBumpRecencyForAgentChange(
    record.meta.agent,
    nextAgent,
    record.meta.lastActivityAt,
  );
  hooks.updateServerLiveMetadata(record, (m) => {
    m.agent = nextAgent;
  });
  if (bump) {
    hooks.updateServerMetadata(record, (m) => {
      m.lastActivityAt = Date.now();
    });
  }
}

function startAgentProvider<Session, Info extends AgentInfoShape>(
  provider: AgentProvider<Session, Info>,
  record: ProviderRecord,
  terminalId: TerminalId,
  channels: ProviderChannels,
  hooks: ProviderHooks,
): () => void {
  const plog = log.child({ provider: provider.kind, terminal: terminalId });
  let current: { watcher: AgentWatcher; key: string } | null = null;
  let registeredForExternal = false;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];
  // CWD source-of-truth for this provider's lifetime: seeded once from
  // `record.meta.cwd` (the spawn-time cwd a host writes before calling
  // `startProviders`) and updated only via the `cwd` channel. Reading
  // `record.meta.cwd` inside `reconcile()` would make agent detection
  // depend on the host mutating `record.meta` synchronously before each
  // channel publish — a hidden contract the parent backend happened to
  // honor (`local.ts` writes `entry.meta.cwd` then publishes) but a
  // future host on the same `ProviderChannels`/`ProviderHooks` shape
  // could not be expected to know about.
  let currentCwd = record.meta.cwd;
  plog.debug("started");

  function reconcile() {
    const state = snapshotTerminalState(
      record.ptyHandle,
      currentCwd,
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
      if (record.meta.agent?.kind === provider.kind) {
        setAgentMetadataVia(record, hooks, null);
      }
      return;
    }
    plog.debug({ session: nextKey }, "agent session matched");
    current = {
      key: nextKey,
      watcher: provider.createWatcher(
        next,
        (info) => {
          setAgentMetadataVia(record, hooks, info as unknown as AgentInfo);
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

  const cleanupTitle = channels.title.consume({
    onEvent: () => reconcile(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  const cleanupCwd = channels.cwd.consume({
    onEvent: (cwd) => {
      currentCwd = cwd;
      reconcile();
    },
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  const cleanupCommandRun = channels.commandRun.consume({
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

/** Start every per-terminal provider for one terminal. Both
 *  `LocalTerminalBackend` and `runAgent` call this with their
 *  respective channels + hooks. Provider order matters only for
 *  the agent-command tracker — it must come first so its stash is
 *  populated before agent detectors reconcile against it. */
export function startProviders(
  record: ProviderRecord,
  terminalId: TerminalId,
  channels: ProviderChannels,
  hooks: ProviderHooks,
): () => void {
  const stopAgentCommand = startAgentCommandTracker(
    record,
    terminalId,
    channels,
    hooks,
  );
  const stopGit = startGitProvider(record, terminalId, channels, hooks);
  const stopGitHubPr = startGitHubPrProvider(
    record,
    terminalId,
    channels,
    hooks,
  );
  const stopClaude = startAgentProvider(
    claudeCodeProvider,
    record,
    terminalId,
    channels,
    hooks,
  );
  const stopCodex = startAgentProvider(
    codexProvider,
    record,
    terminalId,
    channels,
    hooks,
  );
  const stopOpenCode = startAgentProvider(
    opencodeProvider,
    record,
    terminalId,
    channels,
    hooks,
  );
  const stopProcess = startProcessProvider(record, terminalId, channels, hooks);
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
