/**
 * Shared WAL watcher for OpenCode's database. Wraps anyagent's
 * `createWalSubscription` — the refcounted singleton, parent-dir
 * fallback, and promote-on-appearance dance all live upstream.
 */

import { createWalSubscription } from "anyagent";
import { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

const { subscribe: subscribeOpenCodeDb } = createWalSubscription({
  dbPath: OPENCODE_DB_PATH,
  walPath: OPENCODE_DB_WAL_PATH,
  label: "opencode",
});

export { subscribeOpenCodeDb };
