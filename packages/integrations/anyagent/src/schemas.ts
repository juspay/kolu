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
 *  Reported by Claude Code (from TaskCreate/TaskUpdate tool calls); the
 *  integrations with no todo primitive (OpenCode 2.x among them) report
 *  `null`. */
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
 *  decode and dropping the whole terminal. `resumeFormFor` resolves the kind
 *  against the registry and gates the ref at the point of use.
 *
 *  `resumeRef` is the agent-specific ref spliced through the CLI's `byId`
 *  (juspay/kolu#1495): for claude/codex/opencode/grok it equals `sessionId`;
 *  for pi it is the transcript PATH (which bypasses pi's session-store lookup
 *  entirely). It is derived at fold time via `vocab.resume.ref(liveInfo)` and
 *  gated by the same agent's `idPattern` before it reaches a shell line.
 *  `sessionId` is kept for identity/display.
 *
 *  Every field here is OS-DERIVED (a session file's identity, a process's
 *  argv) — never a string read off PTY output. See `agent-cli.ts` for the
 *  invariant and `restoreTargetOf` for the builder. */
export const AgentIdentitySchema = Schema.Struct({
  kind: Schema.String,
  sessionId: Schema.String,
  resumeRef: Schema.String,
});
export type AgentIdentity = typeof AgentIdentitySchema.Type;

/** The fold-derived RESTORE TARGET — kolu's discriminated answer to "what does
 *  waking this terminal do?", made a single value so the wake/restore path can
 *  never read it wrong. Two arms, with no third meaning smuggled into an absent
 *  field:
 *   - `none` — nothing to bring back (never launched an agent, or quit to a shell
 *     while live): wake lands on a BARE SHELL, by construction (juspay/kolu#1492).
 *     An ABSENT target reads as `none` — never as "resume something".
 *   - `exact` — an agent was LIVE at sleep: resume THAT conversation
 *     (juspay/kolu#1495). Every part of the line the wake types is a structured
 *     fact kolu owns: `agent` names the conversation (OS-derived session
 *     identity) and `argv` carries the live process's flags, already filtered
 *     through the agent's `stableFlags` allowlist when it was captured
 *     (`readProcessSnapshot` → `stableFlagTokens`).
 *
 *  There is deliberately no `command: string`. A captured launch line was the
 *  forgery hole: `OSC 633 ; E ; <text>` is whatever the user displays, so
 *  `LD_PRELOAD=/x claude …` typed into a `cat` became a command wake executed.
 *  PTY output is a sensor; nothing that executes may read a value whose
 *  provenance is PTY bytes. `resumeFormFor` renders the shell line from
 *  `agent` + `argv` + the agent's registry vocab.
 *
 *  Produced by kolu's fold (`restoreTargetOf`), persisted on the authored record,
 *  consumed by `resumeFormFor`. The 1.29-era `legacyMostRecent` arm (a migrated
 *  record that remembered a launch `command` but no session id) is gone: it had
 *  no honest structured replacement, so the migration maps it to `none` — a bare
 *  shell — rather than re-parsing the captured text (that parse was the hole). */
export const RestoreTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("exact"),
    agent: AgentIdentitySchema,
    /** The live agent process's `stableFlags`-filtered argv tokens (never the
     *  raw process argv). Already allowlisted when persisted, so replaying them
     *  cannot smuggle a path, a resume marker, or an unvetted flag. */
    argv: Schema.Array(Schema.String),
  }),
]);
export type RestoreTarget = typeof RestoreTargetSchema.Type;
