/**
 * Shared WAL watcher for Codex's threads DB. Wraps anyagent's
 * `createWalSubscription` — the refcounted singleton, parent-dir
 * fallback, and promote-on-appearance dance all live upstream.
 */

import { createWalSubscription } from "anyagent";
import { CODEX_DB_PATH, CODEX_DB_WAL_PATH } from "./config.ts";

const { subscribe: subscribeCodexDb } = createWalSubscription({
  dbPath: CODEX_DB_PATH,
  walPath: CODEX_DB_WAL_PATH,
  label: "codex",
});

export { subscribeCodexDb };
