/**
 * The generic terminal-awareness value — the server-derived slice of a
 * terminal's metadata, owned where it is PRODUCED (the provider set in this
 * package) rather than by any app.
 *
 * `AwarenessValue` is exactly the fields the providers compute: a terminal's
 * cwd · git context · last agent command · activity recency (the persisted
 * half) plus its forge PR · agent status · foreground process (the live half).
 * It is composed from the vendor-neutral leaf schemas (anyforge · kolu-git ·
 * kolu-github · the per-agent packages) and names NOTHING app-specific — no
 * `location` endpoint discriminator, no client/UI fields.
 *
 * kolu's own `TerminalServerMetadata` is built ON TOP of this: it merges in
 * `location` (the local/remote endpoint discriminator the app owns) and the
 * client-persisted UI fields. So the awareness value is not carved out of
 * kolu's record — kolu's record extends this generic base. That inversion is
 * what lets `arivu` (the standalone daemon) and `arivu-tui` (the viewer) reuse
 * the providers with zero dependency on any kolu-app package.
 *
 * The persisted-vs-live partition is the same write fence the providers honor
 * through `ProviderHooks` (and that kolu's `metadata.ts` enforces): persisted
 * fields flow through the autosave-arming mutator, live fields through the
 * quiet one. The two halves are kept as distinct sub-schemas so a hook's
 * mutator type can be narrowed to exactly one half.
 */

import { PrInfoSchema } from "anyforge/schemas";
import { ClaudeCodeInfoSchema } from "kolu-claude-code/schemas";
import { CodexInfoSchema } from "kolu-codex/schemas";
import { GitInfoSchema } from "kolu-git/schemas";
import { GhUnavailableSchema, reasonForGhCode } from "kolu-github/schemas";
import { OpenCodeInfoSchema } from "kolu-opencode/schemas";
import { match } from "ts-pattern";
import { z } from "zod";

// ── Terminal identity ─────────────────────────────────────────────────

export const TerminalIdSchema = z.string().uuid();
export type TerminalId = z.infer<typeof TerminalIdSchema>;

// ── Agent status ──────────────────────────────────────────────────────

export const AgentKindSchema = z.enum(["claude-code", "codex", "opencode"]);

export const AgentInfoSchema = z.discriminatedUnion("kind", [
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
  OpenCodeInfoSchema,
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

// ── The awareness value — persisted half + live half ──────────────────
//
// Invariant: every awareness field appears in EXACTLY ONE of the two halves.
// The split is the write fence: the persisted half is mutated through the
// autosave-arming hook (`updateServerMetadata`), the live half through the
// quiet one (`updateServerLiveMetadata`) — so the ~150 ms agent-stream
// firehose can never re-arm the persist path. Choose a new field's half on
// one axis: "must this survive a process restart?" — yes → persisted, no →
// live.

/** The persisted half of the awareness value — re-resolved slowly (cwd / git /
 *  last agent command) and carried across a restart by hosts that persist
 *  (kolu). Disjoint from the live half. */
export const AwarenessPersistedFieldsSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  /** Normalized agent CLI invocation last observed in this terminal (e.g.
   *  `"claude --model sonnet"`). Preserved across intervening non-agent
   *  input; drives the "resume agent on restore" offer. Absent for terminals
   *  that never ran a known agent. */
  lastAgentCommand: z.string().optional(),
  /** Workspace-switcher recency key: epoch-millis of the last agent
   *  semantic-key transition (`kind`/`sessionId`/`state`). Idle terminals
   *  stay at `0`. */
  lastActivityAt: z.number().default(0),
});
export type AwarenessPersistedFields = z.infer<
  typeof AwarenessPersistedFieldsSchema
>;

/** The live half of the awareness value — transient status fed by external
 *  state and never persisted; a host with no live source re-derives it on
 *  (re)start. Disjoint from the persisted half. */
export const AwarenessLiveFieldsSchema = z.object({
  /** Forge PR resolution — discriminated union (see PrResultSchema).
   *  Forge-neutral PR resolution (anyforge); the gh adapter resolves it
   *  today. */
  pr: PrResultSchema,
  /** AI coding agent status (Claude Code, OpenCode, etc.). */
  agent: AgentInfoSchema.nullable(),
  /** Foreground process name — detected via OSC 2 title change events. */
  foreground: ForegroundSchema.nullable(),
});
export type AwarenessLiveFields = z.infer<typeof AwarenessLiveFieldsSchema>;

/** The whole generic awareness value — persisted half ∪ live half. kolu's
 *  `TerminalServerMetadata` is this plus `location`; `arivu` serves exactly
 *  this over the wire. */
export const AwarenessValueSchema = AwarenessPersistedFieldsSchema.merge(
  AwarenessLiveFieldsSchema,
);
export type AwarenessValue = z.infer<typeof AwarenessValueSchema>;

// ── Schema-derived sub-types ──────────────────────────────────────────

export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type CodexInfo = z.infer<typeof CodexInfoSchema>;
export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
export type Foreground = z.infer<typeof ForegroundSchema>;
