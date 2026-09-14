/**
 * oh-my-pi integration — public barrel.
 *
 * Module layout:
 *   - `agent-dir.ts`       — omp's agent-directory (profile / env / XDG) fold
 *   - `breadcrumb.ts`      — the tty → session breadcrumb (omp's own anchor)
 *   - `core.ts`            — leaf helpers (state fold, title slot,
 *                            breadcrumb-directory watcher)
 *   - `screen-scrape.ts`   — the awaiting-user dialog detector + promote policy
 *   - `session-watcher.ts` — per-session transcript watch → OmpInfo stream
 *   - `agent-adapter.ts`   — `AgentAdapter` the sensors consume
 *   - `schemas.ts`         — Effect schemas + types (browser-safe)
 *   - `config.ts`          — env-resolved home paths
 *
 * Peers import from their leaves; `index.ts` is a pure barrel so nothing has
 * to reach back through it (the codex/grok cycle precedent, #710).
 */

export type { Logger } from "kolu-shared";
export {
  type AgentDirResolution,
  type AgentDirSource,
  normalizeProfileName,
  parseProfileFlag,
  resolveAgentDir,
} from "./agent-dir.ts";
export { ompAdapter, knownOmpSessionPath } from "./agent-adapter.ts";
export {
  type BreadcrumbRead,
  type OmpSession,
  parseSessionFileName,
  readBreadcrumb,
  ttyIdForPid,
} from "./breadcrumb.ts";
export { AGENT_DIR_OVERRIDE, BREADCRUMB_DIR, OMP_ENV_KEYS } from "./config.ts";
export {
  deriveOmpInfo,
  deriveOmpState,
  readTitleSlot,
  subscribeBreadcrumbDir,
  TAIL_BYTES,
  TITLE_SLOT_BYTES,
} from "./core.ts";
export {
  type OmpInfo,
  OmpInfoSchema,
  ompVocab,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export { createOmpWatcher, type OmpWatcher } from "./session-watcher.ts";
export {
  loadOmpTranscript,
  normalizeOmpToolInput,
  parseOmpTranscript,
} from "./transcript.ts";
// The screen-scrape detector + promote policy stays INTERNAL (claude-code keeps
// its own `screen.ts` private too): its only consumer is this package's
// adapter, which imports the leaf directly. A public policy surface with no
// consumer is surface a reader has to classify and maintain for nothing.

// ── The plugin — the ONE contribution the registry (`kolu-agents`) folds. ──
import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { ompAdapter } from "./agent-adapter.ts";
import type { OmpSession } from "./breadcrumb.ts";
import { OMP_ENV_KEYS } from "./config.ts";
import { type OmpInfo, ompVocab } from "./schemas.ts";
import { loadOmpTranscript } from "./transcript.ts";

export const ompPlugin: AgentPlugin<OmpSession, OmpInfo, Fetcher> = {
  vocab: ompVocab,
  adapter: ompAdapter,
  fetcher: loadOmpTranscript,
  envKeys: OMP_ENV_KEYS,
};
