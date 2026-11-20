import { AgentIdentitySchema, RestoreTargetSchema } from "anyagent/schemas";
import { PrInfoSchema } from "anyforge/schemas";
import { Effect, Schema } from "effect";
import {
  AgentInfoSchema,
  AgentKindSchema,
  resumableCommand,
} from "kolu-agents/vocab";
import { type GitInfo, GitInfoSchema } from "kolu-git/schemas";
import { GhUnavailableSchema, reasonForGhCode } from "kolu-github/schemas";
import { match, P } from "ts-pattern";

export {
  isTerminalId,
  type TerminalId,
  TerminalIdSchema,
} from "./terminalId.ts";

/** The CLIENT's visible scrollback, in lines — what the browser xterm retains,
 *  what `exportScrollbackAsPdf.ts` serializes, and the ceiling the
 *  scrollback-backfill prepend must never exceed. */
export const DEFAULT_SCROLLBACK = 50_000;

export {
  AgentIdentitySchema,
  AgentInfoSchema,
  AgentKindSchema,
  RestoreTargetSchema,
  resumableCommand,
};

/** The closed `PrUnavailableSource` union — one arm per forge adapter.
 *  Discriminated on `provider` so render sites can `match(...).exhaustive()`
 *  and a new forge is a compile error at every dispatch. */
export const PrUnavailableSourceSchema = Schema.Union([GhUnavailableSchema]);
export type PrUnavailableSource = typeof PrUnavailableSourceSchema.Type;

/** The wire `PrResult` — anyforge's generic `PrResult<S>` pinned to the closed
 *  `PrUnavailableSource` union. */
export const PrResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pending") }),
  Schema.Struct({ kind: Schema.Literal("ok"), value: PrInfoSchema }),
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({ kind: Schema.Literal("unsupported") }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    source: PrUnavailableSourceSchema,
  }),
]);
export type PrResult = typeof PrResultSchema.Type;

/** Display reason for a closed-union failure source — exhaustive over every
 *  forge arm. Dispatches the gh arm to kolu-github's `reasonForGhCode`. */
export function reasonForSource(source: PrUnavailableSource): string {
  return match(source)
    .with({ provider: "gh" }, ({ code }) => reasonForGhCode(code))
    .exhaustive();
}

/** The display reason when a PR is `unavailable`, else null. */
export function prUnavailableReason(pr: PrResult): string | null {
  return pr.kind === "unavailable" ? reasonForSource(pr.source) : null;
}

/** The tagged failure source when a PR is `unavailable`, else null. */
export function prUnavailableSource(pr: PrResult): PrUnavailableSource | null {
  return pr.kind === "unavailable" ? pr.source : null;
}

/** Foreground process info from PTY. */
export const ForegroundSchema = Schema.Struct({
  /** Binary name (e.g. "vim", "claude", "opencode"). */
  name: Schema.String,
  /** Raw terminal title from OSC 0/2 (e.g. "user@host: ~/code", "vim file.ts"). */
  title: Schema.NullOr(Schema.String),
  /** Whether the foreground IS the terminal's shell — an idle prompt, nothing
   *  running in front of it. padi's own answer (`isShellIdle`, the one place
   *  "foreground === root" is decided), not a guess from `name`: the shell is
   *  the user's login shell, whatever it is called, and a command-rooted
   *  terminal has no shell at all (always `false`). It compares pids, so a
   *  shell that `exec`s a program (`exec vim`) still reads `true`: the pid in
   *  front is the shell's own. The agent detectors share that limit. */
  shell: Schema.Boolean,
});

export {
  foldBinds,
  foldPorts,
  type PortFamily,
  PortFamilySchema,
  type PortInfo,
  PortInfoSchema,
  type PortBind,
  type PortScope,
  PortScopeSchema,
  preferredFamily,
  samePortList,
  TcpPortSchema,
  widerScope,
} from "./ports.ts";

import {
  type PortBind,
  PortBindSchema,
  type PortInfo,
  PortInfoSchema,
  type PortScope,
  samePortList,
  widerScope,
} from "./ports.ts";

/** What a terminal is serving, as an HONEST two-way — not a bare `PortInfo[]` that
 *  conflates "nothing is listening" with "we could not look".
 *
 *   - `{ status: "known", list }` — a scan succeeded. `list` may be EMPTY, and that
 *     is a real answer: this terminal serves nothing.
 *   - `{ status: "unknown" }` — no scan has ever succeeded for this terminal. A
 *     freshly spawned one before its first pass, and a terminal whose first pass was
 *     BLIND. */
