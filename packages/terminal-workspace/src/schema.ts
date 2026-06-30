/**
 * The generic terminal-awareness value — the server-derived slice of a
 * terminal's metadata, owned where it is PRODUCED (the sensor set in this
 * package) rather than by any app.
 *
 * `AwarenessValue` is exactly the fields the sensors compute: a terminal's
 * cwd · git context · last agent command · activity recency (the persisted
 * half) plus its forge PR · agent status · foreground process (the live half).
 * It is composed from the vendor-neutral leaf schemas (anyforge · kolu-git ·
 * kolu-github · the per-agent packages) and names NOTHING app-specific — no
 * `location` endpoint discriminator, no client/UI fields.
 *
 * kolu does NOT build a record ON TOP of this. It serves this generic
 * `AwarenessValue` UNCHANGED on its `terminalWorkspace.awareness` collection, and
 * recomposes its full `TerminalMetadata` at the CLIENT by JOINING that value with
 * a SEPARATE authored record — the app-owned `location` (the local/remote endpoint
 * discriminator) plus the client-persisted UI fields (themeName / parentId /
 * canvasLayout / …). So awareness is a SIBLING of kolu's authored record, not a
 * base kolu's record extends. That separation is what lets `pulam` (the standalone
 * daemon) and `pulam-tui` (the viewer) reuse the sensors with zero dependency on
 * any kolu-app package.
 *
 * The persisted-vs-live partition is the same write fence the sensors honor
 * through `AwarenessSink` (and that kolu's `metadata.ts` enforces): persisted
 * fields flow through the autosave-arming mutator, live fields through the
 * quiet one. The two halves are kept as distinct sub-schemas so a hook's
 * mutator type can be narrowed to exactly one half.
 */

import { AgentKindSchema, AgentSessionRefSchema } from "anyagent/schemas";
import { PrInfoSchema } from "anyforge/schemas";
import { ClaudeCodeInfoSchema } from "kolu-claude-code/schemas";
import { CodexInfoSchema } from "kolu-codex/schemas";
import { type GitInfo, GitInfoSchema } from "kolu-git/schemas";
import { GhUnavailableSchema, reasonForGhCode } from "kolu-github/schemas";
import { OpenCodeInfoSchema } from "kolu-opencode/schemas";
import { match } from "ts-pattern";
import { z } from "zod";

// ── Terminal identity ─────────────────────────────────────────────────

export const TerminalIdSchema = z.string().uuid();
export type TerminalId = z.infer<typeof TerminalIdSchema>;

// ── Agent status ──────────────────────────────────────────────────────

// `AgentKindSchema` + `AgentSessionRefSchema` are OWNED by anyagent/schemas
// (the lower layer that owns the `AgentKind` vocabulary and the
// `resumeAgentCommand` receptacle consuming the ref). Re-exported here so the
// wake/restore path (`anyagent`'s `resumeFormFor`) and kolu-common/surface keep
// resolving them from this schema home — one declaration, validated once.
export { AgentKindSchema, AgentSessionRefSchema };

export const AgentInfoSchema = z.discriminatedUnion("kind", [
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
  OpenCodeInfoSchema,
]);

// `AgentSessionRef` (the conversation-identity ref `resumeAgentCommand` consumes
// to target the EXACT conversation on wake/restore) — re-export the inferred type
// from the anyagent-owned schema so kolu-common/surface keeps resolving it here.
export type AgentSessionRef = z.infer<typeof AgentSessionRefSchema>;

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

// ── The Observation — what a host PRODUCER emits ──────────────────────
//
// The de-entanglement (awareness-derive-store.mdx): a host PRODUCER emits one
// `Observation` — exactly the five fields it can RE-OBSERVE — and nothing it
// cannot. The two facts a host genuinely cannot re-observe (a clock reading and
// the launch invocation) are `AgentMemory`, written by kolu's fold ALONE. The
// old persisted/live write-fence is gone: the producer is memoryless and cannot
// CONSTRUCT memory (the type forbids it), so no observation can clobber a
// remembered fact — the fence is the EMIT TYPE, not a runtime mutator split.

/** What a host PRODUCER emits — exactly the fields it can RE-OBSERVE. Local or
 *  remote, the SAME type. Served as-is on kolu's `terminalWorkspace.awareness`
 *  collection (kolu JOINS it with a separate authored record at the client).
 *  `pr` and `agent` ride here too — both re-observable; `pr` is restore-relevant
 *  (true-when-dead, persisted like `git`), the live `agent` detail is RAM-only
 *  (lie-when-dead, re-derived on (re)spawn). */
