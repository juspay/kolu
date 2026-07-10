/**
 * The terminal-snapshot vocabulary — the value a host PRODUCER emits and the
 * value kolu's fold accumulates, owned where it is PRODUCED (the sensor set in
 * this package) rather than by any app.
 *
 * The de-entanglement (awareness-derive-store.mdx) splits SAMPLING from
 * REMEMBERING:
 *   - `TerminalSnapshot` is exactly the five fields a memoryless host can RE-SAMPLE:
 *     cwd · git context · forge PR · live agent · foreground process. Composed
 *     from the vendor-neutral leaf schemas (anyforge · kolu-git · kolu-github ·
 *     the per-agent packages) and naming NOTHING app-specific — no `location`
 *     discriminator, no client/UI fields. It is what kolu serves UNCHANGED on its
 *     `terminalWorkspace.snapshots` collection.
 *   - `AgentMemory` is the two facts a host CANNOT re-sample — a clock reading
 *     (`lastActivityAt`) and the launch line the user typed (`lastAgentCommand`).
 *     kolu remembers them; a producer's `TerminalSnapshot` cannot spell either.
 *   - `TerminalState = { snapshot, memory }` is kolu's fold accumulator, never on
 *     a wire (kolu folds in-process). `TerminalEvent` is the per-field EMIT
 *     type a producer streams.
 *
 * The old persisted-vs-live write fence (and its `AwarenessSink` mutator split) is
 * GONE: the producer is memoryless and the emit type forbids a memory field, so no
 * snapshot can clobber a remembered fact — the fence is the TYPE, not a runtime
 * mutator. kolu recomposes its full `TerminalMetadata` at the CLIENT by JOINING
 * the served `TerminalSnapshot` with a SEPARATE authored record (the app-owned
 * `location` + memory + client-persisted UI fields). That separation is what lets
 * `pulam` (the standalone daemon) and `pulam-tui` (the viewer) reuse the sensors
 * with zero dependency on any kolu-app package.
 */

import {
  AgentIdentitySchema,
  AgentKindSchema,
  RestoreTargetSchema,
  resumableCommand,
} from "anyagent/schemas";
import { PrInfoSchema } from "anyforge/schemas";
import { ClaudeCodeInfoSchema } from "kolu-claude-code/schemas";
import { CodexInfoSchema } from "kolu-codex/schemas";
import { type GitInfo, GitInfoSchema } from "kolu-git/schemas";
import { GhUnavailableSchema, reasonForGhCode } from "kolu-github/schemas";
import { GrokInfoSchema } from "kolu-grok/schemas";
import { OpenCodeInfoSchema } from "kolu-opencode/schemas";
import { match } from "ts-pattern";
import { z } from "zod";

// ── Terminal identity ─────────────────────────────────────────────────

export const TerminalIdSchema = z.string().uuid();
export type TerminalId = z.infer<typeof TerminalIdSchema>;

// ── Agent status ──────────────────────────────────────────────────────

// `AgentKindSchema` + the resume vocabulary (`AgentIdentitySchema`,
// `RestoreTargetSchema`, and the `resumableCommand` projection) are OWNED by
// anyagent/schemas (the lower layer that owns the `AgentKind` vocabulary and the
// `resumeAgentCommand`/`resumeFormFor` receptacles consuming them). Re-exported
// here so the wake/restore path and kolu-common/surface keep resolving them from
// this schema home — one declaration, validated once.
export {
  AgentIdentitySchema,
  AgentKindSchema,
  RestoreTargetSchema,
  resumableCommand,
};

export const AgentInfoSchema = z.discriminatedUnion("kind", [
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
  OpenCodeInfoSchema,
  GrokInfoSchema,
]);

// ── PR resolution — closed forge union + wire result ──────────────────
//
// anyforge owns the forge-neutral, generic shapes (`PrUnavailableSourceBase`,
// `PrResult<S>`); each forge adapter owns its own arm (`GhUnavailableSchema`
// in kolu-github). The CLOSED, exhaustively-matchable union over those arms —
// and the zod wire schema pinned to it — composes here, exactly as
// `AgentInfoSchema` composes the per-agent `*InfoSchema`s above. A new forge's
// arm joins this union; the anyforge leaf never changes.

