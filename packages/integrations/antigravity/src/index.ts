/**
 * Antigravity CLI integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — which conversation; the transcript fold; title,
 *                            start time; the conversation-start watch
 *   - `session-watcher.ts` — per-conversation watch → AntigravityInfo stream
 *   - `screen.ts`          — the permission-menu detector (promote only)
 *   - `agent-adapter.ts`   — `AgentAdapter` the sensors consume
 *   - `transcript.ts`      — transcript → the shared export IR
 *   - `schemas.ts`         — Effect schemas, vocab (browser-safe)
 *   - `config.ts`          — env-resolved paths
 */

export type { Logger } from "kolu-shared";
export { antigravityAdapter } from "./agent-adapter.ts";
export { ANTIGRAVITY_DIR, ANTIGRAVITY_ENV_KEYS } from "./config.ts";
export {
  type AntigravityFold,
  type AntigravitySession,
  conversationForDirectory,
  conversationsHeld,
  decodeProtoTextString,
  deriveAntigravityState,
  readStartedAt,
  readTitle,
  resolveAntigravitySessions,
} from "./core.ts";
export {
  type AntigravityInfo,
  AntigravityInfoSchema,
  antigravityVocab,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export {
  isAntigravityScreenPollable,
  promoteAntigravityFromScreen,
  screenHasAntigravityMenu,
} from "./screen.ts";
export {
  loadAntigravityTranscript,
  normalizeAntigravityToolInput,
  parseAntigravityTranscript,
} from "./transcript.ts";

// ── The plugin — the ONE contribution the registry (`kolu-agents`) folds. ──
import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { antigravityAdapter } from "./agent-adapter.ts";
import { ANTIGRAVITY_ENV_KEYS } from "./config.ts";
import type { AntigravitySession } from "./core.ts";
import { type AntigravityInfo, antigravityVocab } from "./schemas.ts";
import { loadAntigravityTranscript } from "./transcript.ts";

export const antigravityPlugin: AgentPlugin<
  AntigravitySession,
  AntigravityInfo,
  Fetcher
> = {
  vocab: antigravityVocab,
  adapter: antigravityAdapter,
  fetcher: loadAntigravityTranscript,
  envKeys: ANTIGRAVITY_ENV_KEYS,
};
