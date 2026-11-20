import { createWalSubscription } from "kolu-shared/sqlite";
import { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

const { subscribe: subscribeOpenCodeDb } = createWalSubscription({
  dbPath: OPENCODE_DB_PATH,
  walPath: OPENCODE_DB_WAL_PATH,
  label: "opencode",
});

export { subscribeOpenCodeDb };
