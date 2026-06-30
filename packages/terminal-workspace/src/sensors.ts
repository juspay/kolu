/** The per-terminal awareness PRODUCER — memoryless and effectful. It owns
 *  transient DERIVATION working state (the agent watchers, the last-emitted agent
 *  mirror, the recognized-agent basename, the git→PR wire, the screen-scrape poll,
 *  the adapter registry — all re-seeded empty each start) and EMITS per-field
 *  `AwarenessObservation`s through `emit`. It takes NO seed and touches no host
 *  store: it cannot CONSTRUCT the two memory facts (`lastActivityAt` /
 *  `lastAgentCommand`), so however buggy / restarted / hostile its stream, it
 *  cannot overwrite a remembered fact — the fence is the EMIT TYPE (`Observation`),
 *  not a runtime mutator split. kolu folds the stream into a `KoluAwareness`
 *  (`./fold.ts`); the daemon (pulam) folds the observed half only.
 *
 *  Producer:
 *
 *    cwd:<id>          ─►  git watcher           ─►  PR watcher        emit pr
 *                          emit git
 *    title:<id>        ─►  process observer                           emit foreground
 *    title/cwd/cmd     ─►  agent detector ×3                          emit agent (Observed<>)
 *    commandRun:<id>   ─►  agent-command tracker                      emit commandRun
 *
 *  Note on the git→PR pipe: the PR sensor chains off the `GitInfo` the git sensor
 *  emits. That channel is an internal sensor-to-sensor wire, NOT a host input —
 *  `startAwarenessEngine` constructs it itself and hands it to just those two
 *  sensors, so hosts plug in only the four taps they actually drive.
 *
 *  ## Host contract
 *
 *  `inputs.cwd` is the spawn-time cwd, read once at start and not re-read;
 *  subsequent cwd changes flow ONLY through `signals.cwd`. Hosts must publish
 *  every cwd change to that channel. Any host that satisfies the
 *  `AwarenessSignals` shape and publishes cwd will get correct agent / git
 *  resolution. The MRUs (recent repos / recent agents) and recency are kolu's
 *  fold-side concern now — the producer emits the raw `git` / `commandRun`
 *  observations and kolu decides what to remember.
 */

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  AgentInfoShape,
  AgentAdapter,
  AgentTerminalState,
  AgentWatcher,
} from "anyagent";
import {
  agentInfoEqual,
  agentNameFromCommand,
  parseAgentCommand,
} from "anyagent";
import type { ForgeAdapter } from "anyforge";
import { parseRemoteHost, subscribePr } from "anyforge";
import { claudeCodeAdapter } from "kolu-claude-code";
import { codexAdapter } from "kolu-codex";
import { subscribeGitInfo } from "kolu-git";
import type { GitInfo } from "kolu-git/schemas";
import { githubForgeAdapter } from "kolu-github";
import { opencodeAdapter } from "kolu-opencode";
import type { ForegroundSample } from "kaval";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import type { Logger } from "pino";
import type {
  AgentInfo,
  AwarenessObservation,
  PrUnavailableSource,
  TerminalId,
} from "./schema.ts";

/** The engine's transient agent working state — the last-emitted agent value (the
 *  mirror that replaces the old `record.meta.agent` read-back) and the recognized
 *  agent basename at the foreground right now. Re-seeded empty each start (a
 *  producer is memoryless); shared across the three adapter detectors + the
 *  agent-command tracker so they coordinate one agent field without a host store. */
interface AgentEngineState {
  /** The last agent value the engine EMITTED — the publish-if-changed baseline and
   *  the cross-adapter ownership narrow (which adapter, if any, owns the tile). */
  mirror: AgentInfo | null;
  /** Basename of the recognized agent binary at the foreground (e.g. "claude"),
   *  set by the agent-command tracker, read by the detectors. Null when no
   *  recognized agent command is in flight (shell idle / non-agent command). */
  currentAgent: string | null;
}

/** A preexec command mark off the `commandRun` tap. `replayed` is true for the
 *  snapshot-first frame the pty-host emits on subscribe (the last command seen
 *  before the subscriber joined), false for a live mark. */
