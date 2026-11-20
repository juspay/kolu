import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  AgentInfoShape,
  AgentAdapter,
  AgentTerminalState,
  AgentWatcher,
} from "anyagent";
import { agentNameHint, matchesAgent, stableFlagTokens } from "anyagent";
import type { ForgeAdapter, PrResult } from "anyforge";
import { parseRemoteHost, subscribePr } from "anyforge";
import { AGENT_PLUGINS } from "kolu-agents";
import {
  type AgentKind,
  agentCliGrammar,
  agentPresence,
  isAgentBinaryName,
  isAgentKind,
  isAgentPresence,
} from "kolu-agents/vocab";
import {
  type ProcessSnapshot,
  readProcessSnapshot,
  runInChildScope,
} from "kolu-io";
import { subscribeGitInfo } from "kolu-git";
import type { GitInfo } from "kolu-git/schemas";
import { githubForgeAdapter } from "kolu-github";
import type { ForegroundSample } from "kaval";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import type { Logger } from "pino";
import type {
  AgentInfo,
  AgentObservation,
  TerminalEvent,
  PrUnavailableSource,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import {
  AgentInfoSchema,
  gitFactOf,
  gridsEqual,
  portsEqual,
} from "@kolu/terminal-vocab/schema";
import { type Equivalence, Schema } from "effect";
import { agentIdentityChanged, sameArgv } from "./fold.ts";
import { askerLabel } from "../diagnostics/askers.ts";
import { claimSession, releaseTerminal } from "./sessionOwnership.ts";

interface AgentEngineState {
  mirror: AgentObservation | null;
  currentAgent: string | null;
  episode: AgentEpisode;
  procSnapshot: ForegroundProcSnapshotCache;
  presenceStep:
    | { readonly pid: number; readonly saw: "settled" | "submitted" }
    | undefined;
  presenceListeners: Set<() => void>;
}

type AgentEpisode =
  | { readonly kind: "undated" }
  | { readonly kind: "shellIdle" }
  | { readonly kind: "started"; readonly pid: number; readonly since: number };

interface ForegroundProcSnapshotCache {
  read(sample: ForegroundSample, log: Logger): ProcessSnapshot | null;
}

function foregroundProcSnapshotCache(): ForegroundProcSnapshotCache {
  let held: { sample: ForegroundSample; value: ProcessSnapshot } | null = null;
  return {
    read(sample, log) {
      const foregroundPid = sample.foregroundPid;
      if (foregroundPid === undefined) return null;
      if (held !== null && held.sample === sample) return held.value;
      const value = readProcessSnapshot(foregroundPid, log);
      if (value !== null) held = { sample, value };
      return value;
    },
  };
}

export function freshAgentEngineState(): AgentEngineState {
  return {
    mirror: null,
    currentAgent: null,
    episode: { kind: "undated" },
    procSnapshot: foregroundProcSnapshotCache(),
    presenceStep: undefined,
    presenceListeners: new Set(),
  };
}

/** Per-terminal signals the sensors subscribe to. The host creates a fresh
 *  in-memory channel of each kind per terminal and feeds them from the
 *  pty-host's tap streams. */
export interface SensorSignals {
  cwd: Channel<string>;
  title: Channel<string>;
  /** Preexec command marks — RAW PTY BYTES, the host replaying the last one on
   *  subscribe. A SENSOR only: nothing here can become a command. */
  commandRun: Channel<string>;
  /** Foreground samples from pty-host's foreground tap; the host pushes a
   *  current snapshot first, then changes. */
  foreground: Channel<ForegroundSample>;
  /** This terminal's listening TCP ports, re-sampled WHOLE each pass by the
   *  host's port sampler. */
  ports: Channel<TerminalPorts>;
  /** This terminal's pty grid, published by padi's own resize path — not a
   *  pty-host tap. */
  grid: Channel<TerminalGrid>;
  /** The host saying this terminal's agent, while `starting` or `prompted`, has
   *  gone quiet — its screen has settled. Moves a presence to `fresh`. */
  screenSettled: Channel<void>;
  /** The host saying a write it delivered to this terminal SUBMITTED (a registry
   *  submit key, typed outside a paste). Moves a presence to `prompted`. */
  submitted: Channel<void>;
}

/** Read the terminal's current rendered screen as VT-resolved plain text, only
 *  the last `tailLines` rendered lines. Optional host input; without it,
 *  `AgentAdapter.screenScrape` promotion is inactive. */
type ReadScreenText = (tailLines: number) => Promise<string>;

function processBasename(proc: string): string {
  return path.basename(proc);
}

function consumeSafe<T>(
  channel: Channel<T>,
  log: Logger,
  what: string,
  onEvent: (value: T) => void,
): () => void {
  return channel.consume({
    onEvent: (value) => {
      try {
        onEvent(value);
      } catch (err) {
        log.error({ err }, `${what} handler failed`);
      }
    },
    onError: (err) => log.error({ err }, `${what} subscription failed`),
  });
}

function startForegroundSensor(
  terminalId: TerminalId,
  signals: SensorSignals,
  pid: number,
  commandRooted: boolean,
  emit: (o: TerminalEvent) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  type FgState = { name: string | null; title: string | null; shell: boolean };
  const current: FgState = { name: null, title: null, shell: false };
  let published: FgState = { name: null, title: null, shell: false };
  plog.debug("started");

  function recompute() {
    if (
      current.name === published.name &&
      current.title === published.title &&
      current.shell === published.shell
    )
      return;
    plog.debug(
      { from: published.name, to: current.name, title: current.title },
      "foreground changed",
    );
    published = { ...current };
    emit({
      kind: "foreground",
      foreground:
        current.name === null
          ? null
          : { name: current.name, title: current.title, shell: current.shell },
    });
  }

  const cleanupForeground = consumeSafe(
    signals.foreground,
    plog,
    "foreground",
    (fg) => {
      current.name = processBasename(fg.process);
      current.shell = isShellIdle(fg.foregroundPid, pid, commandRooted);
      recompute();
    },
  );
  const cleanupTitle = consumeSafe(signals.title, plog, "title", (title) => {
    current.title = title;
    recompute();
  });
  return () => {
    cleanupForeground();
    cleanupTitle();
    plog.debug("stopped");
  };
}

export function startGridSensor(
  terminalId: TerminalId,
  signals: SensorSignals,
  emit: (o: TerminalEvent) => void,
  log: Logger,
): () => void {
  const glog = log.child({ provider: "grid", terminal: terminalId });
  let published: TerminalGrid | undefined;
  const cleanup = consumeSafe(signals.grid, glog, "grid", (grid) => {
    if (published !== undefined && gridsEqual(published, grid)) return;
    glog.debug({ cols: grid.cols, rows: grid.rows }, "pty grid changed");
    published = grid;
    emit({ kind: "grid", grid });
  });
  return cleanup;
}

export function startPortSensor(
  terminalId: TerminalId,
  signals: SensorSignals,
  emit: (o: TerminalEvent) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "ports", terminal: terminalId });
  let published: TerminalPorts = { status: "unknown" };
  plog.debug("started");
  const cleanup = consumeSafe(signals.ports, plog, "ports", (ports) => {
    if (published === ports || portsEqual(published, ports)) return;
    plog.debug(
      ports.status === "known"
        ? { ports: ports.list.map((p) => p.port) }
        : { ports: "unknown" },
      "listening ports changed",
    );
    published = ports;
    emit({ kind: "ports", ports });
  });
  return () => {
    cleanup();
    plog.debug("stopped");
  };
}

