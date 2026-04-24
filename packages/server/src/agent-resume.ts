/**
 * Per-terminal agent-resume persistence — captures the normalized agent CLI
 * invocation for each terminal and persists it across kolu restarts so the
 * session-restore UI can auto-resume claude / codex / opencode.
 *
 * Distinct from `activity.ts` (global recent-agents MRU) and from
 * `session.ts` (terminal UI-state snapshot): those answer "what agents has
 * the user run recently" and "what terminals were open", this answers "what
 * agent was running in THIS terminal." Split per Lowy — session snapshots
 * change on terminal lifecycle events, agent-resume changes on preexec OSC
 * hits; different forcing functions, different cadences.
 *
 * Written eagerly on every `trackAgentResume` call (matching `trackRecentAgent`
 * in activity.ts — no debounce). The stream yields snapshot-then-deltas per
 * `.claude/rules/streaming.md` by yielding the current map first, then
 * re-yielding on every `agentResume:changed` publish.
 */

import {
  type TerminalId,
  type SavedAgentResume,
  SavedAgentResumeSchema,
} from "kolu-common";
import { store } from "./state.ts";
import { publishSystem } from "./publisher.ts";
import { log } from "./log.ts";

/** Read the current per-terminal agent-resume map. */
export function getSavedAgentResume(): SavedAgentResume {
  return store.get("agentResume");
}

/** Record that terminal `id` just ran `command` (already normalized by
 *  `parseAgentCommand`). Overwrites any prior entry for the terminal —
 *  we only care about the most recent command per terminal. */
export function trackAgentResume(id: TerminalId, command: string): void {
  const current = store.get("agentResume");
  const next: SavedAgentResume = {
    ...current,
    [id]: { command, lastSeen: Date.now() },
  };
  store.set("agentResume", next);
  publishSystem("agentResume:changed", next);
}

/** Drop the resume entry for a terminal — called when the terminal exits
 *  so the persisted map stays bounded. Terminals that closed cleanly have
 *  no session to resume into. */
export function clearAgentResume(id: TerminalId): void {
  const current = store.get("agentResume");
  if (!(id in current)) return;
  const { [id]: _dropped, ...rest } = current;
  store.set("agentResume", rest);
  publishSystem("agentResume:changed", rest);
}

/** Test-only: replace the entire map wholesale. Used by e2e hooks to seed
 *  per-terminal agent commands alongside a test saved-session. Validates so
 *  fixture errors surface clearly. */
export function setAgentResumeForTest(value: SavedAgentResume): void {
  const result = SavedAgentResumeSchema.safeParse(value);
  if (!result.success) {
    log.error({ issues: result.error.issues }, "test agent-resume invalid");
    throw new Error("Invalid agent-resume in test__set");
  }
  store.set("agentResume", result.data);
  publishSystem("agentResume:changed", result.data);
}
