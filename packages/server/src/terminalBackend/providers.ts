/** Per-terminal provider DAG, parameterized over `ProviderHooks` +
 *  `ProviderChannels` + `ProviderRecord` so the host is the only thing
 *  that varies. The in-process agent (`./agent.ts`) instantiates it today
 *  (#951 R4b); a remote ssh agent that runs the same DAG against its own
 *  in-process channels arrives in #951 R-2 — same code, different transport.
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
 *  has to be provided by the host (the agent creates a per-terminal
 *  in-memory channel for it).
 *
 *  ## Host contract
 *
 *  `record.meta.cwd` is read once at provider start (the spawn-time
 *  cwd) and is not re-read afterwards; subsequent cwd changes flow
 *  ONLY through `channels.cwd`. Hosts must publish every cwd change to
 *  that channel — they are NOT required to keep `record.meta.cwd` in
 *  sync, though the agent happens to (its cwd bridge writes through
 *  `hooks.updateServerMetadata` so the persisted+published metadata
 *  stays current for clients). Any host that satisfies the
 *  `ProviderChannels`/`ProviderHooks` shape and publishes cwd to the
 *  channel will get correct agent / git resolution.
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
import type { PtyHandle } from "@kolu/pty-host";
import type { Logger } from "kolu-shared";
import type { Channel } from "@kolu/surface/server";
import { log } from "../log.ts";
import { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";

/** Minimal "terminal record" shape the provider DAG needs. The in-process
 *  agent (`./agent.ts`) constructs one per terminal (a remote agent will
 *  too); the providers only touch `ptyHandle` + `meta` + `currentAgent`
 *  from here. `meta` is `TerminalServerMetadata` — the canonical
 *  `ServerPersistedTerminalFields ∪ LiveTerminalFields` union from
 *  `kolu-common/surface` (the same write-fence partition `metadata.ts`
 *  enforces). A `createMetadata` result satisfies it directly. */
export interface ProviderRecord {
  ptyHandle: PtyHandle;
  meta: TerminalServerMetadata;
  /** Ephemeral basename of the agent binary at the foreground right
   *  now; written by the agent-command tracker, read by the agent
   *  detectors. Null when the shell is idle. */
  currentAgent: string | null;
}

/** Per-terminal channels the providers subscribe to. The agent creates a
 *  fresh in-memory channel of each kind per terminal and feeds them from
 *  pty-host's VT taps; a remote agent does the same. */
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
 *  provider. The agent (`makeHooks` in `./agent.ts`) wires these to emit
 *  `metadataPersisted`/`metadataLive` stream events; the same fence applies
 *  on its side, just published instead of mutated in place.
 *
 *  `record` is passed to every hook so a host whose update function isn't
 *  already keyed by terminal id (e.g. one with a global publish surface)
 *  can look the record up in its own registry to dispatch the write. The
 *  agent already has the record + id captured in `makeHooks`'s per-terminal
 *  closure, so it ignores the argument — hence the `_record` prefix. */
export interface ProviderHooks {
  updateServerMetadata: (
    record: ProviderRecord,
    mutate: (meta: ServerPersistedTerminalFields) => void,
  ) => void;
  updateServerLiveMetadata: (
    record: ProviderRecord,
    mutate: (meta: LiveTerminalFields) => void,
  ) => void;
  /** Optional — activity-feed signals. The agent forwards these as
   *  `recentRepo`/`recentAgent` stream events to kolu-server (which owns
   *  the cross-terminal MRUs); a host with no activity feed omits them. */
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

/** External-change activation registry, keyed by provider kind. Coordinates
 *  the "install the watcher once, then fan out to every terminal's
 *  reconciler" behavior.
 *
 *  Process-scoped by contract: `AgentProvider.externalChanges.install` is
 *  documented as fired "at most once per process… no uninstall" (anyagent),
 *  matching the underlying singletons (Codex's WAL watcher, Claude's
 *  SESSIONS_DIR watcher). So this registry — the install gate AND the
 *  reconciler set behind one process-lifetime watcher — is a module-scope
 *  singleton too. (An earlier R4b cut made it per-agent; that contradicted
 *  the no-uninstall contract — a second agent in one process would install
 *  a second permanent watcher with no way to remove it. When the agent is
 *  extracted to its own process in R4c, module scope already IS per-agent.) */
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
  // channel publish — a hidden contract the agent happens to honor (its
  // cwd bridge writes `record.meta.cwd` then publishes `channels.cwd`) but
  // a future host on the same `ProviderChannels`/`ProviderHooks` shape
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

/** Start every per-terminal provider for one terminal. The in-process
 *  agent (`./agent.ts`) calls this with its channels + hooks (a remote
 *  agent will too). Provider order matters only for the agent-command
 *  tracker — it must come first so its stash is populated before agent
 *  detectors reconcile. */
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