function startGitSensor(
  cwd: string,
  terminalId: TerminalId,
  signals: SensorSignals,
  gitChannel: Channel<GitInfo | null>,
  emit: (o: TerminalEvent) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd }, "started");
  const watcher = subscribeGitInfo(
    cwd,
    askerLabel.terminal(terminalId),
    (git) => {
      emit({ kind: "git", git: gitFactOf(git) });
      gitChannel.publish(git);
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
  );
  const cleanup = consumeSafe(signals.cwd, plog, "publisher", (cwd) =>
    watcher.setCwd(cwd),
  );
  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

const unsupportedForgeAdapter = {
  kind: "unsupported" as const,
  resolve: (): Promise<PrResult<PrUnavailableSource>> =>
    Promise.resolve({ kind: "unsupported" }),
} satisfies ForgeAdapter<PrUnavailableSource>;

type ForgeKind =
  | (typeof githubForgeAdapter)["kind"]
  | (typeof unsupportedForgeAdapter)["kind"];

const FORGE_ADAPTERS: Record<ForgeKind, ForgeAdapter<PrUnavailableSource>> = {
  github: githubForgeAdapter,
  unsupported: unsupportedForgeAdapter,
};

/** Map a repo's `origin` remote URL to the forge that resolves its PRs. ONLY
 *  `github.com` routes to `gh`: a non-GitHub remote cannot have a GitHub PR, and
 *  asking anyway produces error-level log noise and a scary popover
 *  (juspay/kolu#1627). GitHub Enterprise stays out of scope until the anyforge
 *  work (#1240). */
export function detectForge(remoteUrl: string | null): ForgeKind {
  switch (parseRemoteHost(remoteUrl)) {
    case "github.com":
      return "github";
    default:
      return "unsupported";
  }
}

export const dispatchingForgeAdapter: ForgeAdapter<PrUnavailableSource> = {
  kind: "forge-dispatch",
  resolve: (git, cause, log) =>
    runInChildScope({ cause }, () =>
      FORGE_ADAPTERS[detectForge(git.remoteUrl)].resolve(git, cause, log),
    ),
};

function startPrSensor(
  terminalId: TerminalId,
  gitChannel: Channel<GitInfo | null>,
  emit: (o: TerminalEvent) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "pr", terminal: terminalId });
  plog.debug("started");
  const watcher = subscribePr(
    dispatchingForgeAdapter,
    (pr) => {
      emit({ kind: "pr", pr });
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
    },
    plog,
  );
  const cleanup = consumeSafe(gitChannel, plog, "publisher", (git) =>
    watcher.setGit(
      git
        ? {
            repoRoot: git.repoRoot,
            branch: git.branch,
            remoteUrl: git.remoteUrl,
          }
        : null,
    ),
  );
  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