export const ObservationSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  /** Forge PR resolution — discriminated union (see PrResultSchema). */
  pr: PrResultSchema,
  /** The LIVE agent right now, or null when the user is at the shell. */
  agent: AgentInfoSchema.nullable(),
  /** The live foreground process (vim, …) — detected via OSC 2 title events. */
  foreground: ForegroundSchema.nullable(),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** The agent IDENTITY kolu persists for restore — the agent `kind` + native
 *  session `id` (`sessionId`), reduced from the frozen live `agent` (NOT the full
 *  `AgentInfo`: no lie-when-dead `state`/`tokens` ride to disk). Restore resumes
 *  the EXACT conversation that was live at sleep (#1495); a quit-to-shell freezes
 *  a null agent, so there is no identity and wake lands on a bare shell (#1492). */
export const AgentIdentitySchema = z.object({
  kind: AgentKindSchema,
  sessionId: z.string(),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/** The two facts a host CANNOT observe — recency is a CLOCK reading, the launch
 *  line is what the user TYPED. Irrecoverable from a screen, so kolu remembers
 *  them; written by kolu's fold ALONE (a producer's `Observation` cannot spell
 *  either field). Kept FLAT on kolu's authored record (`updateMemory` is the one
 *  narrowed writer), so the on-disk JSON path for these two is unchanged. */
export const AgentMemorySchema = z.object({
  /** Workspace-switcher recency: epoch-millis of the last LIVE agent-IDENTITY
   *  change (start / finish / new session), on kolu's clock. Idle terminals
   *  stay at `0`. */
  lastActivityAt: z.number().default(0),
  /** Normalized agent CLI invocation last observed (e.g. `"claude --model
   *  sonnet"`). Preserved across intervening non-agent input; drives the "resume
   *  agent on restore" offer. Absent for terminals that never ran a known agent. */
  lastAgentCommand: z.string().optional(),
});
export type AgentMemory = z.infer<typeof AgentMemorySchema>;

/** kolu's stored value: the last-seen `Observation` + the two remembered facts.
 *  NESTED, not merged, so the half published to the awareness collection is
 *  `current.observed` — structurally WITHOUT the memory fields, not a runtime
 *  strip. The fold accumulator; never crosses a wire (kolu folds in-process). */
export type KoluAwareness = { observed: Observation; memory: AgentMemory };

/** The async resolution of the agent field made LAWFUL. The session file lands a
 *  beat after the command mark (over the settle window), so a bare `agent: null`
 *  is ambiguous — "no agent" or "not resolved yet?". `"unknown"` means a producer
 *  is mid-resolution (kolu KEEPS its last value, no clobber); `{ value }` is
 *  authoritative (kolu APPLIES it, even when `null` — a shell-idle null is the
 *  session genuinely ended). Never stored — only the resolved value is. */
export type Observed<T> = "unknown" | { value: T };

/** A per-field observation a memoryless producer emits. The standing five build
 *  the `Observation`; `commandRun` is a discrete mark that feeds kolu's
 *  `lastAgentCommand` memory + the recent-agent MRU. The agent is the one field
 *  that resolves ASYNCHRONOUSLY, so it carries `Observed<>` rather than a bare
 *  nullable. In-process for R9.0 (a plain TS union, no wire schema — the framed
 *  `awarenessEvents` stream that serializes these is R9.3). */
export type AwarenessObservation =
  | { kind: "cwd"; cwd: string }
  | { kind: "git"; git: GitInfo | null }
  | { kind: "pr"; pr: PrResult }
  | { kind: "foreground"; foreground: Foreground | null }
  | { kind: "agent"; agent: Observed<AgentInfo | null> }
  | { kind: "commandRun"; command: string; replayed: boolean };

/** A framed batch of observations carrying kolu's subscription-phase provenance.
 *  `snapshot` is a re-observation (ctx.live = false — never bumps recency);
 *  `delta` is a live change (ctx.live = true); `gap` flags a detected hole so
 *  kolu re-snapshots rather than fold a divergent stream. In-process for R9.0:
 *  the local `subscribeAwareness` seam synthesizes these from the engine's emit
 *  sequence (the wire stream + cross-host `seq` are R9.3). */
export type AwarenessFrame =
  | { phase: "snapshot"; observations: AwarenessObservation[] }
  | { phase: "delta"; seq: number; observations: AwarenessObservation[] }
  | { phase: "gap"; afterSeq: number };

/** A fresh terminal's initial `Observation`: spawn-time cwd, everything else at
 *  its "not yet resolved" seed (git absent, PR pending, no agent, no foreground).
 *  The fold fills it in from now. The ONE home for the observed-default set. */
export function seedObservation(cwd: string): Observation {
  return {
    cwd,
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
  };
}

/** A fresh terminal's empty memory — recency at 0, no command yet. The ONE home
 *  for the memory-default set (a fresh spawn seeds zero memory; wake/adopt seed
 *  from the durable record). */
export function seedMemory(): AgentMemory {
  return { lastActivityAt: 0 };
}

// ── Schema-derived sub-types ──────────────────────────────────────────

export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type CodexInfo = z.infer<typeof CodexInfoSchema>;
export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
export type Foreground = z.infer<typeof ForegroundSchema>;
