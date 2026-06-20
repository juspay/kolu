/** Zod schemas for Claude Code session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which transitively evaluates
 *  `@anthropic-ai/claude-agent-sdk` and its `node:crypto` / `node:events`
 *  imports. Mirrors the `anyforge/schemas` precedent. See juspay/kolu#682.
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

export const ClaudeCodeInfoSchema = z.object({
  kind: z.literal("claude-code"),
  /** Current state derived from session JSONL — except `awaiting_user`, which
   *  can also arrive from a screen scrape (see below).
   *  - `awaiting_user`: agent stopped to ask the human. Two on-disk shapes hide
   *    this from the JSONL classifier (`deriveState`'s `toolUseOrAwaitingUser`):
   *    for `AskUserQuestion` / `ExitPlanMode` the Claude Agent SDK buffers the
   *    assistant message in memory until the user resolves it, so the `tool_use`
   *    block isn't on disk and the tail reads the prior entry (often `thinking`,
   *    sometimes `waiting`); for a tool-permission gate the tool call IS on disk
   *    (so the tail reads `tool_use`) but the approval decision lives only in the
   *    on-screen dialog. #905 recovers the missing signal by recognizing the
   *    prompt on the *rendered screen* (`screen.ts`): the server's screen-scrape
   *    poll promotes whichever pollable state is active (`thinking` / `tool_use`
   *    / `waiting`) to `awaiting_user` while the dialog is visible, and the JSONL
   *    watcher lowers it again once the user answers and the transcript catches
   *    up. Recognized prompts: `AskUserQuestion` (its `… to navigate` footer) and
   *    the tool-permission gates (Write/Edit/Bash/WebFetch approval);
   *    `ExitPlanMode`'s on-screen prompt has no equivalent marker and is a
   *    deliberate follow-up. So this state fires from the screen source even
   *    though it stays absent from the transcript tail.
   *  - `running_background`: the agent ended its turn (`end_turn`) while an
   *    outstanding background run it launched is still live — either a dynamic
   *    `Workflow` with an observable run journal
   *    (`<session>/workflows/<runId>.json`), or a `/fork` sub-agent with a
   *    streaming transcript (`<session>/subagents/agent-<id>.jsonl`). Without
   *    this the end-of-turn would read as `waiting` (needs-user); the agent is
   *    actually busy-waiting on that run. A backgrounded `Bash` command or
   *    `Task`/`Agent` (no observable anchor) does NOT promote here: its launch
   *    marker outlives the process, so a lost completion notification would spin
   *    the pill forever (the phantom-`running_background` bug). The `workflow`
   *    field below is populated only for the `Workflow` case; a fork promotes
   *    the state but carries no fan-out journal, so `workflow` stays null.
   *    Claude-Code-specific — see `deriveState` and the session-watcher. */
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
  /** Running context-window token count: sum of input + cache_creation +
   *  cache_read on the latest assistant entry's `message.usage`. Null when
   *  the transcript has no assistant entries yet, or the entry lacks usage
   *  (e.g. synthetic entries from /compact). Window size is not encoded —
   *  consumers render the raw count compact ("47k"). */
  contextTokens: z.number().nullable(),
  /** Epoch-ms the conversation began — the transcript's first entry
   *  `timestamp`. Deliberately the conversation's age (survives a `claude -c`
   *  resume), NOT the session file's process `startedAt` (which resets on
   *  resume); matches codex/opencode's "Running for" semantics. Null until the
   *  first message lands. Drives the inspector's "Running for" elapsed display. */
  startedAt: z.number().nullable(),
});

export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
