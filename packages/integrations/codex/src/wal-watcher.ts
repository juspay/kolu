import { createWalSubscription } from "kolu-shared/sqlite";
import { CODEX_DB_PATH, CODEX_DB_WAL_PATH } from "./config.ts";

const { subscribe: subscribeCodexDb } = createWalSubscription({
  dbPath: CODEX_DB_PATH,
  walPath: CODEX_DB_WAL_PATH,
  label: "codex",
});

export { subscribeCodexDb };
