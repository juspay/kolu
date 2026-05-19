/**
 * Remote OpenCode agent state — uses `host.queryDb` to poll the remote
 * machine's `opencode.db` instead of the controller's local one. Without
 * this, kolu would either:
 *
 *   (a) try to look up the session in the controller's local OpenCode
 *       DB and find nothing (the agent is running on a different box),
 *       leaving the agent indicator stuck on "thinking" forever; or
 *
 *   (b) fall back to the basename-only minimal detection that the
 *       generic remote orchestrator emits — same problem.
 *
 * Reuses kolu-opencode's SQL constants (`SESSION_BY_DIRECTORY_SQL`,
 * `LATEST_MESSAGE_SQL`) and message-parser (`parseMessageState`) so
 * the local and remote paths share one source of truth for the
 * derived OpenCode state. The only divergence is the IO primitive:
 * `DatabaseSync` here, `host.queryDb` over RPC there.
 */

import {
  LATEST_MESSAGE_SQL,
  OPENCODE_DB_REL,
  parseMessageState,
  SESSION_BY_DIRECTORY_SQL,
} from "kolu-opencode";
import type { Host } from "../host/types.ts";
import type { Logger } from "../log.ts";

/** How often to repoll the OpenCode DB while idle. The local watcher
 *  uses `fs.watch` on the SQLite WAL; the remote version polls because
 *  inotify-over-SSH for the WAL is an extra hop, and 1.5s feels live
 *  enough for "is the agent done thinking yet" without flooding the
 *  helper RPC channel. */
const POLL_INTERVAL_MS = 1_500;

export interface RemoteOpencodeWatcher {
  /** Latest cwd from the terminal — the session lookup keys on this. */
  setCwd(cwd: string): void;
  destroy(): void;
}

/** Wire-shape kolu expects on `meta.agent` for OpenCode. Inlined to
 *  keep the import surface narrow; matches `OpenCodeInfoSchema`. */
type OpencodeInfoOut = {
  kind: "opencode";
  state: "thinking" | "tool_use" | "waiting" | "awaiting_user";
  sessionId: string;
  model: string | null;
  summary: string | null;
  taskProgress: null;
  contextTokens: null;
};

export function startRemoteOpencode(
  host: Host,
  initialCwd: string,
  onInfo: (info: OpencodeInfoOut | null) => void,
  plog: Logger,
): RemoteOpencodeWatcher {
  let cwd = initialCwd;
  let last: OpencodeInfoOut | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Cached remote HOME — `printenv HOME` once per host, then reuse. */
  let remoteHome: string | undefined;

  async function ensureHome(): Promise<string | undefined> {
    if (remoteHome) return remoteHome;
    try {
      const r = await host.exec("printenv", ["HOME"], { timeoutMs: 5_000 });
      if (r.exitCode === 0) {
        const h = r.stdout.trim();
        if (h.length > 0) remoteHome = h;
      }
    } catch {
      // ignore — refresh will try again next tick
    }
    return remoteHome;
  }

  function emit(next: OpencodeInfoOut | null): void {
    const changed =
      (last === null) !== (next === null) ||
      (last !== null &&
        next !== null &&
        (last.state !== next.state ||
          last.sessionId !== next.sessionId ||
          last.summary !== next.summary ||
          last.model !== next.model));
    if (!changed) return;
    last = next;
    onInfo(next);
  }

  async function refresh(): Promise<void> {
    if (stopped) return;
    const home = await ensureHome();
    if (!home) return;
    const dbPath = `${home}/${OPENCODE_DB_REL}`;
    try {
      const sessions = (await host.queryDb(dbPath, SESSION_BY_DIRECTORY_SQL, [
        cwd,
      ])) as Array<{ id: string; title: string | null }>;
      const session = sessions[0];
      if (!session) {
        emit(null);
        return;
      }
      const messages = (await host.queryDb(dbPath, LATEST_MESSAGE_SQL, [
        session.id,
      ])) as Array<{ data: string }>;
      const parsed = messages[0] ? parseMessageState(messages[0].data) : null;
      emit({
        kind: "opencode",
        state: parsed?.state ?? "thinking",
        sessionId: session.id,
        model: parsed?.model ?? null,
        summary: session.title ?? null,
        taskProgress: null,
        contextTokens: null,
      });
    } catch (err) {
      plog.debug({ err, dbPath, cwd }, "remote opencode poll failed");
    }
  }

  function setCwd(next: string): void {
    if (next === cwd) return;
    cwd = next;
    void refresh();
  }

  timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  void refresh();

  return {
    setCwd,
    destroy: () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