export function startAgentCommandSensor(
  agentState: AgentEngineState,
  terminalId: TerminalId,
  signals: SensorSignals,
  emit: (o: TerminalEvent) => void,
  log: Logger,
): () => void {
  const clog = log.child({ terminal: terminalId, channel: "commandRun" });
  return consumeSafe(signals.commandRun, clog, "publisher", (raw) => {
    const hint = agentNameHint(raw);
    agentState.currentAgent =
      hint !== null && isAgentBinaryName(hint) ? hint : null;
    if (agentState.mirror === null && agentState.currentAgent !== null) {
      emit({ kind: "agent", agent: "unknown" });
    }
  });
}

function isShellIdle(
  foregroundPid: number | undefined,
  pid: number,
  commandRooted: boolean,
): boolean {
  return commandRooted
    ? false
    : foregroundPid === undefined || foregroundPid === pid;
}

function snapshotSignals(
  foreground: ForegroundSample,
  pid: number,
  cwd: string,
  agentState: AgentEngineState,
  commandRooted: boolean,
  log: Logger,
): { state: AgentTerminalState; shellIdle: boolean } {
  const foregroundPid = foreground.foregroundPid;
  const shellIdle = isShellIdle(foregroundPid, pid, commandRooted);
  const proc = foreground.process;
  return {
    state: {
      foregroundPid,
      cwd,
      readForegroundBasename: () => (proc ? path.basename(proc) : null),
      lastAgentCommandName: shellIdle ? null : agentState.currentAgent,
      readProcessSnapshot: () => agentState.procSnapshot.read(foreground, log),
    },
    shellIdle,
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

const SCREEN_SCRAPE_POLL_MS = 1000;

interface ScreenScrapePoll {
  readonly firstRead: Promise<void> | null;
  stop(): void;
}

type SessionResolution =
  | { readonly kind: "matched"; readonly key: string }
  | {
      readonly kind: "absent";
      readonly shellIdle: boolean;
      readonly agentInFront: boolean;
    };

function sameResolution(
  a: SessionResolution | null,
  b: SessionResolution,
): boolean {
  if (a === null) return false;
  if (a.kind === "matched") return b.kind === "matched" && a.key === b.key;
  return (
    b.kind === "absent" &&
    a.shellIdle === b.shellIdle &&
    a.agentInFront === b.agentInFront
  );
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "NOT_FOUND"
  );
}

export function observationFromSample(
  next: { info: AgentInfo; argv: readonly string[] | null } | null,
  mirror: AgentObservation | null,
): AgentObservation | null {
  if (next === null) return null;
  const argv =
    next.argv ??
    (mirror !== null && !agentIdentityChanged(mirror.info, next.info)
      ? mirror.argv
      : []);
  return { info: next.info, argv };
}

function emitAgentValue(
  agentState: AgentEngineState,
  emit: (o: TerminalEvent) => void,
  next: { info: AgentInfo; argv: readonly string[] | null } | null,
): void {
  const resolved = observationFromSample(next, agentState.mirror);
  if (agentObservationEqual(agentState.mirror, resolved)) return;
  agentState.mirror = resolved;
  emit({ kind: "agent", agent: { value: resolved } });
}

const sameAgentInfo = Schema.toEquivalence(AgentInfoSchema);

export const agentObservationEqual: Equivalence.Equivalence<
  AgentObservation | null
> = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (!sameAgentInfo(a.info, b.info)) return false;
  return sameArgv(a.argv, b.argv);
};

