/** Per-terminal provider DAG, parameterized over `ProviderHooks` +
 *  `ProviderChannels` + `ProviderRecord` so the host is the only thing
 *  that varies. kolu-server's local backend (`./local.ts`) instantiates it,
 *  feeding it the pty-host's raw taps over the `ptyHostSurface` contract; a
 *  remote ssh pty-host serves the same taps in #951 R-2 — same DAG, different
 *  transport.
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
import type { ForegroundSample } from "@kolu/pty-host";
import type { Channel } from "@kolu/surface/server";
import { log } from "../log.ts";
import { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";

/** Minimal "terminal record" shape the provider DAG needs. The local backend
 *  (`./local.ts`) constructs one per terminal; the providers only touch
 *  `pid` + `meta` + `currentAgent` from here. `meta` is
 *  `TerminalServerMetadata` — the canonical
 *  `ServerPersistedTerminalFields ∪ LiveTerminalFields` union from
 *  `kolu-common/surface` (the same write-fence partition `metadata.ts`
 *  enforces). A `createMetadata` result satisfies it directly. */
export interface ProviderRecord {
  /** OS pid of the PTY's shell — constant for the terminal's life, known at
   *  spawn. The agent detectors compare it to the foreground pid to decide
   *  "shell idle" (foreground IS the shell). No longer a `PtyHandle`: the
   *  live reads (process name + foreground pid) that used to come off the
   *  handle synchronously now arrive over `channels.foreground`, so the DAG
   *  has zero sync dependency on the PTY host — which is what lets it run on
   *  the far side of a socket from pty-host (R4c) or ssh (R-2). */
  pid: number;
  meta: TerminalServerMetadata;
  /** Ephemeral basename of the agent binary at the foreground right
   *  now; written by the agent-command tracker, read by the agent
   *  detectors. Null when the shell is idle. */
  currentAgent: string | null;
}

/** Per-terminal channels the providers subscribe to. The local backend
 *  (`./local.ts`) creates a fresh in-memory channel of each kind per terminal
 *  and feeds them from the pty-host's tap streams; a remote pty-host serves
 *  the same taps. */
export interface ProviderChannels {
  cwd: Channel<string>;
  title: Channel<string>;
  commandRun: Channel<string>;
  /** Foreground samples (`{process, foregroundPid}`) from pty-host's
   *  foreground tap — the channel form of the old synchronous
   *  `ptyHandle.process` / `.foregroundPid` reads, so the DAG works across a
   *  socket. The host pushes a current snapshot first, then changes. */
  foreground: Channel<ForegroundSample>;
  git: Channel<GitInfo | null>;
}