export const TerminalPortsSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("known"),
    list: Schema.Array(PortInfoSchema),
  }),
  Schema.Struct({ status: Schema.Literal("unknown") }),
]);
export type TerminalPorts = typeof TerminalPortsSchema.Type;

/** The ports a reader can actually name — `[]` when the terminal has never been
 *  successfully scanned. The ONE place "unknown reads as no ports" is spelled. */
export function knownPorts(ports: TerminalPorts): readonly PortInfo[] {
  return ports.status === "known" ? ports.list : [];
}

/** Whether a port answers from the VIEWER as-is, and — when it does not — WHICH
 *  mechanism would make it answer. The indivisible decision behind a port chip,
 *  as a tag rather than a sentence. */
export type PortReach =
  | { kind: "direct" }
  | { kind: "needs-forward"; via: "loopback" | "remote-host" }
  /** Bound to ONE specific non-loopback address — on EITHER host. No door kolu
   *  can open reaches it: both forward mechanisms connect to `127.0.0.1` on the
   *  far side, where nothing is listening, so offering a forward produces a
   *  listener that comes up and then refuses every connection through it. */
  | { kind: "no-mechanism"; via: "interface-bind" };

/** The ONE openability decision, for both ends of the wire — the join of a bind
 *  OBSERVATION (which the scanner makes, knowing nothing about kolu) with WHOSE
 *  HOST that bind is on (which only kolu knows). The four arms:
 *
 *   - `interface`, on EITHER host → nothing to dial and nothing to link. Both
 *     mechanisms reach a loopback, which that listener is not on; and the bind is
 *     on ONE address, which the observation deliberately does not record, so a
 *     link built from the viewer's address bar is a guess.
 *   - not on the kolu host, `any` or `loopback` → `ssh -L` to the far side's
 *     `127.0.0.1`, where both of those binds answer.
 *   - on the kolu host, `loopback` → the in-process relay, which dials
 *     `127.0.0.1` here.
 *   - on the kolu host, `any` → no door at all: the listener answers on EVERY
 *     interface of the very host whose name is in the viewer's address bar.
 */
export function portReach(opts: {
  scope: PortScope;
  onKoluHost: boolean;
}): PortReach {
  return match(opts.scope)
    .with(
      "interface",
      () => ({ kind: "no-mechanism", via: "interface-bind" }) as const,
    )
    .with(P.union("any", "loopback"), (scope) => {
      if (!opts.onKoluHost) {
        return { kind: "needs-forward", via: "remote-host" } as const;
      }
      return scope === "loopback"
        ? ({ kind: "needs-forward", via: "loopback" } as const)
        : ({ kind: "direct" } as const);
    })
    .exhaustive();
}

/** Are two port SAMPLES the same fact? The dedup gate the sensor applies before a
 *  sample reaches the snapshot: an unchanged scan must emit nothing, or a
 *  seconds-cadence ticker would publish a fresh array — and a fresh reference
 *  through the whole reactive chain — on every pass forever. */
export function portsEqual(a: TerminalPorts, b: TerminalPorts): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== "known" || b.status !== "known") return true;
  return samePortList(a.list, b.list);
}

/** The unclaimed half of a host reading, as its own honest two-way. `unknown`
 *  is a real state on darwin: macOS 27 gates the host-wide socket table, so the
 *  sockets nobody claims are exactly the ones that go missing while every
 *  claimed listener survives. Folding that into `known: []` would say "no other
 *  user's server is on this port" when the truth is "we could not see". */
export const UnclaimedPortsSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("known"),
    list: Schema.Array(PortBindSchema),
  }),
  Schema.Struct({ status: Schema.Literal("unknown") }),
]);
export type UnclaimedPorts = typeof UnclaimedPortsSchema.Type;

/** A listener a readable program holds on the host, and whether a TERMINAL's
 *  process subtree holds it. The scanner knows the second from the same pass
 *  that found the listener, so "detached" — held by no terminal — is a fact on
 *  the row, never re-derived by joining this reading against every terminal's
 *  separately delivered `ports` (where one unscanned or unreadable terminal
 *  would make it unanswerable for the whole host). */
export const HostPortSchema = Schema.Struct({
  ...PortInfoSchema.fields,
  heldByTerminal: Schema.Boolean,
});
export type HostPort = typeof HostPortSchema.Type;