export function startAgentSensor<Session, Info extends AgentInfoShape>(
  adapter: AgentAdapter<Session, Info>,
  agentState: AgentEngineState,
  pid: number,
  spawnCwd: string,
  terminalId: TerminalId,
  signals: SensorSignals,
  readScreenText: ReadScreenText | undefined,
  emit: (o: TerminalEvent) => void,
  log: Logger,
  commandRooted: boolean,
  onFirstPass: () => void,
): () => void {
  const plog = log.child({ provider: adapter.kind, terminal: terminalId });
  let current: {
    watcher: AgentWatcher;
    key: string;
    poll: ScreenScrapePoll;
  } | null = null;
  let lastResolution: SessionResolution | null = null;
  let latestInfo: Info | null = null;
  const publishedAgent = (): AgentInfo | null => {
    const published = agentState.mirror;
    return published?.info.kind === adapter.kind ? published.info : null;
  };
  let registeredForExternal = false;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];
  let currentCwd = spawnCwd;
  let currentForeground: ForegroundSample = {
    process: "",
    foregroundPid: undefined,
  };
  const grammar = agentCliGrammar(adapter.kind);
  if (!isAgentKind(adapter.kind))
    throw new Error(`unknown agent kind: ${adapter.kind}`);
  const kind: AgentKind = adapter.kind;
  const liveArgv = (): readonly string[] | null => {
    const snapshot = agentState.procSnapshot.read(currentForeground, plog);
    return snapshot === null ? null : stableFlagTokens(grammar, snapshot.argv);
  };
  plog.debug("started");

  const presenceMayPublish = (): boolean => {
    const published = agentState.mirror;
    return (
      published === null ||
      published.info.kind !== kind ||
      isAgentPresence(published.info)
    );
  };

  function publishPresence(sessionId: string | null): void {
    const fg = currentForeground.foregroundPid;
    const step = agentState.presenceStep;
    const state =
      fg === undefined || step?.pid !== fg
        ? "starting"
        : step.saw === "settled"
          ? "fresh"
          : "prompted";
    emitAgentValue(agentState, emit, {
      info: agentPresence(kind, state, sessionId),
      argv: liveArgv(),
    });
  }

  function scrapePollOwnsPublish(info: Info): boolean {
    const scrape = adapter.screenScrape;
    if (!scrape || !readScreenText || !scrape.isPollable(info)) return false;
    return publishedAgent()?.state === "awaiting_user";
  }

  const republishPresence = (): void => {
    if (stopped) return;
    const published = agentState.mirror?.info;
    if (published?.kind === kind && isAgentPresence(published))
      publishPresence(published.sessionId);
  };
  agentState.presenceListeners.add(republishPresence);

  function noteEpisode(fg: ForegroundSample): void {
    if (isShellIdle(fg.foregroundPid, pid, commandRooted)) {
      agentState.episode = { kind: "shellIdle" };
      return;
    }
    const episode = agentState.episode;
    if (episode.kind === "undated") return;
    const foregroundPid = fg.foregroundPid;
    if (foregroundPid === undefined) return;
    if (episode.kind === "started" && episode.pid === foregroundPid) return;
    agentState.episode = {
      kind: "started",
      pid: foregroundPid,
      since: Date.now(),
    };
  }

  function reconcile() {
    if (stopped) return;
    try {
      reconcileInner();
    } catch (err) {
      plog.error({ err }, "reconcile failed");
    }
  }
  function reconcileInner() {
    const { state, shellIdle } = snapshotSignals(
      currentForeground,
      pid,
      currentCwd,
      agentState,
      commandRooted,
      plog,
    );
    if (!registeredForExternal && adapter.externalChanges?.isPresent(state)) {
      const activation = getActivation(adapter.kind);
      activation.reconcilers.add(reconcile);
      registeredForExternal = true;
      if (!activation.installed) {
        activation.installed = true;
        const slog = log.child({ provider: adapter.kind });
        adapter.externalChanges.install(
          () => {
            for (const fn of [...activation.reconcilers]) fn();
          },
          (err) => slog.error({ err }, "external-change listener threw"),
          slog,
        );
      }
    }
    const offered = adapter.resolveSessions(state, plog);
    if (offered === null && current !== null) {
      plog.debug("session store unreadable — holding the previous match");
      return;
    }
    if (offered === null)
      plog.debug("session store unreadable — reading the process alone");
    const episode = agentState.episode;
    const since = episode.kind === "started" ? episode.since : null;
    const next = claimSession(
      adapter.kind,
      terminalId,
      (offered ?? []).map((session) => ({
        key: adapter.sessionKey(session),
        createdAt: since === null ? null : adapter.sessionStartedAt(session),
        value: session,
      })),
      since,
    );
    const nextKey = next === null ? null : adapter.sessionKey(next);
    const agentInFront = matchesAgent(state, grammar);
    const resolution: SessionResolution =
      nextKey === null
        ? { kind: "absent", shellIdle, agentInFront }
        : { kind: "matched", key: nextKey };
    if (sameResolution(lastResolution, resolution)) return;
    const hadCurrent = current !== null;
    destroyCurrent();
    lastResolution = resolution;
    if (!next || !nextKey) {
      if (hadCurrent)
        plog.debug(
          shellIdle
            ? "agent session ended (shell idle)"
            : "agent foreground unresolvable but defined — keeping last (unknown)",
        );
      if (agentInFront && presenceMayPublish()) {
        publishPresence(null);
        return;
      }
      if (agentState.mirror?.info.kind === adapter.kind) {
        if (shellIdle) emitAgentValue(agentState, emit, null);
        else emit({ kind: "agent", agent: "unknown" });
      }
      return;
    }
    plog.debug({ session: nextKey }, "agent session matched");
    current = {
      key: nextKey,
      watcher: adapter.createWatcher(
        next,
        (info) => {
          latestInfo = info;
          if (scrapePollOwnsPublish(info)) return;
          emitAgentValue(agentState, emit, {
            info: info as unknown as AgentInfo,
            argv: liveArgv(),
          });
        },
        plog,
      ),
      poll: startScreenScrapePoll(),
    };
    if (latestInfo === null)
      publishPresence(adapter.presenceSessionId?.(next) ?? null);
  }

  function destroyCurrent() {
    current?.watcher.destroy();
    current?.poll.stop();
    current = null;
    latestInfo = null;
  }

  function startScreenScrapePoll(): ScreenScrapePoll {
    const scrape = adapter.screenScrape;
    const readScreen = readScreenText;
    if (!scrape || !readScreen) return { stop: () => {}, firstRead: null };
    let pollStopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const info = latestInfo;
        if (!info || !scrape.isPollable(info)) return;
        const text = await readScreen(scrape.tailLines);
        if (pollStopped || latestInfo !== info) return;

        const desired = scrape.promote(info, text);
        const published = publishedAgent();
        if (published && !isDeepStrictEqual(published, desired)) {
          emitAgentValue(agentState, emit, {
            info: desired as unknown as AgentInfo,
            argv: liveArgv(),
          });
        }
      } catch (err) {
        if (isNotFoundError(err)) {
          plog.debug({ err }, "screen-scrape poll tick raced teardown");
        } else {
          plog.error({ err }, "screen-scrape poll tick failed");
        }
      } finally {
        if (!pollStopped) timer = setTimeout(tick, SCREEN_SCRAPE_POLL_MS);
      }
    };
    const firstRead = tick();
    plog.info(
      { terminal: terminalId },
      "claude-code: screen-scrape poll installed",
    );
    return {
      firstRead,
      stop: () => {
        pollStopped = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        plog.info(
          { terminal: terminalId },
          "claude-code: screen-scrape poll retired",
        );
      },
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

  const cleanupTitle = consumeSafe(signals.title, plog, "publisher", () =>
    reconcile(),
  );
  let firstPassReported = false;
  const reportFirstPass = (): void => {
    if (!stopped) onFirstPass();
  };
  const cleanupForeground = consumeSafe(
    signals.foreground,
    plog,
    "foreground",
    (fg) => {
      noteEpisode(fg);
      currentForeground = fg;
      reconcile();
      if (firstPassReported || stopped) return;
      firstPassReported = true;
      const screenRead = current?.poll.firstRead ?? null;
      if (screenRead === null) reportFirstPass();
      else void screenRead.then(reportFirstPass);
    },
  );
  const cleanupCwd = consumeSafe(signals.cwd, plog, "publisher", (cwd) => {
    currentCwd = cwd;
    reconcile();
  });
  const cleanupCommandRun = consumeSafe(
    signals.commandRun,
    plog,
    "publisher",
    () => scheduleCommandRunReconciles(),
  );
  reconcile();

  return () => {
    stopped = true;
    clearCommandRunTimers();
    cleanupTitle();
    cleanupForeground();
    cleanupCwd();
    cleanupCommandRun();
    agentState.presenceListeners.delete(republishPresence);
    if (registeredForExternal) {
      activations.get(adapter.kind)?.reconcilers.delete(reconcile);
    }
    destroyCurrent();
    releaseTerminal(adapter.kind, terminalId);
    plog.debug("stopped");
  };
}

