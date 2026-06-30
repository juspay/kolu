/** Per-terminal sensor set, parameterized over `AwarenessSink` +
 *  `AwarenessSignals` + `AwarenessRecord` so the host is the only thing
 *  that varies. kolu-server's local endpoint instantiates it,
 *  feeding it the pty-host's raw taps over the `ptyHostSurface` contract; a
 *  remote ssh pty-host serves the same taps in #951 R-2 — same sensor set, different
 *  transport.
 *
 *  Sensor set:
 *
 *    cwd:<id>          ─►  git watcher           ─►  PR watcher
 *                                                    (lives on m.pr)
 *    title:<id>        ─►  process observer      (lives on m.foreground)
 *    title/cwd/cmd     ─►  agent detector ×3     (lives on m.agent;
 *                                                 persists m.agentSession)
 *    commandRun:<id>   ─►  agent-command tracker (lives on m.lastAgentCommand)
 *
 *  Metadata writes funnel through `sink.update*Metadata` so the
 *  sensors don't need to know how their host persists state;
 *  activity-feed notifications (`trackRecentRepo` / `trackRecentAgent`)
 *  are optional so non-parent hosts can opt out.
 *
 *  Note on the git→PR pipe: the PR sensor chains off the `GitInfo` the
 *  git sensor publishes. That channel is an internal sensor-to-sensor
 *  wire, NOT a host input — `startAwareness` constructs it itself and
 *  hands it to just those two sensors, so hosts plug in only the four
 *  taps they actually drive.
 *
 *  ## Host contract
 *
 *  `record.meta.cwd` is read once at sensor start (the spawn-time
 *  cwd) and is not re-read afterwards; subsequent cwd changes flow
 *  ONLY through `signals.cwd`. Hosts must publish every cwd change to
 *  that channel — they are NOT required to keep `record.meta.cwd` in
 *  sync, though the agent happens to (its cwd bridge writes through
 *  `sink.updateServerMetadata` so the persisted+published metadata
 *  stays current for clients). Any host that satisfies the
 *  `AwarenessSignals`/`AwarenessSink` shape and publishes cwd to the
 *  channel will get correct agent / git resolution.
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
import type { ForgeAdapter, PrResult } from "anyforge";
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
import { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";
import { agentSessionToPersist } from "./agentSession.ts";
import type {
  AgentInfo,
  AwarenessLiveFields,
  AwarenessPersistedFields,
  AwarenessValue,
  PrUnavailableSource,
  TerminalId,
} from "./schema.ts";

/** Minimal "terminal record" shape the sensor set needs. The host
 *  constructs one per terminal; the sensors only touch `pid` + `meta` +
 *  `currentAgent` from here. `meta` is `AwarenessValue` — the canonical
 *  `AwarenessPersistedFields ∪ AwarenessLiveFields` union (the same write-fence
 *  partition the sink enforces). kolu holds each terminal's `AwarenessValue` in
 *  its single-writer awareness store — a SIBLING of the app-owned authored record
 *  (location + UI fields), not a base that record extends — and passes that value
 *  here directly. */
