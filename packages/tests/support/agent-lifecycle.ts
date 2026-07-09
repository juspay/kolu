/** Lifecycle states every kolu agent provider derives. The badge's
 *  `data-agent-state` attribute takes one of these values verbatim, and
 *  each provider's state machine targets this union. Shared so the
 *  codex / opencode / grok mock fixture builders agree on the spelling
 *  without cross-importing. `awaiting_user` is the blocked-on-prompt
 *  state (Claude AskUserQuestion, Codex request_user_input, Grok
 *  permission_prompt); not every fixture builder exercises it. */
export type AgentLifecycleState =
  | "thinking"
  | "tool_use"
  | "waiting"
  | "awaiting_user";