export interface CommandRunSample {
  command: string;
  replayed: boolean;
}

/** Per-terminal signals the sensors subscribe to. The host (kolu-server's
 *  local endpoint, or `pulam`) creates a fresh in-memory channel of each kind
 *  per terminal and feeds them from the pty-host's tap streams; a remote
 *  pty-host serves the same taps. */
export interface AwarenessSignals {
  cwd: Channel<string>;
  title: Channel<string>;
  /** Preexec command marks. `replayed` distinguishes the snapshot-first frame
   *  (the last command seen before subscribe, replayed so a late/restarted
   *  sensor still learns it) from a live mark. The agent-command tracker seeds
   *  detection from BOTH, but fires the live-only recent-agent recency bump
   *  ONLY on a live mark — a replay must not reorder the MRU as if the user
   *  just ran the command. */
  commandRun: Channel<CommandRunSample>;
  /** Foreground samples (`{process, foregroundPid}`) from pty-host's
   *  foreground tap — the channel form of the old synchronous
   *  `ptyHandle.process` / `.foregroundPid` reads, so the sensor set works across a
   *  socket. The host pushes a current snapshot first, then changes. */
  foreground: Channel<ForegroundSample>;
}

/** Read the terminal's current rendered screen as VT-resolved plain text — the
 *  one optional host input the producer takes (besides the taps). Provided by
 *  hosts that can reach the PTY screen buffer (kolu's local endpoint and pulam,
 *  via pty-host's `getScreenText`). Async + host-supplied, so the producer keeps
 *  its zero *synchronous* dependency on the PTY host. Drives
 *  `AgentAdapter.screenScrape` promotion (Claude's `AskUserQuestion` /
 *  `ExitPlanMode` — #905); without it, screen scrape is simply inactive.
 *
 *  `tailLines` reads only the last N rendered lines: the screen-scrape detector
 *  inspects just the screen bottom, so the poll asks for exactly its tail rather
 *  than the whole (up to 50k-line) buffer. Required, not optional, on the type:
 *  the only caller always passes its detector's `tailLines` (a `number`); leaving
 *  it optional would let a host map an omitted count to a `tail`-with-no-`lines`
 *  request the pty-host wire schema rejects. */
type ReadScreenText = (tailLines: number) => Promise<string>;

// ── Foreground process observer ──────────────────────────────────────

function processBasename(proc: string): string {
  return path.basename(proc);
}

