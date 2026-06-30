/** Browser-safe schemas and pure types from anyagent.
 *
 *  Split out from `index.ts` so kolu-common (and the client bundle) can
 *  import zod schemas without dragging in node-only modules transitively. */

import { z } from "zod";

/** Task/todo progress — total items and completed count.
 *  Used by both Claude Code (from TaskCreate/TaskUpdate tool calls)
 *  and OpenCode (from the `todo` SQLite table). */
export const TaskProgressSchema = z.object({
  total: z.number(),
  completed: z.number(),
});

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/** Agent discriminator literals — the vocabulary anyagent's own helpers
 *  (`agentKindFromCommand`, the `BASENAME_TO_KIND` bridge) return and that
 *  `AgentInfoSchema` in kolu-common discriminates on. Owned here (the lower
 *  layer) so the single home is browser-safe and re-exportable upward;
 *  the basename axis (`claude`/`codex`/`opencode`) maps onto it. */
export const AgentKindSchema = z.enum(["claude-code", "codex", "opencode"]);
export type AgentKind = z.infer<typeof AgentKindSchema>;

/** A reference to the EXACT agent conversation that was running on a terminal —
 *  the agent discriminator (`kind`, matching `AgentInfo.kind`) paired with that
 *  agent's native session/conversation `id`. Captured live from `agent.sessionId`
 *  and persisted (unlike the rest of the live `agent` field) so waking a slept
 *  terminal — or restoring after a restart — can resume THAT conversation, not
 *  merely the most-recent one in the cwd (juspay/kolu#1495). The `kind` rides
 *  with the `id` so a consumer can never aim the id at the wrong agent CLI:
 *  `resumeAgentCommand` only uses it when `kind` names the same agent the
 *  command head does.
 *
 *  Single home here (the lower layer that owns `AgentKind` + the
 *  `resumeAgentCommand` receptacle that consumes the ref); terminal-awareness
 *  re-exports it for the persist path. */
export const AgentSessionRefSchema = z.object({
  kind: AgentKindSchema,
  id: z.string(),
});
export type AgentSessionRef = z.infer<typeof AgentSessionRefSchema>;

/** The agent IDENTITY a terminal can RESUME — the agent `kind` (matching
 *  `AgentInfo.kind`) paired with its native session id under the name `sessionId`
 *  (matching the live `agent.sessionId`). The persist-safe reduction of a live
 *  agent: no lie-when-dead `state`/`tokens` ride to disk, only the two fields
 *  needed to re-target the EXACT conversation on wake / cold-restore
 *  (juspay/kolu#1495). Owned here beside `AgentSessionRef` (the `{kind, id}` shape
 *  `resumeAgentCommand` consumes); `resumeFormFor` maps `sessionId → id` at the
 *  splice. */
export const AgentIdentitySchema = z.object({
  kind: AgentKindSchema,
  sessionId: z.string(),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/** The fold-derived RESTORE TARGET — kolu's discriminated answer to "what does
 *  waking this terminal do?", made a single value so the wake/restore path can
 *  never read it wrong. Three arms, with no fourth meaning smuggled into an absent
 *  field:
 *   - `none` — nothing to bring back (never launched an agent, or quit to a shell
 *     while live): wake lands on a BARE SHELL, by construction (juspay/kolu#1492).
 *     An ABSENT target reads as `none` — never as "resume something".
 *   - `exact` — an agent was LIVE at sleep: resume THAT conversation by id
 *     (juspay/kolu#1495), splicing `agent` into `command`.
 *   - `legacyMostRecent` — a migrated pre-1.29 record that remembered a launch
 *     `command` but never captured the session id: resume the MOST-RECENT
 *     conversation in the cwd (the old behavior, kept for already-saved sessions).
 *     NAMED so it is never confused with `none`; the live fold never produces it,
 *     only `backfillAwarenessCutover` does.
 *  Produced by kolu's fold (`restoreTargetOf`), persisted on the authored record,
 *  consumed by `resumeFormFor`. The previous shape — a bare optional `resumeAgent`
 *  identity read alongside `lastAgentCommand` — left `(command set, identity
 *  absent)` meaning BOTH "quit, restore nothing" and "no id captured, resume
 *  most-recent"; this discriminant splits those two into distinct values. */
export const RestoreTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("exact"),
    command: z.string(),
    agent: AgentIdentitySchema,
  }),
  z.object({ kind: z.literal("legacyMostRecent"), command: z.string() }),
]);
export type RestoreTarget = z.infer<typeof RestoreTargetSchema>;
