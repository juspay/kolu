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
