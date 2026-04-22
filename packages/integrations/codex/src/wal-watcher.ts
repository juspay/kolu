import { subscribeSqliteWal, type Logger } from "anyagent";
import { codexStateWalPath, findCodexStateDbPath } from "./config.ts";

export function subscribeCodexDb(
  dbPath: string,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  return subscribeSqliteWal(
    dbPath,
    codexStateWalPath(dbPath),
    onChange,
    onError,
    log,
  );
}

/** Best-effort external-change subscription for session re-resolution.
 *  Used by the AgentProvider before a session is attached. */
export function subscribeActiveCodexDb(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  const dbPath = findCodexStateDbPath(log);
  if (!dbPath) return () => {};
  return subscribeCodexDb(dbPath, onChange, onError, log);
}
