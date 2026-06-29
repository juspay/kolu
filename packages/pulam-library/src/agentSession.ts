/** Pure decision: which agent-session ref (if any) to PERSIST for a terminal
 *  whose live agent field just changed.
 *
 *  The live `agent` field churns on the ~150 ms agent stream (state, summary,
 *  token counts), but the conversation IDENTITY (`kind` + `sessionId`) changes
 *  at most once per conversation. The persisted `agentSession` ref must track
 *  only that identity — so this returns a ref to write ONLY when the identity is
 *  genuinely new, and `null` (meaning "don't write") on every same-identity tick,
 *  so the firehose never re-arms the autosave path (juspay/kolu#1495).
 *
 *  Sticky, like `lastAgentCommand`: an agent going away (`nextAgent === null`)
 *  is a "don't write", NOT a "clear" — the last known conversation survives so a
 *  slept/restored terminal can still resume it.
 *
 *  Exported (not inlined into the sensor) so the gate has a readable unit test,
 *  mirroring `shouldBumpRecencyForAgentChange`. */

import type { AgentInfo, AgentSessionRef } from "./schema.ts";

export function agentSessionToPersist(
  persisted: AgentSessionRef | undefined,
  nextAgent: AgentInfo | null,
): AgentSessionRef | null {
  if (nextAgent === null) return null; // agent gone — keep the last ref (sticky)
  if (
    persisted?.kind === nextAgent.kind &&
    persisted?.id === nextAgent.sessionId
  ) {
    return null; // same conversation — no write, so the stream can't re-arm autosave
  }
  return { kind: nextAgent.kind, id: nextAgent.sessionId };
}