/** The closed `PrUnavailableSource` union — one arm per forge adapter.
 *  Discriminated on `provider` so render sites can `match(...).exhaustive()`
 *  and a new forge is a compile error at every dispatch. */
export const PrUnavailableSourceSchema = z.discriminatedUnion("provider", [
  GhUnavailableSchema,
]);
export type PrUnavailableSource = z.infer<typeof PrUnavailableSourceSchema>;

/** The wire `PrResult` — anyforge's generic `PrResult<S>` pinned to the closed
 *  `PrUnavailableSource` union. Lives here (not in the leaf) for the same
 *  reason `AgentInfoSchema` does: the leaf names no forge. */
export const PrResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("ok"), value: PrInfoSchema }),
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("unsupported") }),
  z.object({
    kind: z.literal("unavailable"),
    source: PrUnavailableSourceSchema,
  }),
]);
export type PrResult = z.infer<typeof PrResultSchema>;

/** Display reason for a closed-union failure source — exhaustive over every
 *  forge arm. Dispatches the gh arm to kolu-github's `reasonForGhCode`. A new
 *  forge arm is a compile error here until it adds its
 *  `.with({ provider: "…" }, …)` branch. */
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

// ── Foreground process ────────────────────────────────────────────────

/** Foreground process info from PTY. */
export const ForegroundSchema = z.object({
  /** Binary name (e.g. "vim", "claude", "opencode"). */
  name: z.string(),
  /** Raw terminal title from OSC 0/2 (e.g. "user@host: ~/code", "vim file.ts"). */
  title: z.string().nullable(),
});

// ── The TerminalSnapshot — what a host PRODUCER emits ──────────────────────
//
// The de-entanglement (awareness-derive-store.mdx): a host PRODUCER emits one
// `TerminalSnapshot` — exactly the five fields it can RE-SAMPLE — and nothing it
// cannot. The two facts a host genuinely cannot re-sample (a clock reading and
// the launch invocation) are `AgentMemory`, written by kolu's fold ALONE. The
// old persisted/live write-fence is gone: the producer is memoryless and cannot
// CONSTRUCT memory (the type forbids it), so no snapshot can clobber a
// remembered fact — the fence is the EMIT TYPE, not a runtime mutator split.

/** What a host PRODUCER emits — exactly the fields it can RE-SAMPLE. Local or
 *  remote, the SAME type. Served as-is on kolu's `terminalWorkspace.snapshots`
 *  collection (kolu JOINS it with a separate authored record at the client).
 *  `pr` and `agent` ride here too — both re-samplable; `pr` is restore-relevant
 *  (true-when-dead, persisted like `git`), the live `agent` detail is RAM-only
 *  (lie-when-dead, re-derived on (re)spawn). */
export const TerminalSnapshotSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  /** Forge PR resolution — discriminated union (see PrResultSchema). */
  pr: PrResultSchema,
  /** The LIVE agent right now, or null when the user is at the shell. */
  agent: AgentInfoSchema.nullable(),
  /** The live foreground process (vim, …) — detected via OSC 2 title events. */
  foreground: ForegroundSchema.nullable(),
});
export type TerminalSnapshot = z.infer<typeof TerminalSnapshotSchema>;

/** The agent IDENTITY kolu persists for restore (`kind` + native session
 *  `sessionId`) and the discriminated RESTORE TARGET the fold derives from it —
 *  both OWNED by anyagent/schemas (the resume vocabulary layer), re-exported here
 *  as the schema home kolu-common/surface and the fold resolve them through. The
 *  fold's `restoreTargetOf` PRODUCES the target; `resumeFormFor` CONSUMES it. */
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type RestoreTarget = z.infer<typeof RestoreTargetSchema>;

/** The two facts a host CANNOT observe — recency is a CLOCK reading, the launch
 *  line is what the user TYPED. Irrecoverable from a screen, so kolu remembers
 *  them; written by kolu's fold ALONE (a producer's `TerminalSnapshot` cannot spell
 *  either field). Kept FLAT on kolu's authored record (`updateMemory` is the one
 *  narrowed writer), so the on-disk JSON path for these two is unchanged. */