function startForegroundSensor(
  terminalId: TerminalId,
  signals: AwarenessSignals,
  emit: (o: AwarenessObservation) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  // Foreground `{name, title}` — one concept, two coherent fields, so it's one
  // value not four scattered bindings. The name is tracked from
  // `signals.foreground` (the pty-host tap) rather than read synchronously
  // off a handle — so this works when pty-host lives across a socket; the
  // title is tracked from `signals.title`. `current` is what we've observed;
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
    emit({
      kind: "foreground",
      foreground:
        current.name === null
          ? null
          : { name: current.name, title: current.title },
    });
  }

  const cleanupForeground = signals.foreground.consume({
    onEvent: (fg) => {
      current.name = processBasename(fg.process);
      recompute();
    },
    onError: (err) => plog.error({ err }, "foreground subscription failed"),
  });
  const cleanupTitle = signals.title.consume({
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

function startGitSensor(
  cwd: string,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  gitChannel: Channel<GitInfo | null>,
  emit: (o: AwarenessObservation) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd }, "started");
  const watcher = subscribeGitInfo(
    cwd,
    (git) => {
      // Emit the raw `git` observation; kolu's fold owns the recent-repo MRU
      // (`trackRecentRepo`) now — a memoryless producer remembers nothing.
      emit({ kind: "git", git });
      gitChannel.publish(git);
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
  );
  const cleanup = signals.cwd.consume({
    onEvent: (cwd) => watcher.setCwd(cwd),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

// ── PR watcher ────────────────────────────────────────────────────────

/** The forges kolu can resolve a PR from. One today; a second forge adds an
 *  arm here plus an entry in `FORGE_ADAPTERS` and a host match in `detectForge`
 *  — nothing else in the watcher path changes.
 *
 *  Derived from the adapter's own `kind` literal (not a hand-written
 *  `"github"`) so the registry key and the adapter agree by construction: a
 *  phase-1 forge that adds an adapter must add the matching `FORGE_ADAPTERS` key
 *  or the `Record<ForgeKind, …>` below stops type-checking. */
type ForgeKind = (typeof githubForgeAdapter)["kind"];

/** Forge adapter per kind. Typed at the closed `PrUnavailableSource` union:
 *  each adapter's concrete source is a member, so a `ForgeAdapter<GhUnavailable…>`
 *  assigns covariantly with no cast, and the dispatcher's result lands in the
 *  metadata `PrResult` directly. */
const FORGE_ADAPTERS: Record<ForgeKind, ForgeAdapter<PrUnavailableSource>> = {
  github: githubForgeAdapter,
};

/** Map a repo's `origin` remote URL to the forge that resolves its PRs. Every
 *  host → github today: `gh` handles github.com and GitHub Enterprise, and
 *  post-#1256 it degrades to a silent `absent` on hosts it doesn't know. A
 *  second forge adds a host match here (e.g. `parseRemoteHost(remoteUrl) ===
 *  "codeberg.org"` → forgejo); detection stays sync and pure — no network probe. */
function detectForge(remoteUrl: string | null): ForgeKind {
  switch (parseRemoteHost(remoteUrl)) {
    default:
      return "github";
  }
}

/** A `ForgeAdapter` that routes each resolve to the forge `detectForge` picks
 *  from the git context's remote. Keeps `subscribePr`'s one-adapter contract
 *  intact while supporting per-resolve forge selection: the remote can change
 *  mid-session (`git remote set-url`), and consulting the registry on every
 *  resolve re-routes without tearing the watcher down. With one forge it always
 *  resolves to `githubForgeAdapter`, so behavior is identical to injecting it
 *  directly. */
const dispatchingForgeAdapter: ForgeAdapter<PrUnavailableSource> = {
  kind: "forge-dispatch",
  resolve: (git, log) =>
    FORGE_ADAPTERS[detectForge(git.remoteUrl)].resolve(git, log),
};

function startPrSensor(
  terminalId: TerminalId,
  gitChannel: Channel<GitInfo | null>,
  emit: (o: AwarenessObservation) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "pr", terminal: terminalId });
  plog.debug("started");
  // The dispatcher routes each resolve to the forge picked from the remote;
  // with one forge today that's always the gh adapter.
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
  const cleanup = gitChannel.consume({
    onEvent: (git) =>
      watcher.setGit(
        git
          ? {
              repoRoot: git.repoRoot,
              branch: git.branch,
              remoteUrl: git.remoteUrl,
            }
          : null,
      ),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}

// ── Agent-command tracker ─────────────────────────────────────────────

function startAgentCommandSensor(
  agentState: AgentEngineState,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  emit: (o: AwarenessObservation) => void,
  log: Logger,
): () => void {
  return signals.commandRun.consume({
    onEvent: ({ command: raw, replayed }) => {
      const normalized = parseAgentCommand(raw);
      agentState.currentAgent = normalized
        ? agentNameFromCommand(normalized)
        : null;
      if (normalized) {
        // Emit the recognized, normalized command mark. kolu's fold owns the
        // dedup (`lastAgentCommand === command`) and the recent-agent MRU
        // (live-only, on `!replayed`) — a memoryless producer can't dedup
        // against a value it doesn't keep.
        emit({ kind: "commandRun", command: normalized, replayed });
        // An agent is LAUNCHING from a clean state (no agent owns the tile yet):
        // emit `unknown` so the session file landing a beat later is read as
        // "still resolving" (kolu KEEPS its value), never an ambiguous null. Once
        // an adapter resolves it, the authoritative `{ value }` supersedes this.
        if (agentState.mirror === null)
          emit({ kind: "agent", agent: "unknown" });
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

function snapshotSignals(
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

/** External-change activation registry, keyed by adapter kind. Coordinates
 *  the "install the watcher once, then fan out to every terminal's
 *  reconciler" behavior.
 *
 *  Process-scoped by contract: `AgentAdapter.externalChanges.install` is
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
 *  foreground-sample burst: the sensor set also reconciles whenever the foreground
 *  tap pushes a fresh sample, so foreground freshness rides the primitive's
 *  own settle window — these delays only re-check the agent-state files. */
const COMMAND_RUN_RECONCILE_DELAYS_MS = [0, 75, 300, 1000] as const;

/** Cadence of the screen-scrape poll (`AgentAdapter.screenScrape`). The prompt
 *  appears asynchronously after the JSONL settles to `waiting` and produces no
 *  fs event, so the scrape needs its own ~1 s clock to catch it. Runs ONLY
 *  while the agent is in a pollable (idle) state, so it's off the hot path. */
const SCREEN_SCRAPE_POLL_MS = 1000;

/** True for the pty-host's "no PTY with id" ORPCError — the benign teardown
 *  race where the terminal vanished between a poll being scheduled and its
 *  screen read landing. Read `.code` structurally rather than via `instanceof`
 *  so it still classifies a deserialized error from a remote pty-host (the
 *  error crosses a socket in R-2 and is no longer the same class). */
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "NOT_FOUND"
  );
}

/** Emit an authoritative agent value `{ value: nextAgent }` (incl. an
 *  authoritative null = session ended), with the publish-if-changed dedup against
 *  the engine's last-emitted MIRROR — the one gate for "did kolu already reflect
 *  this?", so every publisher (watcher + screen-scrape poll + the session-ended
 *  branch) funnels through one equality check. The mirror REPLACES the old
 *  `record.meta.agent` read-back; recency (kolu's fold, on identity change) and
 *  the agent-session ref (collapsed into the frozen agent) are no longer the
 *  producer's concern. */
function emitAgentValue(
  agentState: AgentEngineState,
  emit: (o: AwarenessObservation) => void,
  nextAgent: AgentInfo | null,
): void {
  if (agentInfoEqual(agentState.mirror, nextAgent)) return;
  agentState.mirror = nextAgent;
  emit({ kind: "agent", agent: { value: nextAgent } });
}

function startAgentSensor<Session, Info extends AgentInfoShape>(
  adapter: AgentAdapter<Session, Info>,
  agentState: AgentEngineState,
  pid: number,
  spawnCwd: string,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  readScreenText: ReadScreenText | undefined,
  emit: (o: AwarenessObservation) => void,
  log: Logger,
): () => void {
  const plog = log.child({ provider: adapter.kind, terminal: terminalId });
  let current: {
    watcher: AgentWatcher;
    key: string;
    stopPoll: () => void;
  } | null = null;
  // The most recent watcher-derived info for the matched session — the screen
  // scrape merges against this (not the published metadata, which it may itself
  // have promoted). Null between sessions; reset in `destroyCurrent`.
  let latestInfo: Info | null = null;
  // The last-emitted agent, but only when it's this adapter's own — i.e. the
  // `mirror?.kind === adapter.kind` narrowing, defined once and shared by both
  // writers that ask "has the emitted state diverged from this candidate?": the
  // watcher callback (to *skip* the raw emit the poll owns) and the poll tick (to
  // *do* the re-emit). Returns null when nothing is emitted yet, or when a
  // different adapter owns the tile, so a caller reads the divergence test
  // declaratively off the result. Reads the ENGINE MIRROR (not a host store).
  const publishedAgent = (): AgentInfo | null => {
    const published = agentState.mirror;
    return published?.kind === adapter.kind ? published : null;
  };
  let registeredForExternal = false;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];
  // CWD source-of-truth for this adapter's lifetime: seeded once from `spawnCwd`
  // (the spawn-time cwd the host passes in `inputs.cwd`) and updated only via the
  // `cwd` channel — so agent detection depends on no host store, just the taps.
  let currentCwd = spawnCwd;
  // Foreground source-of-truth for this adapter, tracked from
  // `signals.foreground` (seeded empty → "shell idle" until the first
  // sample arrives). Same rationale as `currentCwd`: read it from the
  // channel, not a synchronous handle, so the sensor set is transport-agnostic.
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
    const state = snapshotSignals(
      currentForeground,
      pid,
      currentCwd,
      agentState.currentAgent,
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
            // Every reconciler is a `reconcile` (above) and cannot throw, so
            // the fan-out needs no per-callback guard.
            for (const fn of [...activation.reconcilers]) fn();
          },
          (err) => slog.error({ err }, "external-change listener threw"),
          slog,
        );
      }
    }
    const next = adapter.resolveSession(state, plog);
    const nextKey = next ? adapter.sessionKey(next) : null;
    if ((current?.key ?? null) === nextKey) return;
    const hadCurrent = current !== null;
    destroyCurrent();
    if (!next || !nextKey) {
      if (hadCurrent) plog.debug("agent session ended");
      // Authoritative session-ended null — ONLY when THIS adapter owns the
      // emitted tile (the mirror narrow). When no adapter owns it (a launch
      // mid-resolution), nothing is emitted, so kolu keeps its value rather than
      // seeing an ambiguous null.
      if (agentState.mirror?.kind === adapter.kind) {
        emitAgentValue(agentState, emit, null);
      }
      return;
    }
    plog.debug({ session: nextKey }, "agent session matched");
    current = {
      key: nextKey,
      watcher: adapter.createWatcher(
        next,
        (info) => {
          // The watcher's data-source-derived info is the source of truth; the
          // screen scrape only promotes off it. Always stash it so the poll
          // merges against the latest.
          latestInfo = info;
          // The screen-scrape poll is the single writer for the promote/demote
          // state edge: it lifts a pollable working state (thinking / tool_use /
          // waiting — a pending prompt leaves the JSONL on whichever of these
          // preceded the buffered reply) to `awaiting_user`, and is the only path
          // that settles it back (the watcher's change gate silently drops a
          // structurally-equal re-publish of the underlying state). So while that
          // promotion is live — the published agent sits at `awaiting_user` over
          // this still-pollable watcher info — publishing this info raw would
          // demote it (e.g. a late `refreshSummary` resolving mid-prompt),
          // flickering the dock and double-bumping recency. Skip that one raw
          // publish and let the poll own the edge: it re-confirms the promotion
          // while the marker is on screen and self-demotes (republishing the raw
          // info) within a tick once the prompt clears, and it republishes on any
          // *structural* divergence, so a held prompt's summary update still lands
          // on the next tick rather than waiting for it to clear.
          const published = publishedAgent();
          const scrape = adapter.screenScrape;
          // Suppress only when a live promotion sits over a still-pollable state
          // AND this host can run the poll that settles it back (`readScreenText`
          // is optional; a screen-less host gets a no-op poll, so it must always
          // publish raw or the tile would freeze at `awaiting_user` forever). When
          // nothing is promoted (`published` isn't `awaiting_user`), every real
          // state transition publishes immediately.
          if (
            scrape &&
            readScreenText &&
            scrape.isPollable(info) &&
            published?.state === "awaiting_user"
          ) {
            return;
          }
          emitAgentValue(agentState, emit, info as unknown as AgentInfo);
        },
        plog,
      ),
      stopPoll: startScreenScrapePoll(),
    };
  }

  /** Tear down the matched session's watcher + screen-scrape poll and forget its
   *  derived info, so a stale read can't leak across a session change. */
  function destroyCurrent() {
    current?.watcher.destroy();
    current?.stopPoll();
    current = null;
    latestInfo = null;
  }

  /** Arm the idle-gated screen-scrape poll, or a no-op when this adapter
   *  doesn't scrape or the host can't read the screen. While `isPollable` holds
   *  for the latest watcher info, read the rendered screen each tick and, if the
   *  scrape promotes it (e.g. `waiting → awaiting_user`), republish the promoted
   *  info. Idempotent: it republishes only when the resolved info differs
   *  structurally from the published agent, so a held prompt with no field
   *  change doesn't churn metadata, while a non-state update (e.g. a summary
   *  refreshing mid-prompt) still lands. It also self-demotes: if the screen
   *  no longer prompts but the published state is still a stale scrape-
   *  promotion, it republishes the raw watcher info, since the watcher's
   *  change gate can silently drop the settling write that would otherwise
   *  demote. Recursive
   *  `setTimeout` (not `setInterval`) so a slow screen read can't overlap. */
  function startScreenScrapePoll(): () => void {
    const scrape = adapter.screenScrape;
    const readScreen = readScreenText;
    if (!scrape || !readScreen) return () => {};
    let pollStopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const info = latestInfo;
        if (!info || !scrape.isPollable(info)) return;
        const text = await readScreen(scrape.tailLines);
        if (pollStopped || latestInfo !== info) return;

        // The desired info is whatever the scrape resolves to: an
        // `awaiting_user`-promotion when the screen prompts, or the raw
        // watcher `info` when it doesn't. Republish on any *structural*
        // divergence from the published agent — not just a state edge. This
        // subsumes the promote (don't churn a held prompt), the self-demote
        // (the watcher's change gate can silently drop the JSONL write that
        // settles a stale promotion back to a structurally-equal `waiting`,
        // so it never demotes on its own), AND non-state updates the watcher
        // carried while the onChange skip path was deferring to this poll:
        // a `refreshSummary`/token update that resolves mid-prompt keeps the
        // held `awaiting_user` state, so a state-only gate would drop it for
        // the whole prompt window — comparing all fields republishes it here.
        const desired = scrape.promote(info, text);
        const published = publishedAgent();
        if (published && !isDeepStrictEqual(published, desired)) {
          emitAgentValue(agentState, emit, desired as unknown as AgentInfo);
        }
      } catch (err) {
        // A NOT_FOUND is the benign teardown race — the PTY vanished between
        // this tick being scheduled and the screen read landing (the local
        // handle / a remote pty-host throws "no PTY with id"). Keep that at
        // debug; anything else is an unexpected failure in the scrape path
        // (a broken read leaves the prompt silently un-promoted), so surface
        // it at error per the project's logging rule.
        if (isNotFoundError(err)) {
          plog.debug({ err }, "screen-scrape poll tick raced teardown");
        } else {
          plog.error({ err }, "screen-scrape poll tick failed");
        }
      } finally {
        // Re-arm from `finally` so the guard-clause early returns above still
        // reschedule the poll.
        if (!pollStopped) timer = setTimeout(tick, SCREEN_SCRAPE_POLL_MS);
      }
    };
    timer = setTimeout(tick, SCREEN_SCRAPE_POLL_MS);
    plog.info(
      { terminal: terminalId },
      "claude-code: screen-scrape poll installed",
    );
    return () => {
      pollStopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      plog.info(
        { terminal: terminalId },
        "claude-code: screen-scrape poll retired",
      );
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

  const cleanupTitle = signals.title.consume({
    onEvent: () => reconcile(),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  const cleanupForeground = signals.foreground.consume({
    onEvent: (fg) => {
      currentForeground = fg;
      reconcile();
    },
    onError: (err) => plog.error({ err }, "foreground subscription failed"),
  });
  const cleanupCwd = signals.cwd.consume({
    onEvent: (cwd) => {
      currentCwd = cwd;
      reconcile();
    },
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });
  const cleanupCommandRun = signals.commandRun.consume({
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
      activations.get(adapter.kind)?.reconcilers.delete(reconcile);
    }
    destroyCurrent();
    plog.debug("stopped");
  };
}

/** The host inputs the memoryless producer needs — the spawn-time identity (pid +
 *  cwd), the four taps, the optional screen reader (#905), and a logger (the lone
 *  coupling injected, not imported, so this package names no host). NO seed, no
 *  store: the producer cannot remember, so a host hands it only what it observes. */
export interface AwarenessEngineInputs {
  /** OS pid of the PTY's shell — constant for the terminal's life, known at spawn.
   *  The agent detectors compare it to the foreground pid to decide "shell idle"
   *  (foreground IS the shell). */
  pid: number;
  /** Spawn-time cwd — read once at start; later cwd changes flow via `signals.cwd`. */
  cwd: string;
  signals: AwarenessSignals;
  readScreenText?: ReadScreenText;
  log: Logger;
}

/** Start the memoryless per-terminal awareness PRODUCER. It emits per-field
 *  `AwarenessObservation`s through `emit`; kolu folds the stream into a
 *  `KoluAwareness`. Returns a stop fn. The engine owns transient working state
 *  (`AgentEngineState` — the agent mirror + recognized basename, shared across the
 *  detectors + the command tracker), re-seeded empty here each start. Sensor order
 *  matters only for the agent-command tracker — it must come first so the
 *  recognized basename is set before the detectors reconcile. */
export function startAwarenessEngine(
  terminalId: TerminalId,
  inputs: AwarenessEngineInputs,
  emit: (o: AwarenessObservation) => void,
): () => void {
  const { pid, cwd, signals, readScreenText, log } = inputs;
  // Transient working state — re-seeded empty each start (a producer is memoryless).
  const agentState: AgentEngineState = { mirror: null, currentAgent: null };

  // Guard the host-supplied `emit` at the FUNNEL. It fans out to every sensor (cwd ·
  // git · pr · agent ×3 · foreground · commandRun), each invoking it from its OWN
  // `consume`/watcher loop. A throw escaping `emit` (e.g. a publish subscriber
  // erroring) would otherwise reach that loop's `for await` and PERMANENTLY end the
  // one sensor's subscription — freezing that field for the terminal's life. Wrapping
  // once here means a bad emit is logged, not fatal, for whichever sensor raised it.
  const guardedEmit = (o: AwarenessObservation): void => {
    try {
      emit(o);
    } catch (err) {
      log.error({ err, terminal: terminalId }, "awareness emit callback threw");
    }
  };

  // Emit each cwd CHANGE as its own observation. The spawn-time `cwd` is already in
  // kolu's seeded fold state, so only deltas need emitting; the git sensor consumes
  // the same channel to re-resolve git (channels fan out to every subscriber).
  const stopCwd = signals.cwd.consume({
    onEvent: (next) => guardedEmit({ kind: "cwd", cwd: next }),
    onError: (err) =>
      log.error(
        { err, terminal: terminalId, channel: "cwd" },
        "cwd subscription failed",
      ),
  });

  const stopAgentCommand = startAgentCommandSensor(
    agentState,
    terminalId,
    signals,
    guardedEmit,
    log,
  );
  // The git→PR pipe is an internal sensor-to-sensor wire, not a host input: the
  // git sensor emits `GitInfo` to it and the PR sensor consumes it to re-resolve
  // the PR. The engine owns it so hosts plug in only the four taps they drive.
  const gitChannel = inMemoryChannel<GitInfo | null>();
  const stopGit = startGitSensor(
    cwd,
    terminalId,
    signals,
    gitChannel,
    guardedEmit,
    log,
  );
  const stopPr = startPrSensor(terminalId, gitChannel, guardedEmit, log);
  const startAgent = <Session, Info extends AgentInfoShape>(
    adapter: AgentAdapter<Session, Info>,
  ) =>
    startAgentSensor(
      adapter,
      agentState,
      pid,
      cwd,
      terminalId,
      signals,
      readScreenText,
      guardedEmit,
      log,
    );
  const stopClaude = startAgent(claudeCodeAdapter);
  const stopCodex = startAgent(codexAdapter);
  const stopOpenCode = startAgent(opencodeAdapter);
  const stopProcess = startForegroundSensor(
    terminalId,
    signals,
    guardedEmit,
    log,
  );
  return () => {
    stopCwd();
    stopAgentCommand();
    stopGit();
    stopPr();
    stopClaude();
    stopCodex();
    stopOpenCode();
    stopProcess();
  };
}
