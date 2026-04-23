/** Lifecycle states every kolu agent provider derives. The badge's
 *  `data-agent-state` attribute takes one of these values verbatim, and
 *  each provider's state machine targets this union. Shared so the
 *  codex and opencode mock fixture builders agree on the spelling
 *  without cross-importing. */
export type AgentLifecycleState = "thinking" | "tool_use" | "waiting";
