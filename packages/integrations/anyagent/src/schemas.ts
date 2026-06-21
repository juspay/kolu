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
