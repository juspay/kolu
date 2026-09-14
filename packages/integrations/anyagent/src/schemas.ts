/** Browser-safe schemas and pure types from anyagent.
 *
 *  Split out from `index.ts` so kolu-common (and the client bundle) can
 *  import these schemas without dragging in node-only modules transitively. */

import { Schema } from "effect";

export type {
  AgentCliGrammar,
  AgentMark,
  AgentResumePolicy,
  AnyAgentVocab,
  AgentVocab,
  FlagArity,
} from "./vocab.ts";

/** Task/todo progress — total items and completed count.
 *  Used by both Claude Code (from TaskCreate/TaskUpdate tool calls)
 *  and OpenCode (from the `todo` SQLite table). */
export const TaskProgressSchema = Schema.Struct({
  total: Schema.Number,
  completed: Schema.Number,
});

export type TaskProgress = typeof TaskProgressSchema.Type;

/** The agent IDENTITY a terminal can RESUME — the agent `kind` paired with its
 *  native session id under the name `sessionId` (matching the live
 *  `agent.sessionId`) and the RESUME REF the CLI accepts (`resumeRef`).
 *
 *  Captured live and persisted (unlike the rest of the live `agent` field) so
 *  waking a slept terminal — or restoring after a restart — can resume THAT
 *  conversation, not merely the most-recent one in the cwd (juspay/kolu#1495).
 *  The persist-safe reduction of a live agent: no lie-when-dead
 *  `state`/`tokens` ride to disk, only what is needed to re-target the EXACT
 *  conversation on wake / cold-restore.
 *
 *  `kind` is an OPEN `Schema.String`, not the registry's closed kind union:
 *  anyagent cannot import the registry without a cycle, and this record is
 *  PERSISTED — a record naming an agent this build no longer knows yields no
 *  resume (a bare shell), the documented refusal path, rather than failing the
 *  decode and dropping the whole terminal. `resumeAgentCommand`'s same-agent
 *  gate validates the ref against the registry at the point of use.
 *
 *  `resumeRef` is the agent-specific ref spliced through the CLI's `byId`
 *  (juspay/kolu#1495): for claude/codex/opencode/grok it equals `sessionId`;
 *  for pi it is the transcript PATH (which bypasses pi's session-store lookup
 *  entirely). It is derived at fold time via `vocab.resume.ref(liveInfo)` and
 *  gated by the same agent's `idPattern` before it reaches a shell line.
 *  `sessionId` is kept for identity/display. */
export const AgentIdentitySchema = Schema.Struct({
  kind: Schema.String,
  sessionId: Schema.String,
  resumeRef: Schema.String,
});
export type AgentIdentity = typeof AgentIdentitySchema.Type;

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
 *     only `backfillSnapshotCutover` does.
 *  Produced by kolu's fold (`restoreTargetOf`), persisted on the authored record,
 *  consumed by `resumeFormFor`. The previous shape — a bare optional `resumeAgent`
 *  identity read alongside `lastAgentCommand` — left `(command set, identity
 *  absent)` meaning BOTH "quit, restore nothing" and "no id captured, resume
 *  most-recent"; this discriminant splits those two into distinct values. */
export const RestoreTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("exact"),
    command: Schema.String,
    agent: AgentIdentitySchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("legacyMostRecent"),
    command: Schema.String,
  }),
]);
export type RestoreTarget = typeof RestoreTargetSchema.Type;