/** Every TCP listener on a host, as its scanner saw it.
 *
 *   - `claimed` — sockets a readable (same-user) process holds, with the program
 *     and command line holding each, and whether any terminal's subtree holds it
 *     (a detached daemon: no).
 *   - `unclaimed` — sockets the OS showed with no readable owner.
 *   - `{ status: "unknown" }` — no pass has succeeded yet: padi has never run a
 *     terminal (its sampler arms on the first one), or the first pass has not
 *     landed. Once armed, the sampler keeps reading the host after the last
 *     terminal closes, so a detached server's door is still reaped when it dies. */
export const HostListenersSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("known"),
    claimed: Schema.Array(HostPortSchema),
    unclaimed: UnclaimedPortsSchema,
  }),
  Schema.Struct({ status: Schema.Literal("unknown") }),
]);
export type HostListeners = typeof HostListenersSchema.Type;

/** The value before any reading has landed. */
export const UNKNOWN_HOST_LISTENERS: HostListeners = { status: "unknown" };

/** Are two host readings the same fact? The wire dedup gate for the cell that
 *  carries them — same contract as {@link portsEqual}: a status flip (on either
 *  level) is always a change, and an unchanged host publishes nothing. */
export const hostListenersEqual: (
  a: HostListeners,
  b: HostListeners,
) => boolean = Schema.toEquivalence(HostListenersSchema);

/** What a host reading says about ONE port — the four answers a reader acts on,
 *  and the ONE place they are derived, so the printed-URL card and the Ports
 *  section cannot disagree about when "nothing is listening" may be said.
 *
 *   - `claimed`   — a readable program holds it.
 *   - `unclaimed` — something holds it; its owner is not visible.
 *
 *  When BOTH halves hold the port, the answer is the bind a reader can act on —
 *  the same scope-first rule `foldBinds` gives the reaper: the unclaimed bind
 *  wins only when its scope is strictly more useful (another user's `127.0.0.1`
 *  beside our interface-only bind is the one a door can dial). Its owner stays
 *  "not visible"; it never borrows the claimed listener's command.
 *   - `absent`    — positively not listening anywhere on this host.
 *   - `unknown`   — cannot say: the host is not scanned, or the port is not
 *     claimed and the unclaimed half is blind (it may be another user's). */
export type ListenerAt =
  | { kind: "claimed"; info: HostPort }
  | { kind: "unclaimed"; bind: PortBind }
  | { kind: "absent" }
  | { kind: "unknown" };

export function listenerAt(host: HostListeners, port: number): ListenerAt {
  if (host.status !== "known") return { kind: "unknown" };
  const info = host.claimed.find((p) => p.port === port);
  const bind =
    host.unclaimed.status === "known"
      ? host.unclaimed.list.find((p) => p.port === port)
      : undefined;
  if (info !== undefined) {
    const unclaimedWins =
      bind !== undefined &&
      bind.scope !== info.scope &&
      widerScope(info.scope, bind.scope) === bind.scope;
    return unclaimedWins
      ? { kind: "unclaimed", bind }
      : { kind: "claimed", info };
  }
  if (host.unclaimed.status !== "known") return { kind: "unknown" };
  return bind === undefined ? { kind: "absent" } : { kind: "unclaimed", bind };
}

/** A terminal's git context as THREE cases, not a `GitInfo | null` that
 *  conflates "not a repo" with "not checked yet" — the same move `pr`
 *  (`kind: "pending"`) and `ports` (`status: "unknown"`) make:
 *
 *   - `{ kind: "unresolved" }` — the git sensor has not answered for this
 *     terminal yet (a fresh spawn, a restored record). Says nothing about the cwd.
 *   - `{ kind: "none" }` — the sensor answered: the cwd is not in a git repo.
 *   - `{ kind: "repo", info }` — the sensor answered with the repo. */
export const GitFactSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unresolved") }),
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("repo"), info: GitInfoSchema }),
]);
export type GitFact = typeof GitFactSchema.Type;

/** The git sensor's answer as a fact: `null` (resolved, not a repo) is `none`. */
export function gitFactOf(info: GitInfo | null): GitFact {
  return info === null ? { kind: "none" } : { kind: "repo", info };
}

/** A pty grid — cols × rows, both positive. ONE composite, never two optional
 *  scalars: half a grid is not a size. */
