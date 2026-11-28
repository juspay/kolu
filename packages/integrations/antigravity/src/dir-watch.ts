/** The process-wide wake (`externalChanges`): what kolu watches in `agy`'s
 *  app data directory so that a terminal is looked at again when its
 *  conversation may have changed. Its own module because it revs with where
 *  `agy` writes as it opens conversations, not with how a match is read. */

import path from "node:path";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  watchDirWhenReady,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import {
  ANTIGRAVITY_DIR,
  LAST_CONVERSATIONS_FILE,
  PRESENCE_DIR,
} from "./config.ts";

/** Watch the three directories where a terminal's conversation can change,
 *  through one coalesced wake:
 *
 *  - `presence/` — a lock file appears whenever a conversation is created
 *    (first prompt, `/clear`, `/fork`).
 *  - `cache/` — the directory cache the fallback reads.
 *  - `agy`'s top directory — opening a conversation that already exists
 *    (`agy --conversation=<id>`, the `/resume` picker) creates nothing in
 *    `presence/`. `agy` writes here after it holds the lock (a summaries file
 *    within about a second, seen at three opens of three) and at every submit
 *    (`history.jsonl`), so the next re-resolve finds the lock held.
 *
 *  A directory watch says only that something there changed: no file in these
 *  directories is opened for it. The top directory reports bursts (about thirty
 *  events a turn) and each wake re-resolves every terminal, so all three feed
 *  kolu-io's shared coalesce schedule — for cost, not timing. Each watch waits
 *  for its directory to appear, so a machine that never ran `agy` pays one
 *  ancestor watch per directory and nothing else. */
export function subscribeAntigravityDirs(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  const coalesce = createCoalesceSchedule({
    debounceMs: COALESCE_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: () => {
      try {
        onChange();
      } catch (err) {
        onError(err);
      }
    },
  });
  const schedule = (): void => coalesce.schedule();
  const stops = [
    watchDirWhenReady(PRESENCE_DIR, schedule, log),
    watchDirWhenReady(path.dirname(LAST_CONVERSATIONS_FILE), schedule, log),
    watchDirWhenReady(ANTIGRAVITY_DIR, schedule, log),
  ];
  log?.info({ dir: ANTIGRAVITY_DIR }, "antigravity: directory watch installed");
  return () => {
    for (const stop of stops) stop();
    coalesce.destroy();
  };
}