export const AgentMemorySchema = z.object({
  /** Workspace-switcher recency: epoch-millis of the last LIVE agent observation,
   *  on kolu's clock — an agent-IDENTITY change (start / finish / new session)
   *  stamps immediately, and a same-identity OUTPUT tick stamps through the
   *  recency throttle (`RECENCY_THROTTLE_MS`, in `fold.ts`) so a stable long-lived
   *  session tracks its output instead of freezing. HONEST form: an
   *  idle/never-active terminal is `null` — a real absence, not an in-band `0`.
   *  The old `0` sentinel did TWO jobs at once (a genuine — if absurd —
   *  Unix-epoch reading, AND "never active") and collided with a THIRD: the
   *  client's own "not yet clock-reprojected" absent form
   *  (`useTerminalMetadata.ts`'s `reprojectClock`, which used to special-case
   *  `0` to avoid forging a garbage offset timestamp). `null` disambiguates all
   *  three: it can never be produced by a real clock reading, so a reader that
   *  needs "is there a recency to compare?" tests `!== null`, not `> 0`.
   *  A required key (never absent) — always `null` or a real epoch. */
  lastActivityAt: z.number().nullable().default(null),
  /** Normalized agent CLI invocation last observed (e.g. `"claude --model
   *  sonnet"`). Preserved across intervening non-agent input; drives the "resume
   *  agent on restore" offer. Absent for terminals that never ran a known agent. */
  lastAgentCommand: z.string().optional(),
});
export type AgentMemory = z.infer<typeof AgentMemorySchema>;

/** kolu's stored value: the last-seen `TerminalSnapshot` + the two remembered facts.
 *  NESTED, not merged, so the half published to the snapshots collection is
 *  `current.snapshot` — structurally WITHOUT the memory fields, not a runtime
 *  strip. The fold accumulator; never crosses a wire (kolu folds in-process). */
export type TerminalState = { snapshot: TerminalSnapshot; memory: AgentMemory };

/** The async resolution of the agent field made LAWFUL. The session file lands a
 *  beat after the command mark (over the settle window), so a bare `agent: null`
 *  is ambiguous — "no agent" or "not resolved yet?". `"unknown"` means a producer
 *  is mid-resolution (kolu KEEPS its last value, no clobber); `{ value }` is
 *  authoritative (kolu APPLIES it, even when `null` — a shell-idle null is the
 *  session genuinely ended). Never stored — only the resolved value is. */
export type Known<T> = "unknown" | { value: T };

/** A per-field sample a memoryless producer emits. The standing five build
 *  the `TerminalSnapshot`; `commandRun` is a discrete mark that feeds kolu's
 *  `lastAgentCommand` memory + the recent-agent MRU. The agent is the one field
 *  that resolves ASYNCHRONOUSLY, so it carries `Known<>` rather than a bare
 *  nullable. In-process for R9.0 (a plain TS union, no wire schema — the framed
 *  `terminalEvents` stream that serializes these is R9.3). */
export type TerminalEvent =
  | { kind: "cwd"; cwd: string }
  | { kind: "git"; git: GitInfo | null }
  | { kind: "pr"; pr: PrResult }
  | { kind: "foreground"; foreground: Foreground | null }
  | { kind: "agent"; agent: Known<AgentInfo | null> }
  | { kind: "commandRun"; command: string; replayed: boolean };

/** A fresh terminal's initial `TerminalSnapshot`: spawn-time cwd, everything else at
 *  its "not yet resolved" seed (git absent, PR pending, no agent, no foreground).
 *  The fold fills it in from now. The ONE home for the snapshot-default set. */
export function seedSnapshot(cwd: string): TerminalSnapshot {
  return {
    cwd,
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
  };
}

/** A fresh terminal's empty memory — no recency yet (honest `null`: a fresh
 *  terminal has never had an agent transition), no command yet. The ONE home
 *  for the memory-default set (a fresh spawn seeds empty memory; wake/adopt
 *  seed from the durable record). */
export function seedMemory(): AgentMemory {
  return { lastActivityAt: null };
}

// ── Process resident-set size — an honest three-way readout ────────────────