export const TerminalGridSchema = Schema.Struct({
  cols: Schema.Int.check(Schema.isGreaterThan(0)),
  rows: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type TerminalGrid = typeof TerminalGridSchema.Type;

/** Do two grids describe the same layout? */
export function gridsEqual(a: TerminalGrid, b: TerminalGrid): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

/** What a host PRODUCER emits — exactly the fields it can RE-SAMPLE. Local or
 *  remote, the SAME type. Served as-is on kolu's `terminalWorkspace.snapshots`
 *  collection (kolu JOINS it with a separate authored record at the client).
 *  `pr` and `agent` ride here too — both re-samplable; `pr` is restore-relevant
 *  (true-when-dead, persisted like `git`), the live `agent` detail is RAM-only
 *  (lie-when-dead, re-derived on (re)spawn). */
export const TerminalSnapshotSchema = Schema.Struct({
  cwd: Schema.String,
  /** The git context — see {@link GitFactSchema}. */
  git: GitFactSchema,
  /** Forge PR resolution — discriminated union (see PrResultSchema). */
  pr: PrResultSchema,
  /** The LIVE agent right now, or null when the user is at the shell. */
  agent: Schema.NullOr(AgentInfoSchema),
  /** The live foreground process (vim, …) — detected via OSC 2 title events. */
  foreground: Schema.NullOr(ForegroundSchema),
  /** What this terminal is serving — see {@link TerminalPortsSchema}. */
  ports: TerminalPortsSchema,
  /** The pty's CURRENT grid — cols × rows.
   *
   *  Optional: a padi predating it omits the key, and a consumer that never sees
   *  one behaves exactly as it did before. */
  grid: Schema.optionalKey(TerminalGridSchema),
});
export type TerminalSnapshot = typeof TerminalSnapshotSchema.Type;

/** The agent IDENTITY kolu persists for restore (`kind` + native session
 *  `sessionId`) and the discriminated RESTORE TARGET the fold derives from it. */
export type AgentIdentity = typeof AgentIdentitySchema.Type;
export type RestoreTarget = typeof RestoreTargetSchema.Type;

const NeverObservedOrEpochSchema = Schema.NullOr(Schema.Number).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null)),
);

/** The facts a host CANNOT observe — recency and the first live turn are CLOCK
 *  readings. Irrecoverable from a screen, so kolu remembers them; written by
 *  kolu's fold ALONE (a producer's `TerminalSnapshot` cannot spell any of them).
 *  Kept FLAT on kolu's authored record (`updateMemory` is the one narrowed
 *  writer), so the on-disk JSON path for each is a top-level key. */
export const AgentMemorySchema = Schema.Struct({
  /** Workspace-switcher recency: epoch-millis of the last LIVE agent
   *  observation, on kolu's clock. `null` is a real absence (never active), not
   *  an in-band `0`. A required key — never absent. */
  lastActivityAt: NeverObservedOrEpochSchema,
  /** When the CURRENT agent (its identity: kind + session id) first went LIVE —
   *  working or blocked on you (`agentLive`, in `agentProjection`) — on kolu's
   *  clock. `null` while no agent runs, and while a freshly started agent still
   *  sits at its first prompt (`waiting`). Stamped once per agent identity; a
   *  new identity resets it. */
  promptedAt: NeverObservedOrEpochSchema,
});
export type AgentMemory = typeof AgentMemorySchema.Type;

/** kolu's stored value: the last-seen `TerminalSnapshot`, the remembered facts,
 *  and the derived resume target. The fold accumulator; never crosses a wire
 *  (kolu folds in-process). */
export type TerminalState = {
  snapshot: TerminalSnapshot;
  memory: AgentMemory;
  /** What a wake would do with this terminal — re-derived by the fold on every
   *  authoritative agent observation, and seeded from the durable authored
   *  target on adopt/wake. `none` is a bare shell. */
  restoreTarget: RestoreTarget;
};

/** The async resolution of the agent field made LAWFUL. `"unknown"` means the
 *  producer cannot currently KNOW, so kolu KEEPS its last value, no clobber.
 *  `{ value }` is authoritative (kolu APPLIES it, even when `null` — a
 *  SHELL-IDLE null is the session genuinely ended). Never stored — only the
 *  resolved value is. */
export type Known<T> = "unknown" | { value: T };

/** One authoritative answer to "which agent runs here, and with what flags?" —
 *  the info the adapter resolved and the LIVE process's allowlisted argv tokens,
 *  as ONE value. */
