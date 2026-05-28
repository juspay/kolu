/** Zod schemas for Claude Code session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which transitively evaluates
 *  `@anthropic-ai/claude-agent-sdk` and its `node:crypto` / `node:events`
 *  imports. Mirrors the `kolu-github/schemas` precedent. See juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports, SDK imports,
 *  and filesystem access — zod and `anyagent`'s schema re-exports only. */

import { TaskProgressSchema } from "@kolu/anyagent";
import { z } from "zod";

export type { TaskProgress } from "@kolu/anyagent";
export { TaskProgressSchema };

export const ClaudeCodeInfoSchema = z.object({
  kind: z.literal("claude-code"),
  /** Current state derived from session JSONL.
   *  - `awaiting_user`: agent stopped to ask the human via `AskUserQuestion`
   *    or `ExitPlanMode`. The state literal is kept here for shape uniformity
   *    with `CodexInfo` / `OpenCodeInfo` and so `deriveState`'s
   *    `toolUseOrAwaitingUser` helper compiles, but in practice the Claude
   *    Agent SDK buffers `requiresUserInteraction` tools' assistant messages
   *    until the user resolves them — the `tool_use` block isn't on disk
   *    while the prompt is pending, so this case never fires under the
   *    current SDK. Fix tracked in #905 (PreToolUse hook side-channel). */
  state: z.enum(["thinking", "tool_use", "waiting", "awaiting_user"]),
  /** Session UUID from ~/.claude/sessions/. */
  sessionId: z.string(),
  /** Model name if available (e.g. "claude-opus-4-6"). */
  model: z.string().nullable(),
  /** Display title from the Claude Agent SDK — custom title › auto-summary › first prompt.
   *  Refreshed best-effort on each transcript change; null until the first lookup resolves. */
  summary: z.string().nullable(),
  /** Task checklist progress derived from TaskCreate/TaskUpdate tool calls in the transcript.
   *  null when no tasks have been created in the session. */
  taskProgress: TaskProgressSchema.nullable(),
  /** Running context-window token count: sum of input + cache_creation +
   *  cache_read on the latest assistant entry's `message.usage`. Null when
   *  the transcript has no assistant entries yet, or the entry lacks usage
   *  (e.g. synthetic entries from /compact). Window size is not encoded —
   *  consumers render the raw count compact ("47k"). */
  contextTokens: z.number().nullable(),
});

export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
