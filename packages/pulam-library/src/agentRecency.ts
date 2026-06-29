/** Pure decision: does this agent transition warrant a recency bump?
 *
 *  - Watcher emits sharing the same `kind`/`sessionId`/`state` are
 *    dedup'd here so frequent sub-info refreshes (`contextTokens`,
 *    `summary`) don't perturb ordering.
 *  - Restore caveat: agent state is transient, so a restored terminal
 *    always sees a `null → detected` "transition" the moment the
 *    adapter re-observes the still-running session. If the terminal
 *    already carries a non-zero `lastActivityAt` (from the saved
 *    session), that's the truth of when the user last interacted —
 *    don't overwrite it with `Date.now()` just because the live agent
 *    slot was re-populated. The next real state change inside the
 *    session will bump as usual.
 *
 *  Exported (not private to `local.ts`) so the unit test for the
 *  recency rule can stay readable without reaching through the whole
 *  endpoint module. */

import type { AgentInfo } from "./schema.ts";

export function shouldBumpRecencyForAgentChange(
  prev: AgentInfo | null,
  next: AgentInfo | null,
  currentLastActivityAt: number,
): boolean {
  const transitioning =
    prev?.kind !== next?.kind ||
    prev?.sessionId !== next?.sessionId ||
    prev?.state !== next?.state;
  if (!transitioning) return false;
  const isReDetectionAfterRestore =
    prev === null && next !== null && currentLastActivityAt > 0;
  return !isReDetectionAfterRestore;
}