export type AgentObservation = {
  info: AgentInfo;
  /** `stableFlags`-filtered argv tokens (never the raw process argv). */
  argv: readonly string[];
};

/** A per-field sample a memoryless producer emits. The standing six build the
 *  `TerminalSnapshot`; an `agent` observation carries the whole
 *  {@link AgentObservation} (info + allowlisted argv — STRUCTURED facts read from
 *  the OS, never text from the PTY). */
export type TerminalEvent =
  | { kind: "cwd"; cwd: string }
  | { kind: "git"; git: GitFact }
  | { kind: "pr"; pr: PrResult }
  | { kind: "foreground"; foreground: Foreground | null }
  | { kind: "agent"; agent: Known<AgentObservation | null> }
  | { kind: "ports"; ports: TerminalPorts }
  | { kind: "grid"; grid: TerminalGrid };

/** A fresh terminal's initial `TerminalSnapshot`: spawn-time cwd, everything else at
 *  its "not yet resolved" seed (git unresolved, PR pending, no agent, no foreground, no
 *  ports). The fold fills it in from now. The ONE home for the snapshot-default set. */
export function seedSnapshot(cwd: string): TerminalSnapshot {
  return {
    cwd,
    git: { kind: "unresolved" },
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}

/** A fresh terminal's empty memory — no recency yet (honest `null`: a fresh
 *  terminal has never had an agent transition). */
export function seedMemory(): AgentMemory {
  return { lastActivityAt: null, promptedAt: null };
}

/** A single process's resident-set size as an HONEST three-way state, not a
 *  `number | null` that conflates "no process to measure" with "the read failed".
 *
 *   - `{ status: "ok", rssBytes }` — a live process answered.
 *   - `{ status: "absent" }` — there is no process to measure (down / not-yet-
 *     sampled). The expected "no value", not an error.
 *   - `{ status: "error" }` — the process was BELIEVED up yet its RSS read threw.
 *     A real anomaly the rail must surface distinctly from `absent`. */
export const ProcessRssSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ok"), rssBytes: Schema.Number }),
  Schema.Struct({ status: Schema.Literal("absent") }),
  Schema.Struct({ status: Schema.Literal("error") }),
]);
export type ProcessRss = typeof ProcessRssSchema.Type;

/** Output quiet-period before a terminal reads as static again — the ONE cadence
 *  the "is this terminal moving bytes right now" signal breathes at on BOTH sides:
 *  padi's `activity` stream (the padi-tui `●`) and the client's
 *  `useAttentionFacts` mirror (the browser green dot). It is a RAW byte-motion signal
 *  with a ~1s trailing window — a stream with sub-second gaps (compiles, `tail -f`)
 *  stays lit, one that pauses longer blinks off then back on when it resumes (so an
 *  agent that pauses >1s between thinking and emitting tokens flickers, by design). */
export const TERMINAL_IDLE_AFTER_MS = 1000;

export type AgentKind = typeof AgentKindSchema.Type;
export type AgentInfo = typeof AgentInfoSchema.Type;
export type {
  ClaudeCodeInfo,
  CodexInfo,
  GrokInfo,
  OmpInfo,
  OpenCodeInfo,
  PiInfo,
} from "kolu-agents/vocab";
export type Foreground = typeof ForegroundSchema.Type;

/** A repo/file change PULSE, not data. kolu-git's `subscribeRepoChange` /
 *  `subscribeFileChange` collapse a burst of fs events into a payload-free
 *  `onChange()`, so a watcher stream's frame must DIFFER each tick or the
 *  stream's `isEqual` dedup would collapse two consecutive changes into one.
 *  The monotonic `seq` (per subscription, starting at 0 for the snapshot frame)
 *  is that distinguisher. A consumer reacts to a new pulse by re-querying the
 *  `fs.*` / `git.*` procedures — the pulse carries no fs/git data itself. */
export const RepoChangePulseSchema = Schema.Struct({
  seq: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type RepoChangePulse = typeof RepoChangePulseSchema.Type;

/** Input for the per-file fs procedures (`readFile`, `filePreviewTag`) and the
 *  `subscribeFileChange` watcher. */
export const FsFileInputSchema = Schema.Struct({
  repoPath: Schema.String,
  filePath: Schema.String,
});

/** Output of `fs.readFile` — the raw text read. */
export const FsReadFileTextOutputSchema = Schema.Struct({
  content: Schema.String,
  truncated: Schema.Boolean,
});