export function startPresenceStepSensor(
  agentState: AgentEngineState,
  terminalId: TerminalId,
  signals: Pick<SensorSignals, "foreground" | "screenSettled" | "submitted">,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "presence", terminal: terminalId });
  let foregroundPid: number | undefined;
  const note = (saw: "settled" | "submitted"): void => {
    if (foregroundPid === undefined) return;
    agentState.presenceStep = { pid: foregroundPid, saw };
    for (const republish of agentState.presenceListeners) republish();
  };
  const stops = [
    consumeSafe(signals.foreground, plog, "foreground", (fg) => {
      foregroundPid = fg.foregroundPid;
    }),
    consumeSafe(signals.screenSettled, plog, "screen-settled", () =>
      note("settled"),
    ),
    consumeSafe(signals.submitted, plog, "submitted", () => note("submitted")),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

/** The host inputs the memoryless producer needs. NO seed and no store: a host
 *  hands it only what it observes. */
export interface SensorInputs {
  /** OS pid of the PTY's ROOT process — constant for the terminal's life (the
   *  shell for a shell-rooted PTY, the command for a command-rooted one). */
  pid: number;
  /** Spawn-time cwd — read once at start; later cwd changes flow via `signals.cwd`. */
  cwd: string;
  /** True when the PTY's root process IS the spawned command, not a shell.
   *  Required: the host resolves "absent = shell-rooted" at the wire-read
   *  boundary, so a concrete boolean always reaches here. */
  commandRooted: boolean;
  signals: SensorSignals;
  readScreenText?: ReadScreenText;
  log: Logger;
  /** Called ONCE, when EVERY agent detector has made its first pass over a real
   *  foreground sample. */
  onAgentsRead: () => void;
}

/** Start the memoryless per-terminal awareness PRODUCER: it emits per-field
 *  `TerminalEvent`s through `emit` and returns a stop fn. Sensor order matters
 *  only for the agent-command tracker, which must start first. */
export function startSensors(
  terminalId: TerminalId,
  inputs: SensorInputs,
  emit: (o: TerminalEvent) => void,
): () => void {
  const {
    pid,
    cwd,
    commandRooted,
    signals,
    readScreenText,
    log,
    onAgentsRead,
  } = inputs;
  const agentState: AgentEngineState = freshAgentEngineState();

  const clog = log.child({ terminal: terminalId, channel: "cwd" });
  const stopCwd = consumeSafe(signals.cwd, clog, "cwd", (next) =>
    emit({ kind: "cwd", cwd: next }),
  );

  const stopAgentCommand = startAgentCommandSensor(
    agentState,
    terminalId,
    signals,
    emit,
    log,
  );
  const gitChannel = inMemoryChannel<GitInfo | null>();
  const stopGit = startGitSensor(
    cwd,
    terminalId,
    signals,
    gitChannel,
    emit,
    log,
  );
  const stopPr = startPrSensor(terminalId, gitChannel, emit, log);
  const plugins = Object.values(AGENT_PLUGINS);
  let unreadDetectors = plugins.length;
  const detectorRead = (): void => {
    unreadDetectors -= 1;
    if (unreadDetectors !== 0) return;
    try {
      onAgentsRead();
    } catch (err) {
      log.error({ err, terminal: terminalId }, "agents-read report failed");
    }
  };
  const startAgent = (adapter: AgentAdapter<unknown, AgentInfoShape>) =>
    startAgentSensor(
      adapter,
      agentState,
      pid,
      cwd,
      terminalId,
      signals,
      readScreenText,
      emit,
      log,
      commandRooted,
      detectorRead,
    );
  const stopAgents = plugins.map((plugin) => startAgent(plugin.adapter));
  const stopProcess = startForegroundSensor(
    terminalId,
    signals,
    pid,
    commandRooted,
    emit,
    log,
  );
  const stopPorts = startPortSensor(terminalId, signals, emit, log);
  const stopGrid = startGridSensor(terminalId, signals, emit, log);
  const stopPresenceStep = startPresenceStepSensor(
    agentState,
    terminalId,
    signals,
    log,
  );
  return () => {
    stopCwd();
    stopAgentCommand();
    stopGit();
    stopPr();
    stopPresenceStep();
    for (const stop of stopAgents) stop();
    stopProcess();
    stopPorts();
    stopGrid();
  };
}
