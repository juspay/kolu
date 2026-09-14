/** Effect schemas for Claude Code session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which transitively evaluates
 *  `@anthropic-ai/claude-agent-sdk` and its `node:crypto` / `node:events`
 *  imports. Mirrors the `anyforge/schemas` precedent. See juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports, SDK imports,
 *  and filesystem access — Effect Schema and `anyagent`'s schema re-exports
 *  only. */

import { type AgentVocab, type FlagArity, TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

/** Dynamic-workflow fan-out progress, read from the run journal on disk
 *  (`<session>/workflows/<runId>.json`). Populated only while the agent is
 *  busy-waiting on a background `Workflow` task (state `running_background`);
 *  null otherwise. Claude-Code-specific — Codex/OpenCode have no analogue,
 *  so this field lives on `ClaudeCodeInfo` alone rather than the shared shape. */
export const ClaudeWorkflowSchema = Schema.Struct({
  /** Workflow name from the journal (e.g. "deep-research"). */
  name: Schema.String,
  /** Journal lifecycle status (e.g. "running", "completed", "failed"). */
  status: Schema.String,
  /** Total sub-agents spawned so far (journal `agentCount`) — the fan-out count. */
  agents: Schema.Number,
});

export type ClaudeWorkflow = typeof ClaudeWorkflowSchema.Type;

export const ClaudeCodeInfoSchema = Schema.Struct({
  kind: Schema.Literal("claude-code"),
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
  state: Schema.Literals([
    "thinking",
    "tool_use",
    "waiting",
    "awaiting_user",
    "running_background",
  ]),
  /** Session UUID from ~/.claude/sessions/. */
  sessionId: Schema.String,
  /** Model name if available (e.g. "claude-opus-4-6"). */
  model: Schema.NullOr(Schema.String),
  /** Display title from the Claude Agent SDK — custom title › auto-summary › first prompt.
   *  Refreshed best-effort on each transcript change; null until the first lookup resolves. */
  summary: Schema.NullOr(Schema.String),
  /** Task checklist progress derived from TaskCreate/TaskUpdate tool calls in the transcript.
   *  null when no tasks have been created in the session. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Fan-out progress of the background `Workflow` the agent is waiting on,
   *  read from its run journal. Distinct from `taskProgress` (the in-session
   *  TaskCreate/TaskUpdate checklist) — these are two different concepts and
   *  are kept as separate fields. null unless `state` is `running_background`
   *  and the outstanding task is a `Workflow` with an on-disk journal. */
  workflow: Schema.NullOr(ClaudeWorkflowSchema),
  /** Running context-window token count: sum of input + cache_creation +
   *  cache_read on the latest assistant entry's `message.usage`. Null when
   *  the transcript has no assistant entries yet, or the entry lacks usage
   *  (e.g. synthetic entries from /compact). Window size is not encoded —
   *  consumers render the raw count compact ("47k"). */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the conversation began — the transcript's first entry
   *  `timestamp`. Deliberately the conversation's age (survives a `claude -c`
   *  resume), NOT the session file's process `startedAt` (which resets on
   *  resume); matches codex/opencode's "Running for" semantics. Null until the
   *  first message lands. Drives the inspector's "Running for" elapsed display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type ClaudeCodeInfo = typeof ClaudeCodeInfoSchema.Type;

/** Claude Code / Anthropic spark mark — simple-icons `anthropic`, 24×24.
 *  ONE mark for both the tile-chrome icon and the dock pip. */
const CLAUDE_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: [
    "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
  ],
};

/** Claude Code's vocabulary — everything kolu knows about the `claude` binary:
 *  its display name, brand mark, CLI grammar (the flag allowlist that defines a
 *  meaningfully different invocation), resume policy, and wire schema. */
export const claudeCodeVocab: AgentVocab<ClaudeCodeInfo> = {
  kind: "claude-code",
  displayName: "Claude Code",
  mark: CLAUDE_MARK,
  cli: {
    basename: "claude",
    stableFlags: new Map<string, FlagArity>([
      ["--model", "value"],
      ["--dangerously-skip-permissions", "boolean"],
      ["--allowedTools", "value"],
      ["--disallowedTools", "value"],
      ["--permission-mode", "value"],
      ["--add-dir", "value"],
      ["--agent", "value"],
      ["--mcp-config", "value"],
      ["--strict-mcp-config", "boolean"],
      ["--append-system-prompt", "value"],
      ["--settings", "value"],
      ["--bare", "boolean"],
    ]),
    extraExitFlags: new Set<string>(),
    nonSessionFlags: new Set<string>(),
    nonSessionSubcommands: new Set<string>(),
  },
  resume: {
    last: "-c",
    byId: (id) => `--resume ${id}`,
    idPattern:
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    ref: (info) => info.sessionId,
  },
  infoSchema: ClaudeCodeInfoSchema,
};
