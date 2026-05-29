/** Zod schemas for Claude Code session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which transitively evaluates
 *  `@anthropic-ai/claude-agent-sdk` and its `node:crypto` / `node:events`
 *  imports. Mirrors the `kolu-github/schemas` precedent. See juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports, SDK imports,
 *  and filesystem access — zod and `anyagent`'s schema re-exports only. */

import { TaskProgressSchema } from "anyagent";
import { z } from "zod";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

/** Dynamic-workflow fan-out progress, read from the run journal on disk
 *  (`<session>/workflows/<runId>.json`). Populated only while the agent is
 *  busy-waiting on a background `Workflow` task (state `running_background`);
 *  null otherwise. Claude-Code-specific — Codex/OpenCode have no analogue,
 *  so this field lives on `ClaudeCodeInfo` alone rather than the shared shape. */
export const ClaudeWorkflowSchema = z.object({
  /** Workflow name from the journal (e.g. "deep-research"). */
  name: z.string(),
  /** Journal lifecycle status (e.g. "running", "completed", "failed"). */
  status: z.string(),
  /** Total sub-agents spawned so far (journal `agentCount`) — the fan-out count. */
  agents: z.number(),
});

export type ClaudeWorkflow = z.infer<typeof ClaudeWorkflowSchema>;

/** The pending question surfaced while the agent is `awaiting_user` (#905),
 *  read from the hook-written sidecar. `question`/`options` are best-effort
 *  enrichment for the tooltip — `ExitPlanMode` and any payload the writer
 *  couldn't parse carry `{ question: null, options: [] }`. Claude-Code-specific
 *  (Codex/OpenCode derive awaiting state from JSONL and have no analogue), so
 *  it rides `ClaudeCodeInfo` alone rather than the shared shape. */
export const AwaitingPromptSchema = z.object({
  /** The question text (AskUserQuestion's first question), or null. */
  question: z.string().nullable(),
  /** Answer choices offered, if any. Empty for ExitPlanMode / unparsed input. */
  options: z.array(z.string()),
});

export type AwaitingPrompt = z.infer<typeof AwaitingPromptSchema>;

export const ClaudeCodeInfoSchema = z.object({
  kind: z.literal("claude-code"),
  /** Current state derived from session JSONL.
   *  - `awaiting_user`: agent stopped to ask the human via `AskUserQuestion`
   *    or `ExitPlanMode`. The Claude Agent SDK buffers these
   *    `requiresUserInteraction` tools' assistant messages until the user
   *    resolves them, so the `tool_use` block isn't on disk while the prompt
   *    is pending — JSONL polling alone can't see it (`toolUseOrAwaitingUser`
   *    only fires once the message lands, by which point the answer is in
   *    too). #905 closes the gap with a `PreToolUse`/`PostToolUse` hook that
   *    writes/clears a sidecar (`AWAITING_DIR/<sessionId>.json`); the
   *    session-watcher reads it via `readAwaitingSidecar` and overrides state
   *    to `awaiting_user` while present, carrying `awaitingPrompt` below.
   *  - `running_background`: the agent ended its turn (`end_turn`) while a
   *    background task it launched (a dynamic `Workflow`, a backgrounded
   *    `Bash` command, or a background `Task`/`Agent`) is still running.
   *    Without this the end-of-turn would read as `waiting` (needs-user); the
   *    agent is actually busy-waiting on the background task.
   *    Claude-Code-specific — see `deriveState`. */
  state: z.enum([
    "thinking",
    "tool_use",
    "waiting",
    "awaiting_user",
    "running_background",
  ]),
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
  /** Fan-out progress of the background `Workflow` the agent is waiting on,
   *  read from its run journal. Distinct from `taskProgress` (the in-session
   *  TaskCreate/TaskUpdate checklist) — these are two different concepts and
   *  are kept as separate fields. null unless `state` is `running_background`
   *  and the outstanding task is a `Workflow` with an on-disk journal. */
  workflow: ClaudeWorkflowSchema.nullable(),
  /** The pending question while `state` is `awaiting_user`, from the #905 hook
   *  sidecar. null in every other state (and even in `awaiting_user` if the
   *  sidecar payload had no question, e.g. `ExitPlanMode`). Read through the
   *  `agentAwaitingPrompt` accessor, which gates it on the state — mirroring
   *  the `workflow`/`running_background` pairing. */
  awaitingPrompt: AwaitingPromptSchema.nullable(),
  /** Running context-window token count: sum of input + cache_creation +
   *  cache_read on the latest assistant entry's `message.usage`. Null when
   *  the transcript has no assistant entries yet, or the entry lacks usage
   *  (e.g. synthetic entries from /compact). Window size is not encoded —
   *  consumers render the raw count compact ("47k"). */
  contextTokens: z.number().nullable(),
});

export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