/** A single process's resident-set size as an HONEST three-way state, not a
 *  `number | null` that conflates "no process to measure" with "the read failed".
 *
 *   - `{ status: "ok", rssBytes }` — a live process answered.
 *   - `{ status: "absent" }` — there is no process to measure (down / not-yet-
 *     sampled). The expected "no value", not an error.
 *   - `{ status: "error" }` — the process was BELIEVED up yet its RSS read threw.
 *     A real anomaly the rail must surface distinctly from `absent`, so a failed
 *     read never renders identically to "no process" (the
 *     `caught-error-must-not-collapse-to-empty` rule — a server-side log is not a
 *     user surface).
 *
 *  A discriminated union (not an extra error flag beside a nullable number) so the
 *  three states are mutually exclusive by construction — there is no representable
 *  "error AND a stale rss".
 *
 *  Lives on this browser-safe shared-vocab leaf (beside `AgentMemory`/`seedMemory`)
 *  because BOTH `kolu-common/surface` and `@kolu/padi/surface` compose it —
 *  kolu-server's memory sampler folds padi's reading into its own `processMemory`
 *  cell — and the package-boundary seal forbids either importing the other. One
 *  declaration, imported both sides: no lockstep copy held together by a comment. */
export const ProcessRssSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), rssBytes: z.number() }),
  z.object({ status: z.literal("absent") }),
  z.object({ status: z.literal("error") }),
]);
export type ProcessRss = z.infer<typeof ProcessRssSchema>;

// ── Live-output cadence ────────────────────────────────────────────────────

/** Output quiet-period before a terminal reads as static again — the ONE cadence
 *  the "is this terminal moving bytes right now" signal breathes at on BOTH sides:
 *  padi's `activity` stream (the padi-tui `●`) and the client's
 *  `useTerminalActivity` (the browser green dot). It is a RAW byte-motion signal
 *  with a ~1s trailing window — a stream with sub-second gaps (compiles, `tail -f`)
 *  stays lit, one that pauses longer blinks off then back on when it resumes (so an
 *  agent that pauses >1s between thinking and emitting tokens flickers, by design).
 *
 *  Lives on this browser-safe shared-vocab leaf (beside {@link ProcessRssSchema})
 *  because BOTH `@kolu/padi` and the client (via `kolu-common/surface`) read it, and
 *  the package-boundary seal forbids either importing the other. One declaration, so
 *  the two dots can't drift out of lockstep behind a comment. */
export const TERMINAL_IDLE_AFTER_MS = 1000;

// ── Schema-derived sub-types ──────────────────────────────────────────

export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type CodexInfo = z.infer<typeof CodexInfoSchema>;
export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
export type GrokInfo = z.infer<typeof GrokInfoSchema>;
export type Foreground = z.infer<typeof ForegroundSchema>;

// ── fs/git wire schemas (the Code tab's raw reads + change-pulses) ─────────
//
// These three shapes back the host-side fs/git reads and their live watcher
// streams. They live on this browser-safe zod-only leaf (beside the terminal
// vocabulary) because `@kolu/padi/surface` composes them — the Code tab's
// `fs.readFile` / `subscribeRepoChange` / `subscribeFileChange` members — and the
// package-boundary seal forbids padi importing them from a node-coupled module.

/** A repo/file change PULSE, not data. kolu-git's `subscribeRepoChange` /
 *  `subscribeFileChange` collapse a burst of fs events into a payload-free
 *  `onChange()`, so a watcher stream's frame must DIFFER each tick or the
 *  stream's `isEqual` dedup would collapse two consecutive changes into one.
 *  The monotonic `seq` (per subscription, starting at 0 for the snapshot frame)
 *  is that distinguisher. A consumer reacts to a new pulse by re-querying the
 *  `fs.*` / `git.*` procedures — the pulse carries no fs/git data itself. */
export const RepoChangePulseSchema = z.object({
  seq: z.number().int().nonnegative(),
});
export type RepoChangePulse = z.infer<typeof RepoChangePulseSchema>;

/** Input for the per-file fs procedures (`readFile`, `statFileContentTag`) and the
 *  `subscribeFileChange` watcher. Deliberately NOT kolu-git's
 *  `FsReadFileInputSchema` (which carries a `terminalId`) — the library reads a
 *  file in a repo; the terminal/iframe-preview orchestration that needs the id
 *  stays kolu-server's. */
export const FsFileInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
});

/** Output of `fs.readFile` — the raw text read. Deliberately NOT kolu-git's
 *  `FsReadFileOutputSchema` (the text|binary discriminated union): the
 *  binary-preview/iframe-URL branch is kolu-server orchestration layered on top
 *  of this raw read, never library code. */
export const FsReadFileTextOutputSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
});