export interface AwarenessRecord {
  /** OS pid of the PTY's shell — constant for the terminal's life, known at
   *  spawn. The agent detectors compare it to the foreground pid to decide
   *  "shell idle" (foreground IS the shell). No longer a `PtyHandle`: the
   *  live reads (process name + foreground pid) that used to come off the
   *  handle synchronously now arrive over `signals.foreground`, so the sensor set
   *  has zero sync dependency on the PTY host — which is what lets it run on
   *  the far side of a socket from pty-host (R4c) or ssh (R-2). */
  pid: number;
  meta: AwarenessValue;
  /** Ephemeral basename of the agent binary at the foreground right
   *  now; written by the agent-command tracker, read by the agent
   *  detectors. Null when the shell is idle. */
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

/** Host sink — the sensors call its methods to update metadata + emit
 *  side effects. The mutator parameter types are narrowed to the two
 *  halves of the persisted-vs-live partition (the same fence the host
 *  enforces): writing `m.agent` through
 *  `updateServerMetadata` is a compile error, so the
 *  `terminals:dirty` autosave firehose can't be reintroduced by a new
 *  sensor. kolu-server's local endpoint (`makeAwarenessSink`) wires these
 *  straight to its metadata + activity surfaces; the same fence
 *  applies there.
 *
 *  ## Apply-and-publish contract (load-bearing)
 *
 *  `updateServerMetadata` / `updateServerLiveMetadata` MUST apply `mutate`
 *  to `record.meta` **synchronously** before they return — not only publish
 *  the result elsewhere. The sensors read `record.meta` back as their own
 *  prior state: the agent-command tracker dedups on `record.meta.lastAgentCommand`,
 *  `publishAgentField` skips a redundant write via `agentInfoEqual(record.meta.agent, …)`
 *  and decides recency off `record.meta.lastActivityAt`, and the foreground
 *  sensor's own `published` mirror assumes the write landed. A sink that
 *  type-checks but publishes to a collection WITHOUT mutating `record.meta`
 *  (a plausible mistake for an extracted-package consumer like `pulam`) would
 *  silently defeat every one of those dedup/transition gates — repeated
 *  commands re-published, agent state re-emitted each tick, recency
 *  double-bumped. kolu-server's `makeAwarenessSink` satisfies this because its
 *  `updateServer*Metadata` mutate `entry.meta`, which IS `record.meta` (same
 *  object). Honor it: mutate the record, THEN persist/publish the result.
 *
 *  `record` is passed to every method so a host whose update function isn't
 *  already keyed by terminal id (e.g. one with a global publish surface)
 *  can look the record up in its own registry to dispatch the write. A host
 *  whose closure already captures the record (like kolu-server's local
 *  endpoint, which has the entry + id captured in `makeAwarenessSink`'s
 *  per-terminal closure) ignores the argument and prefixes it `_record` at
 *  the call site. */
export interface AwarenessSink {
  updateServerMetadata: (
    record: AwarenessRecord,
    mutate: (meta: AwarenessPersistedFields) => void,
  ) => void;
  updateServerLiveMetadata: (
    record: AwarenessRecord,
    mutate: (meta: AwarenessLiveFields) => void,
  ) => void;
  /** Optional — activity-feed signals into kolu-server's cross-terminal MRUs
   *  (recent-repos / recent-agents); a host with no activity feed omits them. */
  trackRecentRepo?: (root: string, name: string) => void;
  trackRecentAgent?: (cmd: string) => void;
  /** Optional — read the terminal's current rendered screen as VT-resolved
   *  plain text. Provided by hosts that can reach the PTY screen buffer (the
   *  local endpoint, via pty-host's `getScreenText`); omitted by hosts that
   *  can't. Async + host-supplied, so the sensor set keeps its zero *synchronous*
   *  dependency on the PTY host — a remote ssh pty-host serves the same read
   *  over the wire. Drives `AgentAdapter.screenScrape` promotion (Claude's
   *  `AskUserQuestion` / `ExitPlanMode` — #905); without it, screen scrape is
   *  simply inactive.
   *
   *  `tailLines` reads only the last N rendered lines: the screen-scrape
   *  detector inspects just the screen bottom, so the poll asks for exactly
   *  its tail (`screenScrape.tailLines`) rather than the whole buffer — a long
   *  scrollback (the configured 50k lines) isn't allocated, joined, shipped,
   *  and discarded once a second while a session waits. Required, not optional:
   *  the only caller is the screen-scrape poll, which always passes its
   *  detector's `screenScrape.tailLines` (a `number`). Leaving it optional would
   *  let a host map an omitted count to a `tail`-with-no-`lines` request the
   *  pty-host wire schema rejects — an impossible state we forbid in the type. */
  readScreenText?: (tailLines: number) => Promise<string>;
}

// ── Foreground process observer ──────────────────────────────────────

function processBasename(proc: string): string {
  return path.basename(proc);
}

function startForegroundSensor(
  record: AwarenessRecord,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  sink: AwarenessSink,
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
    sink.updateServerLiveMetadata(record, (m) => {
      m.foreground =
        current.name === null
          ? null
          : { name: current.name, title: current.title };
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
  record: AwarenessRecord,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  gitChannel: Channel<GitInfo | null>,
  sink: AwarenessSink,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd: record.meta.cwd }, "started");
  const watcher = subscribeGitInfo(
    record.meta.cwd,
    (git) => {
      if (git) sink.trackRecentRepo?.(git.mainRepoRoot, git.repoName);
      sink.updateServerMetadata(record, (m) => {
        m.git = git;
      });
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

/** The "no adapter for this remote" arm — `detectForge`'s default (see there
 *  for the routing policy). A trivial leaf, not a forge: it hides no volatility,
 *  so it lives here next to the dispatch policy rather than in the anyforge
 *  kernel. */
const unsupportedForgeAdapter = {
  kind: "unsupported" as const,
  resolve: (): Promise<PrResult<PrUnavailableSource>> =>
    Promise.resolve({ kind: "unsupported" }),
} satisfies ForgeAdapter<PrUnavailableSource>;

/** The forges kolu can resolve a PR from, plus the `unsupported` pseudo-forge
 *  every non-`github.com` remote falls through to. A real second forge adds an
 *  arm here plus an entry in `FORGE_ADAPTERS` and a host match in `detectForge`
 *  — nothing else in the watcher path changes.
 *
 *  Each member is an adapter's own `kind` literal (not a hand-written string)
 *  so the registry key and the adapter agree by construction: a phase-1 forge
 *  that adds an adapter must add the matching `FORGE_ADAPTERS` key or the
 *  `Record<ForgeKind, …>` below stops type-checking. */
type ForgeKind =
  | (typeof githubForgeAdapter)["kind"]
  | (typeof unsupportedForgeAdapter)["kind"];

/** Forge adapter per kind. Typed at the closed `PrUnavailableSource` union:
 *  each adapter's concrete source is a member, so a `ForgeAdapter<GhUnavailable…>`
 *  assigns covariantly with no cast, and the dispatcher's result lands in the
 *  metadata `PrResult` directly. */
const FORGE_ADAPTERS: Record<ForgeKind, ForgeAdapter<PrUnavailableSource>> = {
  github: githubForgeAdapter,
  unsupported: unsupportedForgeAdapter,
};

/** Map a repo's `origin` remote URL to the forge that resolves its PRs.
 *  ONLY `github.com` is treated as GitHub — the one host we can be *certain*
 *  `gh` serves. Every other remote (another forge like Codeberg, a self-hosted
 *  Forgejo/Gitea, an unknown host, or no remote at all) routes to `unsupported`
 *  and never reaches `gh`: a non-GitHub remote can't have a GitHub PR, so asking
 *  `gh` only produces error-level log noise and a scary popover (juspay/kolu#1627).
 *
 *  We deliberately do NOT guess that an arbitrary clone URL is GitHub — claiming
 *  a host is GitHub when we can't know it is the dishonest direction, and `gh`'s
 *  own refusal is unversioned, brittle stderr we'd rather not lean on. The cost,
 *  accepted here: a **GitHub Enterprise** remote (an arbitrary corporate host
 *  `gh` may be authenticated for) no longer gets its PR pill — GHE is out of
 *  scope, to be reopened by per-host config / the real adapter work (the anyforge
 *  plan, #1240). Detection is by host, sync and pure — no network probe. A real
 *  forge adapter adds its own `case` arm pointing at its kind. */
export function detectForge(remoteUrl: string | null): ForgeKind {
  switch (parseRemoteHost(remoteUrl)) {
    case "github.com":
      return "github";
    default:
      return "unsupported";
  }
}

/** A `ForgeAdapter` that routes each resolve through `detectForge` (see there
 *  for the routing policy). Keeps `subscribePr`'s one-adapter contract intact
 *  while supporting per-resolve forge selection: the remote can change
 *  mid-session (`git remote set-url`), and consulting the registry on every
 *  resolve re-routes without tearing the watcher down — so editing a remote
 *  from `github.com` to a Codeberg URL flips the same terminal to a different
 *  adapter on the next poll, no rebuild. */
export const dispatchingForgeAdapter: ForgeAdapter<PrUnavailableSource> = {
  kind: "forge-dispatch",
  resolve: (git, log) =>
    FORGE_ADAPTERS[detectForge(git.remoteUrl)].resolve(git, log),
};

function startPrSensor(
  record: AwarenessRecord,
  terminalId: TerminalId,
  gitChannel: Channel<GitInfo | null>,
  sink: AwarenessSink,
  log: Logger,
): () => void {
  const plog = log.child({ provider: "pr", terminal: terminalId });
  plog.debug("started");
  // The dispatcher routes each resolve to the forge picked from the remote;
  // with one forge today that's always the gh adapter.
  const watcher = subscribePr(
    dispatchingForgeAdapter,
    (pr) => {
      sink.updateServerLiveMetadata(record, (m) => {
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
  record: AwarenessRecord,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  sink: AwarenessSink,
  log: Logger,
): () => void {
  return signals.commandRun.consume({
    onEvent: ({ command: raw, replayed }) => {
      const normalized = parseAgentCommand(raw);
      record.currentAgent = normalized
        ? agentNameFromCommand(normalized)
        : null;
      if (normalized) {
        if (record.meta.lastAgentCommand !== normalized) {
          sink.updateServerMetadata(record, (m) => {
            m.lastAgentCommand = normalized;
          });
        }
        // Recent-agent recency stamps `Date.now()` — a LIVE-only effect. A
        // replayed snapshot (a late/restarted sensor catching up) must seed
        // detection above WITHOUT re-bumping the MRU as if the command just
        // ran, or a reconnect would reorder recent-agents spuriously.
        if (!replayed) sink.trackRecentAgent?.(normalized);
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

function publishAgentField(
  record: AwarenessRecord,
  sink: AwarenessSink,
  nextAgent: AgentInfo | null,
): void {
  // Publish-if-changed: the canonical AgentInfo comparator is the one gate for
  // "did the published state already reflect this?", so every publisher —
  // watcher and screen-scrape poll alike — funnels through one equality check.
  if (agentInfoEqual(record.meta.agent, nextAgent)) return;
  const bump = shouldBumpRecencyForAgentChange(
    record.meta.agent,
    nextAgent,
    record.meta.lastActivityAt,
  );
  // The EXACT conversation ref to persist for wake/restore resume — non-null only
  // when the conversation identity (kind+sessionId) is genuinely new, so a same-
  // session state/summary tick on the agent firehose never re-arms autosave here
  // (juspay/kolu#1495). Captured BEFORE the live write so it reads the prior ref.
  const nextSession = agentSessionToPersist(
    record.meta.agentSession,
    nextAgent,
  );
  sink.updateServerLiveMetadata(record, (m) => {
    m.agent = nextAgent;
  });
  if (bump) {
    sink.updateServerMetadata(record, (m) => {
      m.lastActivityAt = Date.now();
    });
  }
  if (nextSession) {
    sink.updateServerMetadata(record, (m) => {
      m.agentSession = nextSession;
    });
  }
}

function startAgentSensor<Session, Info extends AgentInfoShape>(
  adapter: AgentAdapter<Session, Info>,
  record: AwarenessRecord,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  sink: AwarenessSink,
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
  // The published agent metadata, but only when it's this adapter's own —
  // i.e. the `published?.kind === adapter.kind` narrowing, defined once and
  // shared by both writers that ask "has the published state diverged from
  // this candidate?": the watcher callback (to *skip* the raw publish the
  // poll owns) and the poll tick (to *do* the republish). Returns null when
  // nothing is published yet, or when a different adapter owns the tile, so
  // a caller can read the divergence test declaratively off the result.
  const publishedAgent = (): AgentInfo | null => {
    const published = record.meta.agent;
    return published?.kind === adapter.kind ? published : null;
  };
  let registeredForExternal = false;
  let stopped = false;
  let commandRunTimers: ReturnType<typeof setTimeout>[] = [];
  // CWD source-of-truth for this adapter's lifetime: seeded once from
  // `record.meta.cwd` (the spawn-time cwd a host writes before calling
  // `startAwareness`) and updated only via the `cwd` channel. Reading
  // `record.meta.cwd` inside `reconcile()` would make agent detection
  // depend on the host mutating `record.meta` synchronously before each
  // channel publish — a hidden contract the agent happens to honor (its
  // cwd bridge writes `record.meta.cwd` then publishes `signals.cwd`) but
  // a future host on the same `AwarenessSignals`/`AwarenessSink` shape
  // could not be expected to know about.
  let currentCwd = record.meta.cwd;
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
      record.pid,
      currentCwd,
      record.currentAgent,
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
      if (record.meta.agent?.kind === adapter.kind) {
        publishAgentField(record, sink, null);
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
            sink.readScreenText &&
            scrape.isPollable(info) &&
            published?.state === "awaiting_user"
          ) {
            return;
          }
          publishAgentField(record, sink, info as unknown as AgentInfo);
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
    const readScreen = sink.readScreenText;
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
          publishAgentField(record, sink, desired as unknown as AgentInfo);
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

/** Start every per-terminal sensor for one terminal. A host calls this with
 *  its signals + sink + a logger (the lone coupling injected, not imported,
 *  so this package names no host). Sensor order matters only for the
 *  agent-command tracker — it must come first so its stash is populated before
 *  agent detectors reconcile. */
export function startAwareness(
  record: AwarenessRecord,
  terminalId: TerminalId,
  signals: AwarenessSignals,
  sink: AwarenessSink,
  log: Logger,
): () => void {
  const stopAgentCommand = startAgentCommandSensor(
    record,
    terminalId,
    signals,
    sink,
    log,
  );
  // The git→PR pipe is an internal sensor-to-sensor wire, not a host input: the
  // git sensor publishes `GitInfo` to it and the PR sensor consumes it to
  // re-resolve the PR. `startAwareness` owns it so hosts plug in only the four
  // taps they actually drive (`AwarenessSignals`).
  const gitChannel = inMemoryChannel<GitInfo | null>();
  const stopGit = startGitSensor(
    record,
    terminalId,
    signals,
    gitChannel,
    sink,
    log,
  );
  const stopPr = startPrSensor(record, terminalId, gitChannel, sink, log);
  const stopClaude = startAgentSensor(
    claudeCodeAdapter,
    record,
    terminalId,
    signals,
    sink,
    log,
  );
  const stopCodex = startAgentSensor(
    codexAdapter,
    record,
    terminalId,
    signals,
    sink,
    log,
  );
  const stopOpenCode = startAgentSensor(
    opencodeAdapter,
    record,
    terminalId,
    signals,
    sink,
    log,
  );
  const stopProcess = startForegroundSensor(
    record,
    terminalId,
    signals,
    sink,
    log,
  );
  return () => {
    stopAgentCommand();
    stopGit();
    stopPr();
    stopClaude();
    stopCodex();
    stopOpenCode();
    stopProcess();
  };
}