/** Host hooks — the providers call these to update metadata + emit
 *  side effects. The mutator parameter types are narrowed to the two
 *  halves of the persisted-vs-live partition (the same fence
 *  `metadata.ts` enforces): writing `m.agent` through
 *  `updateServerMetadata` is a compile error, so the
 *  `terminals:dirty` autosave firehose can't be reintroduced by a new
 *  provider. The local backend (`makeHooks` in `./local.ts`) wires these
 *  straight to kolu-server's metadata + activity surfaces; the same fence
 *  applies there.
 *
 *  `record` is passed to every hook so a host whose update function isn't
 *  already keyed by terminal id (e.g. one with a global publish surface)
 *  can look the record up in its own registry to dispatch the write. The
 *  backend already has the entry + id captured in `makeHooks`'s per-terminal
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
  /** Optional — activity-feed signals into kolu-server's cross-terminal MRUs
   *  (recent-repos / recent-agents); a host with no activity feed omits them. */
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
  // Foreground `{name, title}` — one concept, two coherent fields, so it's one
  // value not four scattered bindings. The name is tracked from
  // `channels.foreground` (the pty-host tap) rather than read synchronously
  // off a handle — so this works when pty-host lives across a socket; the
  // title is tracked from `channels.title`. `current` is what we've observed;
  // `published` is what we last wrote, so `recompute` republishes only on a
  // real change.
  type FgState = { name: string | null; title: string | null };
  const current: FgState = { name: null, title: null };
  let published: FgState = { name: null, title: null };
  plog.debug("started");

  function recompute() {
    if (current.name === published.name && current.title === published.title)
      return;
    plog.debug(
      { from: published.name, to: current.name, title: current.title },
      "foreground changed",
    );
    published = { ...current };
    hooks.updateServerLiveMetadata(record, (m) => {
      m.foreground =
        current.name === null
          ? null
          : { name: current.name, title: current.title };
    });
  }

  const cleanupForeground = channels.foreground.consume({
    onEvent: (fg) => {
      current.name = processBasename(fg.process);
      recompute();
    },
    onError: (err) => plog.error({ err }, "foreground subscription failed"),
  });
  const cleanupTitle = channels.title.consume({
    onEvent: (title) => {
      current.title = title;
      recompute();
    },
    onError: (err) => plog.error({ err }, "title subscription failed"),
  });
  return () => {
    cleanupForeground();
    cleanupTitle();
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

function snapshotTerminalState(
  foreground: ForegroundSample,
  pid: number,
  cwd: string,
  currentAgent: string | null,
): AgentTerminalState {
  const foregroundPid = foreground.foregroundPid;
  // Shell is idle when the foreground process group IS the shell itself (or
  // unknown). `pid` is the shell's pid (constant, from spawn).
  const shellIdle = foregroundPid === undefined || foregroundPid === pid;
  const proc = foreground.process;
  return {
    foregroundPid,
    cwd,
    readForegroundBasename: () => (proc ? path.basename(proc) : null),
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

/** After a command-run mark, re-run agent-session resolution across the
 *  settle window (the agent writes its session file a beat after the mark).
 *  This is the *consumer* schedule and is independent of pty-host's
 *  foreground-sample burst: the DAG also reconciles whenever the foreground
 *  tap pushes a fresh sample, so foreground freshness rides the primitive's
 *  own settle window — these delays only re-check the agent-state files. */
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
  // Foreground source-of-truth for this provider, tracked from
  // `channels.foreground` (seeded empty → "shell idle" until the first
  // sample arrives). Same rationale as `currentCwd`: read it from the
  // channel, not a synchronous handle, so the DAG is transport-agnostic.
  let currentForeground: ForegroundSample = {
    process: "",
    foregroundPid: undefined,
  };
  plog.debug("started");

  // `reconcile` must never throw. It is called bare from four channel
  // `onEvent` callbacks — and a throw inside `onEvent` breaks out of
  // `buildConsume`'s `for await` loop (see surface/server.ts), silently
  // freezing that subscription for the terminal's life — and synchronously
  // on the foreground snapshot fire. One try/catch here is the single place
  // that invariant lives, so the bare call sites stay honest.
  function reconcile() {
    try {
      reconcileInner();
    } catch (err) {
      plog.error({ err }, "reconcile failed");
    }
  }
  function reconcileInner() {
    const state = snapshotTerminalState(
      currentForeground,
      record.pid,
      currentCwd,
      record.currentAgent,
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
            // Every reconciler is a `reconcile` (above) and cannot throw, so
            // the fan-out needs no per-callback guard.
            for (const fn of [...activation.reconcilers]) fn();
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
    reconcile();
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
  const cleanupForeground = channels.foreground.consume({
    onEvent: (fg) => {
      currentForeground = fg;
      reconcile();
    },
    onError: (err) => plog.error({ err }, "foreground subscription failed"),
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
    cleanupForeground();
    cleanupCwd();
    cleanupCommandRun();
    if (registeredForExternal) {
      activations.get(provider.kind)?.reconcilers.delete(reconcile);
    }
    current?.watcher.destroy();
    plog.debug("stopped");
  };
}

/** Start every per-terminal provider for one terminal. The local backend
 *  (`./local.ts`) calls this with its channels + hooks. Provider order matters
 *  only for the agent-command tracker — it must come first so its stash is
 *  populated before agent detectors reconcile. */
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
